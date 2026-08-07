import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";
import { ContentListQuerySchema, refineScheduledAt, SCHEDULED_AT_REFINEMENT } from "../../schemas/common";

export const PortfolioItemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});

export const PortfolioItemSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const PortfolioCategoryIdParamSchema = z.object({
  categoryId: z.string().uuid(),
});

/**
 * `GET /admin/portfolio` — `ContentListQuerySchema` (cursor/limit/trashed/status, products.schemas.ts
 * ile ORTAK) + portföye özel serbest metin arama (`title`/`clientName` üzerinde, bkz. portfolio.routes.ts).
 */
export const ListPortfolioItemsQuerySchema = ContentListQuerySchema.extend({
  search: z.string().min(1).optional(),
});

const TranslationsSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export const CreatePortfolioItemRequestSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    summary: z.string().optional(),
    contentHtml: z.string().optional(),
    clientName: z.string().min(1).nullable().optional(),
    projectUrl: z.string().url().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    // Manuel sıralama (kullanıcı kararı) — bkz. prisma/schema.prisma::PortfolioItem.order.
    order: z.number().int().optional(),
    status: PageStatusSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    coverMediaId: z.string().uuid().nullable().optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    // §10.2 Gelişmiş SEO & Social Card — boş string yerine `null` kabul edilir.
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    // §10.5 Çoklu Dil & Yerelleştirme.
    translations: TranslationsSchema.optional(),
    // §10.7 — `CreateBlogPostRequest.authorId` ile aynı kural (bkz. lib/content-author.ts).
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);

export const UpdatePortfolioItemRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    summary: z.string().nullable().optional(),
    contentHtml: z.string().optional(),
    clientName: z.string().min(1).nullable().optional(),
    projectUrl: z.string().url().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    order: z.number().int().optional(),
    status: PageStatusSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    coverMediaId: z.string().uuid().nullable().optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    translations: TranslationsSchema.optional(),
    // §10.7 — yalnızca ADMIN değiştirebilir.
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);

export const CreatePortfolioCategoryRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

export const UpdatePortfolioCategoryRequestSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});
