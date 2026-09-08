import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { NavigationConfigSchema } from "../../schemas/entities";
import { toNavigationConfigDto } from "../../mappers";
import { logAudit } from "../../lib/audit";
import { triggerGlobalRevalidation } from "../../lib/revalidate";
import { DEFAULTS, SETTINGS_ID } from "../settings/settings.routes";
import { UpdateNavigationConfigRequestSchema } from "./navigation.schemas";

export type NavigationItemForSort = { id?: string; parentId?: string | null };

/**
 * Öğeleri seviye-sıralı (ata sayısı artan) olarak STABLE sıralar. `PUT /admin/navigation`
 * tam-replace `createMany` öncesi kullanılır: her satırın ebeveyni, kendisinden ÖNCE
 * yazılmış olur, dolayısıyla FK ihlali oluşmaz (bkz. ARCHITECTURE.md §10.10.3).
 * `Array.prototype.sort` ES2019'dan beri stable'dır — aynı derinlikteki kardeşlerin
 * payload'daki göreli sırası korunur. Modülden export edilir ki aynı desenin ikinci bir
 * kopyası (`demo-templates/importer.ts`) buraya bağlanabilsin — kod KOPYALANMAZ.
 */
export function sortNavigationItemsByDepth<T extends NavigationItemForSort>(items: T[]): T[] {
  const byId = new Map<string, T>();
  items.forEach((item) => {
    if (item.id) byId.set(item.id, item);
  });

  const depthMemo = new Map<string, number>();

  function depthOf(item: T, visiting: Set<string> = new Set()): number {
    if (item.id && depthMemo.has(item.id)) return depthMemo.get(item.id)!;
    if (item.parentId == null) {
      if (item.id) depthMemo.set(item.id, 0);
      return 0;
    }
    const parent = byId.get(item.parentId);
    // Savunma: parent bulunamazsa (orphan) veya teorik bir döngüye rastlanırsa (validasyon
    // katmanı bunu zaten reddeder, ama bu fonksiyon bağımsız da kullanılabilir/çağrılabilir)
    // kök gibi ele alınır — sonsuz özyineleme imkânsızdır.
    if (!parent || (item.id != null && visiting.has(item.id))) {
      if (item.id) depthMemo.set(item.id, 0);
      return 0;
    }
    if (item.id) visiting.add(item.id);
    const d = depthOf(parent, visiting) + 1;
    if (item.id) depthMemo.set(item.id, d);
    return d;
  }

  return [...items].sort((a, b) => depthOf(a) - depthOf(b));
}

async function readNavigationConfig(app: FastifyInstance) {
  const [settings, navigationItems, socialLinks, footerColumns] = await Promise.all([
    app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } }),
    // `(parentId NULLS FIRST, order)` kardeşleri bitişik/sıralı tutar (deterministiktir),
    // ANCAK 4 seviyede "ata her zaman torundan önce gelir" GARANTİSİNİ VERMEZ — torunlar
    // ebeveyn UUID'sine göre sıralanır, ebeveynin kendi derinliğine göre değil. Tüketici
    // (site header, admin editör) tek geçişli gruplama YERİNE iki geçişli bir
    // `parentId -> children[]` haritası kurmalıdır (bkz. ARCHITECTURE.md §10.10.1).
    app.prisma.navigationItem.findMany({
      orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { order: "asc" }],
    }),
    app.prisma.socialLink.findMany({ orderBy: { order: "asc" } }),
    app.prisma.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } }),
  ]);
  return toNavigationConfigDto({ settings, navigationItems, socialLinks, footerColumns });
}

/** `/navigation` prefix'i altında bağlanır — herkese açık, site header/nav/footer'ı bunu okur. */
export async function publicNavigationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(NavigationConfigSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readNavigationConfig(app)));
  });
}

/**
 * `/admin/navigation` prefix'i altında bağlanır.
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 10 — `GET`: ADMIN/MANAGER/EDITOR (panel
 * kapısı yeterli); `PUT`: ADMIN + MANAGER.
 */
export async function adminNavigationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(NavigationConfigSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readNavigationConfig(app)));
  });

  server.put(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: UpdateNavigationConfigRequestSchema, response: { 200: ApiSuccessSchema(NavigationConfigSchema) } },
    },
    async (request, reply) => {
      const body = request.body;

      const navigationConfigFields = {
        headerCtaLabel: body.headerCtaLabel,
        headerCtaHref: body.headerCtaHref,
        footerCopyrightText: body.footerCopyrightText,
      };

      await app.prisma.$transaction(async (tx) => {
        await tx.siteSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID, ...DEFAULTS, ...navigationConfigFields },
          update: navigationConfigFields,
        });

        await tx.navigationItem.deleteMany({});
        if (body.navigationItems.length > 0) {
          // Seviye-sıralı kararlı topolojik sıralama: her satırın ebeveyni kendisinden ÖNCE
          // yazılır. 4 seviyede eski roots/children iki-parçalı bölme YETERSİZDİR (yalnızca
          // derinlik ≤ 2'yi kapsar) — bkz. ARCHITECTURE.md §10.10.3.
          const ordered = sortNavigationItemsByDepth(body.navigationItems);
          await tx.navigationItem.createMany({ data: ordered });
        }

        await tx.socialLink.deleteMany({});
        if (body.socialLinks.length > 0) await tx.socialLink.createMany({ data: body.socialLinks });

        // Kolonları silmek Cascade ile bağlı footerLink'leri de otomatik siler (bkz. schema.prisma).
        await tx.footerColumn.deleteMany({});
        for (const col of body.footerColumns) {
          await tx.footerColumn.create({ data: { title: col.title, order: col.order, links: { create: col.links } } });
        }
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "navigation.update",
        targetType: "NavigationConfig",
        targetId: "singleton",
        metadata: {
          itemCount: body.navigationItems.length,
          socialCount: body.socialLinks.length,
          columnCount: body.footerColumns.length,
        },
        ipAddress: request.ip,
      });

      // Navigasyon (header/footer/social) TÜM public layout'u (her locale) etkiler — best-effort
      // global revalidation (bkz. lib/revalidate.ts).
      await triggerGlobalRevalidation(app);

      return reply.send(ok(await readNavigationConfig(app)));
    }
  );
}
