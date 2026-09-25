import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { PageSchema, SiteSettingsSchema } from "../../schemas/entities";
import { toPageDto, toSiteSettingsDto } from "../../mappers";
import { attachLocalizationsOne } from "../../lib/localization";
import { logAudit } from "../../lib/audit";
import { ValidationError } from "../../lib/errors";
import { PERMISSIONS_MATRIX } from "../../lib/permissions-matrix";
import { isDemoPaymentsEnabled } from "../../config/env";
import { computeDemoPaymentsEnabled } from "../../lib/demo-payments";
import { PermissionsMatrixDto, PermissionsMatrixSchema, UpdateSiteSettingsRequestSchema } from "./settings.schemas";
import { CACHE_TAGS, triggerTagRevalidation } from "../../lib/revalidate";

export const SETTINGS_ID = "singleton";
export const DEFAULTS = {
  siteName: "WM Health Istanbul",
  logoUrl: null as string | null,
  faviconUrl: null as string | null,
  appleTouchIconUrl: null as string | null,
  tagline: "Uzman Doktorlarla Güvenli Online Görüşme" as string | null,
  headerLogoHeight: null as number | null,
  headerLogoMaxWidth: null as number | null,
  homePageId: null as string | null,
  siteTemplate: "SHOWCASE" as const,
  // §3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — `null` = kargo hiç
  // hesaplanmaz/eşik yok (bugünkü davranışın birebir aynısı).
  shippingFlatFeeCents: null as number | null,
  freeShippingThresholdCents: null as number | null,
  // §2.5 (.claude/architect-scope-products-catalog.md, bağlayıcı) — İKİSİ de null iken PDP
  // tahmini teslimat satırını HİÇ render etmez.
  shippingEstimatedDaysMin: null as number | null,
  shippingEstimatedDaysMax: null as number | null,
  // `.claude/security-review-demo-payment-toggle.md` Madde 2 + architect "Ek Karar B" —
  // HAM DB varsayılanıyla (`prisma/schema.prisma::SiteSettings.demoPaymentsEnabled
  // @default(true)`) TUTARLI. Bu ham değer `readSettings`te AND-gate'siz DÖNMEZ — bkz.
  // aşağıdaki `readSettings`.
  demoPaymentsEnabled: true,
  // NOT — 2026-09-15: Sağ alt canlı destek widget'ı — HAM DB varsayılanlarıyla
  // (`prisma/schema.prisma::SiteSettings.liveChat*`) TUTARLI. `readSettings`te
  // `demoPaymentsEnabled`in AKSİNE env-tabanlı bir AND-gate GEREKMEZ.
  liveChatEnabled: false,
  liveChatProvider: "internal",
  liveChatScriptId: null as string | null,
  // Ön görüşme (pre-chat) formu — `.claude/architect-scope-support-desk-and-reminders.md`
  // §7.1/§7.3. HAM DB varsayılanlarıyla (`prisma/schema.prisma::SiteSettings.liveChatPreChat*`)
  // TUTARLI, AND-gate GEREKMEZ.
  liveChatPreChatEnabled: false,
  liveChatRequireName: true,
  liveChatRequirePhone: true,
  liveChatRequireEmail: false,
  liveChatPosition: "BOTTOM_RIGHT" as const,
};

/**
 * `shippingEstimatedDaysMax`, nihai (istekte gönderilmemişse mevcut kayıttaki)
 * `shippingEstimatedDaysMin`'den KÜÇÜK olamaz. Şemadaki `refine` yalnızca AYNI istekte iki alan
 * da gönderildiğinde kontrol edebiliyor (bkz. settings.schemas.ts) — `products.routes.ts::
 * assertDiscountBelowPrice` ile AYNI desen.
 */
function assertShippingEstimateRange(finalMin: number | null, finalMax: number | null): void {
  if (finalMin === null || finalMax === null) return;
  if (finalMax < finalMin) {
    throw new ValidationError("shippingEstimatedDaysMax, shippingEstimatedDaysMin değerinden küçük olamaz.", {
      shippingEstimatedDaysMax: ["shippingEstimatedDaysMax, shippingEstimatedDaysMin değerinden küçük olamaz."],
    });
  }
}

/**
 * Architect "Ek Karar B" (`.claude/architect-scope-demo-payment-doctor-counters.md`,
 * "EK KARAR — 2026-09-15") — DB'de hiç satır YOKKEN (henüz `PATCH` çağrılmamış taze bir
 * kurulum) `toSiteSettingsDto` mapper'ı hiç ÇAĞRILMAZ, ham `DEFAULTS` döner. AND-gate
 * (`computeDemoPaymentsEnabled`) mapper'ın İÇİNDE uygulanır ama bu yol mapper'ı ATLADIĞI
 * için burada da AYRICA uygulanmalıdır — aksi halde taze bir prod kurulumunda
 * `GET /settings` yanlışlıkla `demoPaymentsEnabled: true` sızdırır (bağlayıcı, bkz.
 * `.claude/security-review-demo-payment-toggle.md`).
 */
async function readSettings(app: FastifyInstance) {
  const row = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (row) return toSiteSettingsDto(row);
  return {
    ...DEFAULTS,
    demoPaymentsEnabled: computeDemoPaymentsEnabled(DEFAULTS.demoPaymentsEnabled),
    demoPaymentsSupported: isDemoPaymentsEnabled,
  };
}

/** `/settings` prefix'i altında bağlanır — herkese açık, site header/nav'ı bunu okur. */
export async function publicSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(SiteSettingsSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readSettings(app)));
  });

  // Kök `/` rotası için: seçili ana sayfa yayında değilse veya seçili değilse null döner
  // (frontend bu durumda kendi varsayılan fallback'ini gösterir).
  server.get("/homepage", { schema: { response: { 200: ApiSuccessSchema(PageSchema.nullable()) } } }, async (_request, reply) => {
    const settings = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
    if (!settings?.homePageId) return reply.send(ok(null));

    // §10.7 İçerik Yönetim Listesi — çöpteki sayfa ana sayfa OLAMAZ (trash sırasında zaten
    // homePageId temizlenir, ama başka bir yoldan kalırsa da burada ekstra bir güvenlik ağıdır).
    const page = await app.prisma.page.findFirst({
      where: { id: settings.homePageId, status: "PUBLISHED", deletedAt: null },
      include: { author: true },
    });
    if (!page) return reply.send(ok(null));

    // §10.5 Çoklu Dil & Yerelleştirme — `PageSchema.localizations` artık ZORUNLU bir alan;
    // bu uç `?locale=` KABUL ETMEZ (her zaman kanonik/varsayılan dili döner, bkz. openapi.yaml
    // bu ucun sözleşmesi) ama yanıt şeması yine de dolu bir `localizations` dizisi bekler.
    const localizations = await attachLocalizationsOne(app, "PAGE", page);
    return reply.send(ok(toPageDto(page, localizations)));
  });
}

/**
 * `/admin/settings` prefix'i altında bağlanır.
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 17 — `GET /`: ADMIN/MANAGER/EDITOR (panel
 * kapısı yeterli); `PATCH /` ve `GET /permissions`: yalnızca ADMIN — (d)/(a).
 * `/admin/settings/security/{2fa,sessions}` AYRI bir router'dadır (§4.3 istisnası, panel guard'ı
 * BURADA/ORADA EKLENMEZ — bkz. modules/security).
 */
export async function adminSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(SiteSettingsSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readSettings(app)));
  });

  server.patch(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { body: UpdateSiteSettingsRequestSchema, response: { 200: ApiSuccessSchema(SiteSettingsSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
      const existingOrDefaults = existing ?? DEFAULTS;

      const finalShippingMin =
        request.body.shippingEstimatedDaysMin !== undefined
          ? request.body.shippingEstimatedDaysMin
          : existingOrDefaults.shippingEstimatedDaysMin;
      const finalShippingMax =
        request.body.shippingEstimatedDaysMax !== undefined
          ? request.body.shippingEstimatedDaysMax
          : existingOrDefaults.shippingEstimatedDaysMax;
      assertShippingEstimateRange(finalShippingMin, finalShippingMax);

      const settings = await app.prisma.siteSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...DEFAULTS, ...request.body },
        update: request.body,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "settings.update",
        targetType: "SiteSettings",
        targetId: "singleton",
        // security-agent Madde 3 (bağlayıcı öneri) — ödeme-bütünlüğü hassasiyeti nedeniyle
        // salt alan adının yanına YENİ değer de açıkça yazılır (boolean, PII/sır DEĞİL).
        metadata: {
          changed: Object.keys(request.body),
          ...(request.body.demoPaymentsEnabled !== undefined
            ? { demoPaymentsEnabled: request.body.demoPaymentsEnabled }
            : {}),
        },
        ipAddress: request.ip,
      });

      // Logo/favicon/site adı (layout), anasayfa seçimi (`/` ve eski/yeni anasayfanın `/<slug>`
      // yönlendirmesi) — hepsi `settings` etiketli fetch'lerden okunur (bkz. lib/revalidate.ts).
      await triggerTagRevalidation(app, [CACHE_TAGS.settings]);

      return reply.send(ok(toSiteSettingsDto(settings)));
    }
  );

  // `/admin/settings/permissions` — statik yetki matrisi, yalnızca ADMIN görebilir
  // (frontend'in "Yetkiler" ekranında göstermesi için).
  server.get(
    "/permissions",
    { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { response: { 200: ApiSuccessSchema(PermissionsMatrixSchema) } } },
    async (_request, reply) => {
      return reply.send(ok(PERMISSIONS_MATRIX as unknown as PermissionsMatrixDto));
    }
  );
}
