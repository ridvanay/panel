import { z } from "zod";

export const UpdateSiteSettingsRequestSchema = z.object({
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
});

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
