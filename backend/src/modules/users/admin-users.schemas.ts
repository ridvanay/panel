import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { SiteRoleSchema, SiteUserStatusSchema } from "../../schemas/entities";

export const AdminUserIdParamSchema = z.object({
  userId: z.string().uuid(),
});

/**
 * `GET /admin/users` query — varsayılan olarak `DELETED` kullanıcılar dışarıda bırakılır
 * (bkz. openapi.yaml `includeDeleted`). Fastify querystring string olarak geldiği için
 * `z.coerce.boolean()` DEĞİL, açık "true" karşılaştırması kullanılır — `z.coerce.boolean()`
 * boş olmayan HER string'i (ör. "false") `true` yapardı.
 */
export const ListAdminUsersQuerySchema = CursorQuerySchema.extend({
  includeDeleted: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
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
