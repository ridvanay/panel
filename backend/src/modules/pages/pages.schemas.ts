import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";

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

/** TR = kanonik/varsayılan; şimdilik tek ek dil (bkz. ARCHITECTURE.md §10.5). */
export const LocaleQuerySchema = z.object({
  locale: z.enum(["EN"]).optional(),
});

const BlockSchema = z.record(z.unknown());

const TranslationsSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export const CreatePageRequestSchema = z.object({
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
  // §10.5 Çoklu Dil & Yerelleştirme — bkz. shared-types.ts::PageTranslations.
  translations: TranslationsSchema.optional(),
  // §10.7 — verilmezse giriş yapmış kullanıcı atanır; BAŞKA bir id yalnızca ADMIN'e açıktır (bkz. lib/content-author.ts).
  authorId: z.string().uuid().nullable().optional(),
});

export const UpdatePageRequestSchema = z.object({
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
  translations: TranslationsSchema.optional(),
  // §10.7 — yalnızca ADMIN değiştirebilir (EDITOR gönderirse 403); `null` = yazarı kaldır.
  authorId: z.string().uuid().nullable().optional(),
});
