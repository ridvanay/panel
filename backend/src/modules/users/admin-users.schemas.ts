import { z } from "zod";
import { SiteRoleSchema, SiteUserStatusSchema } from "../../schemas/entities";

export const AdminUserIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const CreateAdminUserRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: SiteRoleSchema.optional(),
});

export const UpdateAdminUserRoleRequestSchema = z.object({
  role: SiteRoleSchema,
});

export const UpdateAdminUserStatusRequestSchema = z.object({
  status: SiteUserStatusSchema,
});
