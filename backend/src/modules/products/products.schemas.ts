import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";
import { ContentListQuerySchema, refineScheduledAt, SCHEDULED_AT_REFINEMENT } from "../../schemas/common";
import { ProductVariantOptionsSchema } from "./lib/variants";

export const ProductIdParamSchema = z.object({
  productId: z.string().uuid(),
});

export const ProductSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const ProductCategoryIdParamSchema = z.object({
  categoryId: z.string().uuid(),
});

export const ProductImageIdParamSchema = z.object({
  productId: z.string().uuid(),
  imageId: z.string().uuid(),
});

export const ProductVariantIdParamSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
});

export const ProductDocumentIdParamSchema = z.object({
  productId: z.string().uuid(),
  documentId: z.string().uuid(),
});

export const ProductRevisionIdParamSchema = z.object({
  productId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

/** `POST /:productId/images` — galeriye tek bir Media ekler (bkz. products.routes.ts). */
export const AddProductImageRequestSchema = z.object({
  mediaId: z.string().uuid(),
});

/** `POST /:productId/variants` gövdesi — `optionValues` ZORUNLU (bkz. lib/variants.ts). */
export const CreateProductVariantRequestSchema = z.object({
  optionValues: z.record(z.string(), z.string()),
  sku: z.string().min(1).max(64).nullable().optional(),
  priceCents: z.number().int().positive().nullable().optional(),
  discountPriceCents: z.number().int().positive().nullable().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  mediaId: z.string().uuid().nullable().optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/**
 * `PATCH /:productId/variants/:variantId` gövdesi — `optionValues` BURADAN DEĞİŞTİRİLEMEZ:
 * kombinasyon değişecekse satır silinip yeniden oluşturulmalıdır (openapi.yaml notu). `.strict()`
 * — gövdeye `optionValues` (ya da başka bilinmeyen bir alan) eklenirse 422 döner (`UpdateMediaAlt
 * TextRequestSchema` ile AYNI kontrat hakemliği kararı).
 */
export const UpdateProductVariantRequestSchema = z
  .object({
    sku: z.string().min(1).max(64).nullable().optional(),
    priceCents: z.number().int().positive().nullable().optional(),
    discountPriceCents: z.number().int().positive().nullable().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    mediaId: z.string().uuid().nullable().optional(),
    order: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict("`optionValues` bu uçtan değiştirilemez — kombinasyon değişecekse satır silinip yeniden oluşturulmalıdır.");

/** `POST /:productId/documents` gövdesi — `mediaId` `application/pdf` DEĞİLSE 422 (route handler). */
export const AddProductDocumentRequestSchema = z.object({
  mediaId: z.string().uuid(),
  title: z.string().min(1).max(160).optional(),
});

/**
 * `GET /admin/products` — `ContentListQuerySchema` (cursor/limit/trashed/status, blog/pages ile
 * ORTAK) + ürünlere özel serbest metin arama (`title`/`sku` üzerinde, bkz. products.routes.ts).
 */
export const ListProductsQuerySchema = ContentListQuerySchema.extend({
  search: z.string().min(1).optional(),
});

// §9 backend-agent madde 5 — locale bazında `null` = çeviriyi SİL.
const TranslationsSchema = z.record(z.string(), z.record(z.string(), z.unknown()).nullable());

// §9 backend-agent madde 1 — Product public GET'lerinde `translations` yazılabiliyordu ama
// okunamıyordu (§0.1b); ortak `LocaleQuerySchema` artık burada da kullanılır.
export { LocaleQuerySchema } from "../../schemas/common";

/**
 * `discountPriceCents` verilmişse `priceCents`'ten KÜÇÜK olmalı (bkz. ARCHITECTURE.md §10.9.2).
 * Yalnızca İKİ ALAN DA aynı istekte gönderildiğinde burada doğrulanabilir — `discountPriceCents`
 * tek başına (create'te `priceCents` her zaman zorunlu olduğu için sorun yok, update'te ise)
 * gönderilirse mevcut kayıttaki fiyata göre çapraz kontrol route handler'da yapılır (bkz.
 * products.routes.ts::assertDiscountBelowPrice).
 */
function refineDiscountBelowPrice(data: { priceCents?: number; discountPriceCents?: number | null }): boolean {
  if (data.discountPriceCents === undefined || data.discountPriceCents === null) return true;
  if (data.priceCents === undefined) return true;
  return data.discountPriceCents < data.priceCents;
}

const DISCOUNT_REFINEMENT = {
  message: "discountPriceCents, priceCents değerinden küçük olmalıdır.",
  path: ["discountPriceCents"] as (string | number)[],
};

export const CreateProductRequestSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    excerpt: z.string().optional(),
    descriptionHtml: z.string().optional(),
    // Para: HER ZAMAN kuruş/cent cinsinden pozitif tam sayı — float KESİNLİKLE YOK.
    priceCents: z.number().int().positive(),
    currency: z.string().min(1).optional(),
    taxRatePercent: z.number().min(0).max(100).nullable().optional(),
    discountPriceCents: z.number().int().positive().nullable().optional(),
    sku: z.string().min(1).nullable().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    // §1 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — verilmezse boş dizi
    // (varyasyonsuz ürün). Varyasyon SATIRLARI ayrı uçtan eklenir: `POST .../variants`.
    variantOptions: ProductVariantOptionsSchema.optional(),
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
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT)
  .refine(refineDiscountBelowPrice, DISCOUNT_REFINEMENT);

export const UpdateProductRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    excerpt: z.string().nullable().optional(),
    descriptionHtml: z.string().optional(),
    priceCents: z.number().int().positive().optional(),
    currency: z.string().min(1).optional(),
    taxRatePercent: z.number().min(0).max(100).nullable().optional(),
    discountPriceCents: z.number().int().positive().nullable().optional(),
    sku: z.string().min(1).nullable().optional(),
    stockQuantity: z.number().int().min(0).optional(),
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
    // §1 — eksen tanımlarını TAMAMEN DEĞİŞTİRİR (tam-replace). Mevcut `ProductVariant`
    // satırlarından herhangi birinin `optionValues`'ı yeni tanımla uyuşmuyorsa 409 CONFLICT
    // (route handler, önce varyasyonları silmek gerekir — sessizce yetim varyasyon BIRAKILMAZ).
    variantOptions: ProductVariantOptionsSchema.optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT)
  .refine(refineDiscountBelowPrice, DISCOUNT_REFINEMENT);

/**
 * `POST /admin/products/:productId/autosave` — `AutosaveProductRequest` (bkz. openapi.yaml).
 * `UpdateProductRequestSchema`'nın BİLİNÇLİ olarak DAR bir alt kümesi: ticari alanlar
 * (fiyat/indirim/SKU/stok/durum/slug/SEO/çeviri/`scheduledAt`) KAPSAM DIŞIDIR — fiyat/indirim
 * çapraz-alan kuralı ve `sku` tekilliği yarım kalmış bir taslak üzerinde 3 saniyede bir
 * doğrulanamaz (bkz. ARCHITECTURE.md §10.1). Bu uçtan gönderilseler dahi kabul EDİLMEZLER
 * (şema seviyesinde yokturlar).
 */
export const AutosaveProductRequestSchema = z.object({
  title: z.string().min(1).optional(),
  excerpt: z.string().nullable().optional(),
  descriptionHtml: z.string().optional(),
});

/** Admin'in elle stok düzeltmesi — checkout'un otomatik stok düşürmesiyle (Faz 2b) KARIŞTIRILMAMALI. */
export const AdjustProductStockRequestSchema = z.object({
  stockQuantity: z.number().int().min(0),
});

export const CreateProductCategoryRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

export const UpdateProductCategoryRequestSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});
