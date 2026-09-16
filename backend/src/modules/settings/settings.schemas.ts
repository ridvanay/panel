import { z } from "zod";

export const UpdateSiteSettingsRequestSchema = z
  .object({
    siteName: z.string().trim().max(200).optional(),
    logoUrl: z.string().nullable().optional(),
    tagline: z.string().trim().max(160).nullable().optional(),
    // Header logo boyutu — ui-designer spesifikasyonu: yükseklik 16-96px (varsayılan 32, frontend'de),
    // maks-genişlik 40-400px opsiyonel (null = sınırsız).
    headerLogoHeight: z.number().int().min(16).max(96).nullable().optional(),
    headerLogoMaxWidth: z.number().int().min(40).max(400).nullable().optional(),
    homePageId: z.string().uuid().nullable().optional(),
    // §Faz 4 Site Şablonu — bkz. prisma/schema.prisma::SiteSettings.siteTemplate (db-agent).
    siteTemplate: z.enum(["SHOWCASE", "COMMERCE", "PORTFOLIO"]).optional(),
    // §3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — mağaza geneli SABİT
    // kargo bedeli + ücretsiz kargo eşiği. `null` = kargo hiç hesaplanmaz/eşik yok.
    shippingFlatFeeCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    freeShippingThresholdCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    // §2.5 (.claude/architect-scope-products-catalog.md, bağlayıcı) — tahmini teslimat süresi
    // (iş günü). `Max < Min` çapraz-alan kuralı yalnızca İKİSİ DE aynı istekte gönderildiğinde
    // burada doğrulanabilir; tek başına gönderilirse mevcut satıra karşı route handler'da
    // çapraz kontrol edilir (`discountPriceCents` ile AYNI desen).
    shippingEstimatedDaysMin: z.number().int().min(0).max(90).nullable().optional(),
    shippingEstimatedDaysMax: z.number().int().min(0).max(90).nullable().optional(),
    // `.claude/security-review-demo-payment-toggle.md` Madde 2/3 — HAM DB sütununa yazar
    // (`demoPaymentsSupported`e YAZILAMAZ, o env'den hesaplı, salt-okunur bir mapper alanıdır).
    // `demoPaymentsSupported=false` (üretim) iken bu istek REDDEDİLMEZ (`422` DEĞİL) — ham
    // sütun yazılır ama nihai bayrak `env.ts`teki fail-closed koruma nedeniyle `false` kalır.
    demoPaymentsEnabled: z.boolean().optional(),
    // NOT — 2026-09-15: Sağ alt canlı destek widget'ı — HAM DB sütununa yazılır. `provider`
    // API seviyesinde frontend'in sunduğu 3 seçenekle KISITLANIR (DB'de serbest metin,
    // bkz. prisma/schema.prisma notu) — geçersiz bir değer `422` döner.
    liveChatEnabled: z.boolean().optional(),
    liveChatProvider: z.enum(["internal", "crisp", "tawkto"]).optional(),
    liveChatScriptId: z.string().trim().max(200).nullable().optional(),
    // Ön görüşme (pre-chat) formu — `.claude/architect-scope-support-desk-and-reminders.md`
    // §7.1/§7.3. HAM DB sütunlarına yazılır, çapraz-alan doğrulaması YOK (üçü de `false` olabilir).
    liveChatPreChatEnabled: z.boolean().optional(),
    liveChatRequireName: z.boolean().optional(),
    liveChatRequirePhone: z.boolean().optional(),
    liveChatRequireEmail: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.shippingEstimatedDaysMin == null ||
      data.shippingEstimatedDaysMax == null ||
      data.shippingEstimatedDaysMax >= data.shippingEstimatedDaysMin,
    {
      message: "shippingEstimatedDaysMax, shippingEstimatedDaysMin değerinden küçük olamaz.",
      path: ["shippingEstimatedDaysMax"],
    }
  );

// ---------------------------------------------------------------------------
// E-posta (SMTP) yapılandırması — `.claude/architect-scope-smtp-settings.md` §5 +
// `.claude/security-review-smtp-settings.md` KARAR 2 (bağlayıcı, mimarın önerisini SIKILAŞTIRDI).
// ---------------------------------------------------------------------------

/** KARAR 2.3 (bağlayıcı, DEĞİŞTİRİLMEDİ) — serbest port aralığı ucu bir port tarayıcısına çevirir. */
export const SMTP_ALLOWED_PORTS = [25, 465, 587, 2525] as const;

export const UpdateEmailSettingsRequestSchema = z.object({
  // `smtpHost` (mevcut satırdaki veya AYNI istekte gönderilen) boşken `true` → route handler'da
  // 422 (§3.3, `settings.routes.ts::assertShippingEstimateRange` İLE AYNI "çapraz alan, mevcut
  // satıra karşı" deseni — bkz. settings.email.routes.ts::assertEmailEnabledHasHost).
  enabled: z.boolean().optional(),
  // KARAR 2.2 — boşluk/kontrol karakteri/şema/kimlik-bilgisi/port-eki içermemesi VE IP literal ya
  // da RFC1123 host adı deseni olması `lib/smtp-host-guard.ts::validateSmtpHost`'ta AYRICA
  // doğrulanır (ağ çağrısı gerektirdiği için route handler'da, zod refine'da DEĞİL). Buradaki
  // `min(1)` yalnızca "boş string" durumunu (KARAR 2.2 son madde) erken/ucuz biçimde eler —
  // `trim()` KASITLI OLARAK UYGULANMAZ (baştaki/sondaki boşluk sessizce temizlenmez, KARAR 2.2
  // "boşluk" kuralına göre AÇIKÇA reddedilir).
  smtpHost: z.string().min(1).max(255).nullable().optional(),
  smtpPort: z
    .number()
    .int()
    .refine((port) => (SMTP_ALLOWED_PORTS as readonly number[]).includes(port), {
      message: "smtpPort yalnızca 25, 465, 587 veya 2525 olabilir.",
    })
    .optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(255).nullable().optional(),
  // Üç durumlu (bağlayıcı, §2.3.3): alan YOK → korunur; `null` → temizlenir; dolu string →
  // değiştirilir. Yer-tutucu sentinel (`"***"` vb.) YOKTUR — bu yüzden min(1) uygulanır (boş
  // string'in "temizle" anlamına gelmesi İSTENMEZ, `null` bunun için AYRI ve açık bir yoldur).
  smtpPassword: z.string().min(1).max(255).nullable().optional(),
  fromAddress: z.string().trim().email().nullable().optional(),
  fromName: z.string().trim().max(120).nullable().optional(),
});
export type UpdateEmailSettingsRequestDto = z.infer<typeof UpdateEmailSettingsRequestSchema>;

/** `POST /admin/settings/email/test` yanıtı — `sentTo` `lib/pii-mask.ts::maskEmail` ile maskelidir. */
export const EmailSettingsTestResponseSchema = z.object({
  sentTo: z.string(),
  messageId: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  testedAt: z.string(),
});
export type EmailSettingsTestResponseDto = z.infer<typeof EmailSettingsTestResponseSchema>;

/** `lib/permissions-matrix.ts::PERMISSIONS_MATRIX` şeklinin gevşek (literal'e bağlı olmayan) Zod karşılığı. */
export const PermissionsMatrixSchema = z.object({
  roles: z.array(z.string()),
  modules: z.array(
    z.object({
      module: z.string(),
      label: z.string(),
      actions: z.record(z.array(z.string())),
    })
  ),
  // §10.20 — bkz. openapi.yaml `PermissionsMatrix.capabilities`. Zod response şeması alanı
  // TANIMAMAZSA fastify-type-provider-zod serileştirme sırasında SESSİZCE düşürür — bu yüzden
  // `lib/permissions-matrix.ts::PERMISSIONS_MATRIX.capabilities` ile ŞEKİL PARİTESİ ZORUNLU.
  capabilities: z.array(
    z.object({
      key: z.literal("advancedBuilder"),
      label: z.string(),
      alwaysGrantedTo: z.array(z.string()),
      grantableTo: z.array(z.string()),
    })
  ),
});
export type PermissionsMatrixDto = z.infer<typeof PermissionsMatrixSchema>;
