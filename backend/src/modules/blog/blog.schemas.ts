import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";
import { refineScheduledAt, SCHEDULED_AT_REFINEMENT } from "../../schemas/common";

export const PostIdParamSchema = z.object({
  postId: z.string().uuid(),
});

export const PostSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const CategoryIdParamSchema = z.object({
  categoryId: z.string().uuid(),
});

// §10.14.3 — `BlogTag` uçları için parametre şeması, `CategoryIdParamSchema` ile birebir simetrik.
export const TagIdParamSchema = z.object({
  tagId: z.string().uuid(),
});

export const PostRevisionIdParamSchema = z.object({
  postId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

// §9 backend-agent madde 2 — ortak `LocaleQuerySchema` artık `schemas/common.ts`'te.
export { LocaleQuerySchema } from "../../schemas/common";

// §9 backend-agent madde 5 — locale bazında `null` = çeviriyi SİL.
const TranslationsSchema = z.record(z.string(), z.record(z.string(), z.unknown()).nullable());

// §10.14.4 — üst sınır 50 etiket/yazı; sınırsız dizi sınırsız yazma demektir. Tekrar eden id'ler
// backend-agent tarafında sessizce tekilleştirilir (istek reddedilmez).
const TagIdsSchema = z.array(z.string().uuid()).max(50);

export const CreateBlogPostRequestSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    excerpt: z.string().optional(),
    contentHtml: z.string().optional(),
    coverImageUrl: z.string().optional(),
    status: PageStatusSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    // §10.14.4 — verilmezse yazı etiketsiz oluşur (create'te `undefined` ≠ `[]` ayrımı anlamsızdır,
    // çünkü henüz mevcut bir set yoktur — ayrım yalnızca UPDATE'te bağlayıcıdır).
    tagIds: TagIdsSchema.optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    // §10.2 Gelişmiş SEO & Social Card — boş string yerine `null` kabul edilir (frontend boşsa null gönderir).
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    // §10.5 Çoklu Dil & Yerelleştirme — bkz. shared-types.ts::BlogPostTranslations.
    translations: TranslationsSchema.optional(),
    // §10.7 — `CreatePageRequest.authorId` ile aynı kural (bkz. lib/content-author.ts).
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);

export const UpdateBlogPostRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    excerpt: z.string().nullable().optional(),
    contentHtml: z.string().optional(),
    coverImageUrl: z.string().nullable().optional(),
    status: PageStatusSchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    // §10.14.4 — TAM SET (replace), delta DEĞİL. Gönderilmezse (`undefined`) etiketlere
    // DOKUNULMAZ; `[]` tüm etiketleri kaldırır. Bu ayrım Hızlı Düzenle'nin kısmi gövde
    // sözleşmesi için bağlayıcıdır.
    tagIds: TagIdsSchema.optional(),
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

/**
 * Faz 3 (autosave) — `POST /admin/blog/:postId/autosave`. `UpdateBlogPostRequestSchema`'nın
 * bilinçli olarak DAR bir alt kümesi: SEO/durum/slug/kategori/çeviri gibi alanlar autosave'in
 * kapsamı DIŞINDA tutulur (yalnızca kullanıcının aktif düzenlediği metin alanları korunur).
 */
export const AutosaveBlogPostRequestSchema = z.object({
  title: z.string().min(1).optional(),
  excerpt: z.string().nullable().optional(),
  contentHtml: z.string().optional(),
});

export const CreateBlogCategoryRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

export const UpdateBlogCategoryRequestSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});

// §10.14.3 — `BlogCategory` istek şemalarıyla birebir simetrik, tek fark `name` üst sınırı (60).
export const CreateBlogTagRequestSchema = z.object({
  name: z.string().min(1).max(60),
  slug: z.string().min(1).optional(),
});

export const UpdateBlogTagRequestSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  slug: z.string().min(1).optional(),
});
