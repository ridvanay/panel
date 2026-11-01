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

// ---- Paket Z1 — tıbbi inceleme / zengin alanlar ----

/** Düz metin alanlarından (özet maddeleri, SSS) etiketleri ayıklar; React metin olarak render eder. */
function toPlainText(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const PlainTextSchema = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(toPlainText)
    .pipe(z.string().min(1).max(max));

export const MedicalReviewStatusSchema = z.enum(["not_required", "pending", "approved", "changes_requested"]);
export type MedicalReviewStatus = z.infer<typeof MedicalReviewStatusSchema>;

/** Admin/editör yalnızca bu iki değeri yazabilir: "approved"/"changes_requested" yalnızca hekim kuyruğundan gelir. */
export const AdminMedicalReviewStatusSchema = z.enum(["not_required", "pending"]);

export const KeyTakeawaysSchema = z.array(PlainTextSchema(400)).max(10);

export const FaqItemSchema = z.object({ question: PlainTextSchema(300), answer: PlainTextSchema(3000) });
export const FaqSchema = z.array(FaqItemSchema).max(20);

const HttpsUrlSchema = z
  .string()
  .max(2000)
  .url()
  .refine((value) => /^https:\/\//i.test(value), "Bağlantı https ile başlamalıdır.");

export const ReferenceSchema = z.object({
  title: PlainTextSchema(300),
  publisher: PlainTextSchema(200),
  url: HttpsUrlSchema,
  accessedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalıdır."),
});
export const ReferencesSchema = z.array(ReferenceSchema).max(30);

export const ReadingTimeRequestSchema = z.object({ html: z.string().max(2_000_000) });
export const ReadingTimeResponseSchema = z.object({ minutes: z.number().int().min(1) });

const BlogReviewFieldsSchema = {
  specialtyId: z.string().uuid().nullable().optional(),
  careTopicIds: z.array(z.string().uuid()).max(20).optional(),
  reviewerDoctorId: z.string().uuid().nullable().optional(),
  medicalReviewStatus: AdminMedicalReviewStatusSchema.optional(),
  keyTakeaways: KeyTakeawaysSchema.optional(),
  faq: FaqSchema.optional(),
  references: ReferencesSchema.optional(),
  isFeatured: z.boolean().optional(),
};

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
    ...BlogReviewFieldsSchema,
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
    ...BlogReviewFieldsSchema,
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
  isMedical: z.boolean().optional(),
});

export const UpdateBlogCategoryRequestSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  isMedical: z.boolean().optional(),
});

// ---- Paket Z1 — public liste/detay + doktor inceleme kuyruğu ----

export const PublicBlogListQuerySchema = z.object({
  locale: z.string().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  topic: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const ReviewPostIdParamSchema = z.object({ id: z.string().uuid() });

export const RequestChangesBodySchema = z.object({
  note: z
    .string()
    .max(4000)
    .transform(toPlainText)
    .pipe(z.string().min(1).max(2000)),
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
