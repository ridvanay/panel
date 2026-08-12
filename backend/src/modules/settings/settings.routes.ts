import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { PageSchema, SiteSettingsSchema } from "../../schemas/entities";
import { toPageDto, toSiteSettingsDto } from "../../mappers";
import { attachLocalizationsOne } from "../../lib/localization";
import { logAudit } from "../../lib/audit";
import { PERMISSIONS_MATRIX } from "../../lib/permissions-matrix";
import { PermissionsMatrixDto, PermissionsMatrixSchema, UpdateSiteSettingsRequestSchema } from "./settings.schemas";

export const SETTINGS_ID = "singleton";
export const DEFAULTS = {
  siteName: "Site",
  logoUrl: null as string | null,
  tagline: null as string | null,
  headerLogoHeight: null as number | null,
  headerLogoMaxWidth: null as number | null,
  homePageId: null as string | null,
  siteTemplate: "SHOWCASE" as const,
};

async function readSettings(app: FastifyInstance) {
  const row = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  return row ? toSiteSettingsDto(row) : DEFAULTS;
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

/** `/admin/settings` prefix'i altında bağlanır — authenticated. */
export async function adminSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(SiteSettingsSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readSettings(app)));
  });

  server.patch(
    "/",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: UpdateSiteSettingsRequestSchema, response: { 200: ApiSuccessSchema(SiteSettingsSchema) } },
    },
    async (request, reply) => {
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
        metadata: { changed: Object.keys(request.body) },
        ipAddress: request.ip,
      });

      return reply.send(ok(toSiteSettingsDto(settings)));
    }
  );

  // `/admin/settings/permissions` — statik yetki matrisi, yalnızca ADMIN görebilir
  // (frontend'in "Yetkiler" ekranında göstermesi için).
  server.get(
    "/permissions",
    { preHandler: requireSiteRole("ADMIN"), schema: { response: { 200: ApiSuccessSchema(PermissionsMatrixSchema) } } },
    async (_request, reply) => {
      return reply.send(ok(PERMISSIONS_MATRIX as unknown as PermissionsMatrixDto));
    }
  );
}
