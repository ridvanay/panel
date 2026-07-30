import { z } from "zod";

/** docs/architecture/openapi.yaml #/components/schemas/ApiErrorEnvelope ile birebir. */
export const ApiErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.record(z.array(z.string())).optional(),
  }),
});

export function ApiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    meta: z
      .object({
        nextCursor: z.string().nullable(),
      })
      .partial()
      .optional(),
  });
}

export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const OrgIdParamSchema = z.object({
  orgId: z.string().uuid(),
});

export const OrgMemberParamSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const EmptyResponseSchema = z.undefined();
