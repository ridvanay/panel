import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { PageHeaderStyle, SiteFont, SocialShareNetwork } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { PublicSiteAppearanceSchema, SiteAppearanceDto, SiteAppearanceSchema, SiteCustomCodeSchema } from "../../schemas/entities";
import { toPublicSiteAppearanceDto, toSiteAppearanceDto, toSiteCustomCodeDto } from "../../mappers";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { env } from "../../config/env";
import { APPEARANCE_PRESETS, getAppearancePreset } from "../../lib/appearance-presets";
import {
  AppearancePresetSchema,
  ResetAppearanceRequestSchema,
  UpdateCustomCssRequestSchema,
  UpdateCustomJsRequestSchema,
  UpdateSiteAppearanceRequestSchema,
} from "./appearance.schemas";

export const APPEARANCE_ID = "singleton";
const CUSTOM_CODE_ID = "singleton";

// openapi.yaml `PUT /admin/appearance/custom-code/{css,js}` açıklaması — "Hız sınırı: 10 istek / 1 dakika".
const CUSTOM_CODE_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

/**
 * `SiteSettings`/`SiteModule` ile AYNI lazy-upsert `DEFAULTS` deseni (bkz. settings.routes.ts) —
 * satır yoksa (hiç kaydedilmemiş) bu sabit döner, `PATCH`'te de `create` gövdesinin tabanıdır.
 * Prisma şemasındaki `@default` değerleriyle BİREBİR aynı tutulmalıdır (bkz. prisma/schema.prisma::SiteAppearance).
 */
export const DEFAULTS = {
  presetKey: null as string | null,
  pageHeaderStyle: "PLAIN" as PageHeaderStyle,
  pageHeaderBackgroundColor: null as string | null,
  pageHeaderBackgroundMediaId: null as string | null,
  pageHeaderOverlayOpacity: 40,
  primaryColor: "#4f46e5",
  secondaryColor: "#111827",
  buttonColor: "#4f46e5",
  buttonTextColor: "#ffffff",
  linkColor: "#4f46e5",
  headingFont: "SYSTEM" as SiteFont,
  bodyFont: "SYSTEM" as SiteFont,
  baseFontSize: 16,
  socialShareEnabled: false,
  socialShareNetworks: [] as SocialShareNetwork[],
  backToTopEnabled: true,
  stickyHeaderEnabled: true,
  cookieBannerEnabled: false,
  cookieBannerText: null as string | null,
  cookieBannerPolicyHref: null as string | null,
  maintenanceModeEnabled: false,
  maintenanceMessage: null as string | null,
  notFoundTitle: null as string | null,
  notFoundMessage: null as string | null,
  notFoundButtonLabel: null as string | null,
  notFoundButtonHref: null as string | null,
};

/**
 * §10.12.3 — `POST /admin/appearance/reset`'in kapsamı YALNIZCA renk/tipografidir (ön ayarların
 * taşıdığı ALANLARLA BİREBİR AYNI küme, bkz. lib/appearance-presets.ts::AppearancePresetValues).
 * Görünüm anahtarları/404/sayfa başlığı ayarları bu işlemden ETKİLENMEZ — "renklerimi sıfırla"
 * niyeti bakım modunu veya 404 metnini sessizce sıfırlamayı kapsamaz.
 */
const COLOR_TYPOGRAPHY_DEFAULTS = {
  primaryColor: DEFAULTS.primaryColor,
  secondaryColor: DEFAULTS.secondaryColor,
  buttonColor: DEFAULTS.buttonColor,
  buttonTextColor: DEFAULTS.buttonTextColor,
  linkColor: DEFAULTS.linkColor,
  headingFont: DEFAULTS.headingFont,
  bodyFont: DEFAULTS.bodyFont,
  baseFontSize: DEFAULTS.baseFontSize,
};

const WITH_HEADER_MEDIA = { include: { pageHeaderBackgroundMedia: true } } as const;
const WITH_CUSTOM_CODE_UPDATERS = { include: { cssUpdatedBy: true, jsUpdatedBy: true } } as const;

async function readAppearance(app: FastifyInstance): Promise<SiteAppearanceDto> {
  const row = await app.prisma.siteAppearance.findUnique({ where: { id: APPEARANCE_ID }, ...WITH_HEADER_MEDIA });
  return row ? toSiteAppearanceDto(row) : { ...DEFAULTS, pageHeaderBackgroundUrl: null, updatedAt: null };
}

async function readCustomCode(app: FastifyInstance) {
  return app.prisma.siteCustomCode.findUnique({ where: { id: CUSTOM_CODE_ID }, ...WITH_CUSTOM_CODE_UPDATERS });
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** `/appearance` prefix'i altında bağlanır (bkz. app.ts) — herkese açık, `(site)` layout'unun SSR'ı bunu okur. */
export async function publicAppearanceRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(PublicSiteAppearanceSchema) } } }, async (_request, reply) => {
    const [appearance, customCode] = await Promise.all([readAppearance(app), readCustomCode(app)]);

    // Kill switch (§10.12.6) — false iken customJs HER ZAMAN null; saklı değer KORUNUR ve yalnızca
    // yönetim ucunda (`GET /admin/appearance/custom-code`) görünmeye devam eder.
    const customJs = env.CUSTOM_CODE_ENABLED ? (customCode?.customJs ?? null) : null;

    return reply.send(ok(toPublicSiteAppearanceDto(appearance, customCode?.customCss ?? null, customJs)));
  });
}

/** `/admin/appearance` prefix'i altında bağlanır (bkz. app.ts) — authenticated. */
export async function adminAppearanceRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  // Okuma eşiği authenticated'tır (VIEWER dahil) — panel salt-okunur görüntülenebilir, yazma
  // yalnızca ADMIN'dir (bkz. §10.12.6 hakemlik kararı).
  server.get("/", { schema: { response: { 200: ApiSuccessSchema(SiteAppearanceSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readAppearance(app)));
  });

  server.patch(
    "/",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: UpdateSiteAppearanceRequestSchema, response: { 200: ApiSuccessSchema(SiteAppearanceSchema) } },
    },
    async (request, reply) => {
      const body = request.body;

      // Var olmayan bir medya id'si → 404 NOT_FOUND, kısmi yazma YAPILMAZ (openapi.yaml
      // `PATCH /admin/appearance` 404 açıklaması — mevcut `coverMediaId` paterninden FARKLI olarak
      // burada AÇIKÇA doğrulanır, çünkü bu alan tek başına bir banner'ın var/yok olmasını belirler).
      if (body.pageHeaderBackgroundMediaId) {
        const media = await app.prisma.media.findUnique({ where: { id: body.pageHeaderBackgroundMediaId } });
        if (!media) throw new NotFoundError("`pageHeaderBackgroundMediaId` ile gönderilen medya bulunamadı.");
      }

      // Tam değiştirme (replace) semantiği — gönderilen dizi mevcut seçimin YERİNE geçer;
      // yinelenen değerler sunucuda tekilleştirilir (openapi.yaml socialShareNetworks açıklaması).
      // Bilerek Prisma tipiyle (`UncheckedUpdateInput`) ANOTE EDİLMEZ: bu tip `create` ile ortak
      // kullanılamayacak kadar geniştir (alan-güncelleme operasyon nesnelerini de kabul eder) — düz
      // nesne olarak bırakılır, her iki `upsert` dalına da yapısal olarak uyar (settings.routes.ts
      // ile AYNI yaklaşım).
      const data = {
        ...body,
        ...(body.socialShareNetworks ? { socialShareNetworks: Array.from(new Set(body.socialShareNetworks)) } : {}),
      };

      const row = await app.prisma.siteAppearance.upsert({
        where: { id: APPEARANCE_ID },
        create: { id: APPEARANCE_ID, ...DEFAULTS, ...data },
        update: data,
        ...WITH_HEADER_MEDIA,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "appearance.update",
        targetType: "SiteAppearance",
        targetId: APPEARANCE_ID,
        metadata: { changed: Object.keys(body) },
        ipAddress: request.ip,
      });

      return reply.send(ok(toSiteAppearanceDto(row)));
    }
  );

  // Kod içi statik registry — DB tablosu YOKTUR (bkz. lib/appearance-presets.ts, §10.12.3).
  // Public DEĞİLDİR: ziyaretçi sitesi ön ayar TANIMLARINI asla okumaz.
  server.get("/presets", { schema: { response: { 200: ApiSuccessSchema(z.array(AppearancePresetSchema)) } } }, async (_request, reply) => {
    return reply.send(ok(APPEARANCE_PRESETS));
  });

  server.post(
    "/reset",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: ResetAppearanceRequestSchema.optional(), response: { 200: ApiSuccessSchema(SiteAppearanceSchema) } },
    },
    async (request, reply) => {
      const presetKey = request.body?.presetKey ?? null;

      let data: { presetKey: string | null } & typeof COLOR_TYPOGRAPHY_DEFAULTS;
      if (presetKey) {
        const preset = getAppearancePreset(presetKey);
        if (!preset) throw new NotFoundError("Bilinmeyen `presetKey`.");
        data = { presetKey, ...preset.values };
      } else {
        data = { presetKey: null, ...COLOR_TYPOGRAPHY_DEFAULTS };
      }

      // Özel CSS/JS bu işlemden ETKİLENMEZ (bilinçli karar, §10.12.2) — `SiteCustomCode`'a hiç
      // dokunulmaz.
      const row = await app.prisma.siteAppearance.upsert({
        where: { id: APPEARANCE_ID },
        create: { id: APPEARANCE_ID, ...DEFAULTS, ...data },
        update: data,
        ...WITH_HEADER_MEDIA,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "appearance.reset",
        targetType: "SiteAppearance",
        targetId: APPEARANCE_ID,
        metadata: { presetKey },
        ipAddress: request.ip,
      });

      return reply.send(ok(toSiteAppearanceDto(row)));
    }
  );

  // ---------------------------------------------------------------------------
  // §10.12.6 Özel CSS/JS — kontrattaki EN YÜKSEK RİSKLİ yüzey (kaydedilen metin her ziyaretçinin
  // tarayıcısında same-origin çalışır). Okuma authenticated'tır (kod zaten public HTML kaynağında
  // görünür olduğundan kısıtlamak güvenlik tiyatrosu olurdu); yazma YALNIZCA ADMIN + kill switch.
  // ---------------------------------------------------------------------------

  server.get("/custom-code", { schema: { response: { 200: ApiSuccessSchema(SiteCustomCodeSchema) } } }, async (_request, reply) => {
    const row = await readCustomCode(app);
    return reply.send(ok(toSiteCustomCodeDto(row, env.CUSTOM_CODE_ENABLED)));
  });

  server.put(
    "/custom-code/css",
    {
      preHandler: requireSiteRole("ADMIN"),
      config: { rateLimit: CUSTOM_CODE_RATE_LIMIT },
      schema: { body: UpdateCustomCssRequestSchema, response: { 200: ApiSuccessSchema(SiteCustomCodeSchema) } },
    },
    async (request, reply) => {
      // Kill switch (§10.12.6) — false iken İKİ PUT ucu da 403 döner; saklı değer KORUNUR ve
      // yönetim ucunda (GET /admin/appearance/custom-code) görünmeye devam eder.
      if (!env.CUSTOM_CODE_ENABLED) {
        throw new ForbiddenError("Özel kod düzenleme bu ortamda kapatılmıştır (CUSTOM_CODE_ENABLED=false).");
      }

      const { css, acknowledged } = request.body;
      const now = new Date();
      const row = await app.prisma.siteCustomCode.upsert({
        where: { id: CUSTOM_CODE_ID },
        create: { id: CUSTOM_CODE_ID, customCss: css, cssUpdatedById: request.user!.id, cssUpdatedAt: now },
        update: { customCss: css, cssUpdatedById: request.user!.id, cssUpdatedAt: now },
        ...WITH_CUSTOM_CODE_UPDATERS,
      });

      // Kod GÖVDESİ audit metadata'sına YAZILMAZ — 50 KB'lık bir blob'u denetim kaydında
      // çoğaltmak yerine sha256 özeti tutulur (§10.12.6).
      const value = css ?? "";
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "appearance.custom_css.update",
        targetType: "SiteCustomCode",
        targetId: CUSTOM_CODE_ID,
        metadata: { length: value.length, sha256: sha256(value), acknowledged },
        ipAddress: request.ip,
      });

      return reply.send(ok(toSiteCustomCodeDto(row, env.CUSTOM_CODE_ENABLED)));
    }
  );

  server.put(
    "/custom-code/js",
    {
      preHandler: requireSiteRole("ADMIN"),
      config: { rateLimit: CUSTOM_CODE_RATE_LIMIT },
      schema: { body: UpdateCustomJsRequestSchema, response: { 200: ApiSuccessSchema(SiteCustomCodeSchema) } },
    },
    async (request, reply) => {
      if (!env.CUSTOM_CODE_ENABLED) {
        throw new ForbiddenError("Özel kod düzenleme bu ortamda kapatılmıştır (CUSTOM_CODE_ENABLED=false).");
      }

      const { js, acknowledged } = request.body;
      const now = new Date();
      const row = await app.prisma.siteCustomCode.upsert({
        where: { id: CUSTOM_CODE_ID },
        create: { id: CUSTOM_CODE_ID, customJs: js, jsUpdatedById: request.user!.id, jsUpdatedAt: now },
        update: { customJs: js, jsUpdatedById: request.user!.id, jsUpdatedAt: now },
        ...WITH_CUSTOM_CODE_UPDATERS,
      });

      const value = js ?? "";
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "appearance.custom_js.update",
        targetType: "SiteCustomCode",
        targetId: CUSTOM_CODE_ID,
        metadata: { length: value.length, sha256: sha256(value), acknowledged },
        ipAddress: request.ip,
      });

      return reply.send(ok(toSiteCustomCodeDto(row, env.CUSTOM_CODE_ENABLED)));
    }
  );
}
