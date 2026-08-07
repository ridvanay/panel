import { z } from "zod";

export const UpdateSiteSettingsRequestSchema = z.object({
  siteName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
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
