import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { ApiKeyScopeSchema, ApiKeyStatusSchema } from "../../schemas/entities";

export const ApiKeyIdParamSchema = z.object({
  keyId: z.string().uuid(),
});

export const ListApiKeysQuerySchema = CursorQuerySchema.extend({
  status: ApiKeyStatusSchema.optional(),
});

export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  scope: ApiKeyScopeSchema.default("READ"),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .refine((value) => !value || new Date(value).getTime() > Date.now(), {
      message: "expiresAt gelecekte bir tarih olmalıdır.",
    }),
});
export type CreateApiKeyRequestDto = z.infer<typeof CreateApiKeyRequestSchema>;

export const UpdateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  scope: ApiKeyScopeSchema.optional(),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .refine((value) => !value || new Date(value).getTime() > Date.now(), {
      message: "expiresAt gelecekte bir tarih olmalıdır.",
    }),
});
export type UpdateApiKeyRequestDto = z.infer<typeof UpdateApiKeyRequestSchema>;
