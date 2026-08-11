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
});
export type PermissionsMatrixDto = z.infer<typeof PermissionsMatrixSchema>;
