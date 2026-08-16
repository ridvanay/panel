import { z } from "zod";
import { CursorQuerySchema, LocaleQuerySchema } from "../../schemas/common";

/**
 * §10.13.5 madde 1 — görünürlük filtresi (`status = PUBLISHED AND deletedAt IS NULL`) sunucuda
 * SABİTTİR. `?status=`/`?trashed=` gibi parametreler bu katmanda TANIMLANMAZ (admin listelerindeki
 * filtreler buraya KOPYALANMAZ) — bilinmeyen bir query parametresi Zod'un varsayılan (strip)
 * davranışıyla sessizce YOK SAYILIR, 422 ÜRETMEZ (mevcut public uçlarla aynı tolerans).
 */
export const PublicListQuerySchema = CursorQuerySchema.merge(LocaleQuerySchema);

export const PublicListWithCategoryQuerySchema = PublicListQuerySchema.extend({
  category: z.string().min(1).optional(),
});

export const PublicSlugParamSchema = z.object({
  slug: z.string().min(1),
});
