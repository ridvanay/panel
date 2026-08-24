import { z } from "zod";
import {
  HexColorSchema,
  PageHeaderLayoutSchema,
  PageHeaderStyleSchema,
  SiteBorderRadiusSchema,
  SiteButtonStyleSchema,
  SiteFontSchema,
  SocialShareNetworkSchema,
} from "../../schemas/entities";

/**
 * `PATCH /admin/appearance` gövdesi — TÜM alanlar opsiyoneldir, yalnızca gönderilenler yazılır
 * (bkz. ARCHITECTURE.md §10.12.9 — panelin 9 bölümünün HEPSİ bu TEK ucu kullanır).
 *
 * `.strict()` — kontrat hakemlik kararı: `pageHeaderBackgroundUrl` (türetilmiş/salt-okunur alan)
 * veya `customCss`/`customJs` (kendi ayrı PUT uçları var) gönderilirse sessizce yok saymak yerine
 * 422 döner (openapi.yaml `UpdateSiteAppearanceRequest` açıklaması — "gönderilirse 422 alınır").
 */
export const UpdateSiteAppearanceRequestSchema = z
  .object({
    presetKey: z.string().nullable().optional(),
    pageHeaderStyle: PageHeaderStyleSchema.optional(),
    pageHeaderLayout: PageHeaderLayoutSchema.optional(),
    pageHeaderBackgroundColor: HexColorSchema.nullable().optional(),
    // Var olmayan bir medya id'si → 404 NOT_FOUND (route handler'da kontrol edilir, kısmi
    // yazma YAPILMAZ — bkz. appearance.routes.ts).
    pageHeaderBackgroundMediaId: z.string().uuid().nullable().optional(),
    pageHeaderOverlayOpacity: z.number().int().min(0).max(100).optional(),
    primaryColor: HexColorSchema.optional(),
    secondaryColor: HexColorSchema.optional(),
    buttonColor: HexColorSchema.optional(),
    buttonTextColor: HexColorSchema.optional(),
    linkColor: HexColorSchema.optional(),
    accentColor: HexColorSchema.optional(),
    backgroundColor: HexColorSchema.optional(),
    surfaceColor: HexColorSchema.optional(),
    textColor: HexColorSchema.optional(),
    mutedTextColor: HexColorSchema.optional(),
    headingFont: SiteFontSchema.optional(),
    bodyFont: SiteFontSchema.optional(),
    baseFontSize: z.number().int().min(14).max(20).optional(),
    borderRadius: SiteBorderRadiusSchema.optional(),
    buttonStyle: SiteButtonStyleSchema.optional(),
    socialShareEnabled: z.boolean().optional(),
    // Tam değiştirme (replace) semantiği — gönderilen dizi mevcut seçimin YERİNE geçer,
    // birleştirilmez. Yinelenen değerler sunucuda tekilleştirilir (bkz. appearance.routes.ts).
    socialShareNetworks: z.array(SocialShareNetworkSchema).optional(),
    backToTopEnabled: z.boolean().optional(),
    stickyHeaderEnabled: z.boolean().optional(),
    cookieBannerEnabled: z.boolean().optional(),
    cookieBannerText: z.string().trim().max(500).nullable().optional(),
    cookieBannerPolicyHref: z.string().trim().max(2048).nullable().optional(),
    maintenanceModeEnabled: z.boolean().optional(),
    maintenanceMessage: z.string().trim().max(500).nullable().optional(),
    notFoundTitle: z.string().trim().max(120).nullable().optional(),
    notFoundMessage: z.string().trim().max(500).nullable().optional(),
    notFoundButtonLabel: z.string().trim().max(60).nullable().optional(),
    notFoundButtonHref: z.string().trim().max(2048).nullable().optional(),
  })
  .strict(
    "Bilinmeyen alan gönderildi — `pageHeaderBackgroundUrl` türetilmiş/salt-okunurdur, `customCss`/`customJs` kendi PUT uçlarını kullanır (bkz. /admin/appearance/custom-code/*)."
  );
export type UpdateSiteAppearanceRequest = z.infer<typeof UpdateSiteAppearanceRequestSchema>;

export const ResetAppearanceRequestSchema = z.object({
  // Verilirse o ön ayarın değerlerine, verilmezse/null ise fabrika DEFAULTS'una dönülür.
  // Özel CSS/JS HİÇBİR durumda etkilenmez (bkz. appearance.routes.ts).
  presetKey: z.string().nullable().optional(),
});
export type ResetAppearanceRequest = z.infer<typeof ResetAppearanceRequestSchema>;

/**
 * `GET /admin/appearance/presets` öğesi — kod içi statik `lib/appearance-presets.ts` kaydı
 * (DB tablosu YOKTUR, bkz. ARCHITECTURE.md §10.12.3). `values` yalnızca renk/tipografi alanları
 * taşır ama şema düzeyinde `UpdateSiteAppearanceRequestSchema`'nın TAMAMINI kabul eder (openapi.yaml
 * `AppearancePreset.values` — `allOf: [UpdateSiteAppearanceRequest]`).
 */
export const AppearancePresetSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  values: UpdateSiteAppearanceRequestSchema,
});
export type AppearancePresetDto = z.infer<typeof AppearancePresetSchema>;

// §10.12.6 Özel CSS/JS — `acknowledged` kuralı SUNUCUDA ZORLANIR (yalnızca arayüzdeki bir onay
// kutusu doğrudan API çağrısıyla atlanabilirdi): gövde BOŞ DEĞİLSE (`null`/`""` DEĞİLSE)
// `acknowledged: true` ZORUNLUDUR, aksi hâlde 422 VALIDATION_ERROR. Kod TEMİZLENİRKEN
// (`null`/`""`) onay ARANMAZ — kod kaldırmak her zaman güvenlidir.

export const UpdateCustomCssRequestSchema = z
  .object({
    // Belgenin TAMAMI (PUT). `null` veya `""` = özel CSS'i kaldır.
    css: z.string().max(50000, "En fazla 50.000 karakter olabilir.").nullable(),
    acknowledged: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const isEmpty = data.css === null || data.css === "";
    if (!isEmpty && data.acknowledged !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acknowledged"],
        message: "`css` boş değilse `acknowledged: true` gönderilmelidir.",
      });
    }
  });
export type UpdateCustomCssRequest = z.infer<typeof UpdateCustomCssRequestSchema>;

export const UpdateCustomJsRequestSchema = z
  .object({
    // Belgenin TAMAMI (PUT). `null` veya `""` = özel JS'i kaldır. Sınır CSS'ten (50.000) düşüktür:
    // bu metin her sayfaya gömülür ve doğrudan sayfa ağırlığıdır.
    js: z.string().max(20000, "En fazla 20.000 karakter olabilir.").nullable(),
    acknowledged: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const isEmpty = data.js === null || data.js === "";
    if (!isEmpty && data.acknowledged !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acknowledged"],
        message: "`js` boş değilse `acknowledged: true` gönderilmelidir.",
      });
    }
  });
export type UpdateCustomJsRequest = z.infer<typeof UpdateCustomJsRequestSchema>;
