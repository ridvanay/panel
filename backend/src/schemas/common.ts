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

/**
 * `ApiSuccessSchema`'nın aksine `meta`'yı SERBEST/keyfi bir şemayla tanımlar. Zod'un
 * varsayılan (strip) davranışı, response serialization sırasında `metaSchema`'da
 * TANIMLANMAMIŞ anahtarları sessizce düşürür — `ApiSuccessSchema`'daki dar
 * `{nextCursor}` şeması `meta.counts` gibi ek alanları bu yüzden kaybederdi.
 * Mevcut çağrı yerlerini bozmamak için `ApiSuccessSchema` DEĞİŞTİRİLMEDİ, bunun
 * yerine `meta`'sı zengin olan uçlar (bkz. §10.7 `GET /admin/{pages,blog}`) bu
 * yardımcıyı kullanır.
 */
export function ApiSuccessWithMeta<T extends z.ZodTypeAny, M extends z.ZodTypeAny>(dataSchema: T, metaSchema: M) {
  return z.object({
    data: dataSchema,
    meta: metaSchema,
  });
}

export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * §10.7 İçerik Yönetim Listesi — `GET /admin/{pages,blog}` çöp kutusu filtresi.
 * `exclude` (varsayılan) = yalnızca `deletedAt IS NULL`; `include` = çöptekiler
 * dahil tümü; `only` = yalnızca çöp (bkz. openapi.yaml#/components/parameters/TrashedFilter).
 */
export const TrashedFilterSchema = z.enum(["exclude", "include", "only"]).default("exclude");

/**
 * Sunucu taraflı durum filtresi — v1 admin liste ekranı KULLANMAZ (sekmeler
 * client-side filtrelenir), API tüketicileri ve ileriki sunucu-taraflı sayfalama
 * için eklenmiştir (bkz. openapi.yaml#/components/parameters/ContentStatusFilter).
 */
export const ContentListQuerySchema = CursorQuerySchema.extend({
  trashed: TrashedFilterSchema,
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

export const OrgIdParamSchema = z.object({
  orgId: z.string().uuid(),
});

export const OrgMemberParamSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const EmptyResponseSchema = z.undefined();
