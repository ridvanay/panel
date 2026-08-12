import { z } from "zod";
import { PageStatusSchema } from "./entities";

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
  // `PageStatusSchema` ile TEK kaynak — Faz 4 (zamanlanmış yayın) ile "SCHEDULED" eklendiğinde
  // burası da otomatik güncel kalır (bkz. schemas/entities.ts).
  status: PageStatusSchema.optional(),
});

export const OrgIdParamSchema = z.object({
  orgId: z.string().uuid(),
});

export const OrgMemberParamSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const EmptyResponseSchema = z.undefined();

/**
 * Faz 3 (autosave) — `POST /admin/{blog,pages}/:id/autosave` ortak yanıt şeması.
 * Bilinçli olarak minimal: autosave revizyon üretmez ve audit loglamaz (bkz.
 * lib/content-revisions.ts), bu yüzden tam entity DTO'sunu dönmenin bir faydası
 * yok — istemci yalnızca "en son ne zaman kaydedildi"yi bilmek ister.
 */
export const AutosaveResponseSchema = z.object({
  savedAt: z.string(),
});

/**
 * Faz 4 (zamanlanmış yayın) — `blog.schemas.ts`/`pages.schemas.ts`'teki create/update
 * gövdelerinde BİREBİR AYNI çapraz-alan kuralı (kod tekrarını önlemek için burada tek noktadan
 * paylaşılır): `status === "SCHEDULED"` İSE `scheduledAt` ZORUNLU ve GELECEKTE bir tarih olmalı;
 * aksi halde (`DRAFT`/`PUBLISHED`/status hiç gönderilmemişse) `scheduledAt` body'de gönderilse
 * dahi göz ardı edilir — route handler'da `null`'a temizlenir (bkz. blog.routes.ts/pages.routes.ts),
 * eski bir zamanlama artığı kalmasın diye.
 */
export function refineScheduledAt<T extends { status?: "DRAFT" | "PUBLISHED" | "SCHEDULED"; scheduledAt?: string | null }>(
  data: T
): boolean {
  if (data.status !== "SCHEDULED") return true;
  if (!data.scheduledAt) return false;
  return new Date(data.scheduledAt).getTime() > Date.now();
}

export const SCHEDULED_AT_REFINEMENT: { message: string; path: (string | number)[] } = {
  message: "SCHEDULED durumu için scheduledAt zorunludur ve gelecekte bir tarih olmalıdır.",
  path: ["scheduledAt"],
};

/**
 * §10.5 Çoklu Dil & Yerelleştirme — ortak `?locale=` query şeması (bkz.
 * .claude/architect-scope-i18n.md §9 backend-agent madde 2: `pages.schemas.ts`/
 * `blog.schemas.ts`'te KOPYALANMIŞ `z.enum(["EN"])` sabit şemasının yerini alır).
 * Bilinçli olarak SERBEST bir string kabul eder (regex/enum İLE SINIRLANMAZ) — geçersiz/
 * bilinmeyen bir kod openapi.yaml `LocaleQuery` sözleşmesi gereği `400`/`422` DEĞİL, sessiz
 * fallback üretmelidir; şema seviyesinde reddetmek bu kuralı ihlal ederdi (bkz.
 * lib/localization.ts::resolveEffectiveLocaleCode — asıl çözümleme/tolerans BURADA yapılır).
 */
export const LocaleQuerySchema = z.object({
  locale: z.string().min(1).optional(),
});
