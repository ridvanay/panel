import { z } from "zod";

export const UpdateSiteSettingsRequestSchema = z.object({
  siteName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
});
