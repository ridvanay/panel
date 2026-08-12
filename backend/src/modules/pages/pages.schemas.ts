import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";
import { refineScheduledAt, SCHEDULED_AT_REFINEMENT } from "../../schemas/common";

export const PageIdParamSchema = z.object({
  pageId: z.string().uuid(),
});

export const PageSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const PageRevisionIdParamSchema = z.object({
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

// §9 backend-agent madde 2 — ortak `LocaleQuerySchema` artık `schemas/common.ts`'te (bkz. o
// dosya) — burada KOPYALANMIŞ, sabit `z.enum(["EN"])` şeması KALDIRILDI. Diğer route dosyaları
// da aynı şemayı import eder.
export { LocaleQuerySchema } from "../../schemas/common";

const BlockSchema = z.record(z.unknown());

// §9 backend-agent madde 5 — locale bazında `null` = çeviriyi SİL (bkz. openapi.yaml
// `ContentTranslations` açıklaması, lib/localization.ts::mergeTranslations).
const TranslationsSchema = z.record(z.string(), z.record(z.string(), z.unknown()).nullable());

export const CreatePageRequestSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    status: PageStatusSchema.optional(),
    blocks: z.array(BlockSchema).optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    // §10.2 Gelişmiş SEO & Social Card — boş string yerine `null` kabul edilir (frontend boşsa null gönderir).
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    // §5.1 hukuki belge istisnası — YALNIZCA SiteRole=ADMIN gönderebilir (EDITOR → 403, bkz.
    // pages.routes.ts::assertLegalDocumentAuthorized).
    isLegalDocument: z.boolean().optional(),
    // §10.5 Çoklu Dil & Yerelleştirme — bkz. shared-types.ts::PageTranslations.
    translations: TranslationsSchema.optional(),
    // §10.7 — verilmezse giriş yapmış kullanıcı atanır; BAŞKA bir id yalnızca ADMIN'e açıktır (bkz. lib/content-author.ts).
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);

/**
 * Faz 3 (autosave) — `POST /admin/pages/:pageId/autosave`. `UpdatePageRequestSchema`'nın
 * bilinçli olarak DAR bir alt kümesi: SEO/durum/slug/çeviri kapsam DIŞI. NOT: mimari kontrat
 * blog için `excerpt`/`contentHtml` alanlarını referans alıyor, ancak `Page` modelinde bu
 * alanlar YOK — sayfanın içerik alanı `blocks`'tur, bu yüzden burada `title`/`blocks`
 * kullanılır (aynı korumaya-değer-alan-seti niyeti, Page şemasına uyarlanmış hali).
 */
export const AutosavePageRequestSchema = z.object({
  title: z.string().min(1).optional(),
  blocks: z.array(BlockSchema).optional(),
});

export const UpdatePageRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    status: PageStatusSchema.optional(),
    blocks: z.array(BlockSchema).optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    // §5.1 hukuki belge istisnası — YALNIZCA SiteRole=ADMIN gönderebilir (EDITOR → 403). Değeri
    // DEĞİŞTİREN her istek `content.legal_flag_change` audit kaydı üretir (bkz. pages.routes.ts).
    isLegalDocument: z.boolean().optional(),
    translations: TranslationsSchema.optional(),
    // §10.7 — yalnızca ADMIN değiştirebilir (EDITOR gönderirse 403); `null` = yazarı kaldır.
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);
