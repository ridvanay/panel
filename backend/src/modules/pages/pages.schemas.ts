import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";
import { refineScheduledAt, SCHEDULED_AT_REFINEMENT } from "../../schemas/common";
import { flattenPageBlocks } from "../../lib/page-blocks";

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

// §10.17 Sayfa içerik bloklarında Grid/Kolon düzeni — bkz. ARCHITECTURE.md §10.17.3/§10.17.4.
// `type !== "columns"` olan bloklar için serbestlik (`z.record(z.unknown())`) KORUNUR (minimum
// diff, architect kararı); yalnızca `type: "columns"` için aşağıdaki dar şema devreye girer.
const PAGE_COLUMNS_LEAF_FORBIDDEN_TYPES = new Set(["columns", "hero"]);
const MAX_BLOCKS_PER_COLUMN = 20;
/** Toplam blok sayısı (iç içe DAHİL) tavanı — §10.17.3, DoS koruması. */
const MAX_TOTAL_PAGE_BLOCKS = 200;

/** Bir sütunun İÇİNE konabilen bloklar — `columns`/`hero` HARİÇ, geri kalanı serbest kalır. */
const PageColumnLeafBlockSchema = z.record(z.unknown()).superRefine((block, ctx) => {
  const type = (block as Record<string, unknown>).type;
  if (typeof type === "string" && PAGE_COLUMNS_LEAF_FORBIDDEN_TYPES.has(type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Sütun içine '${type}' bloğu eklenemez (yalnızca yaprak bloklar konabilir, derinlik en fazla 1).`,
    });
  }
});

const PageColumnSchema = z.object({
  id: z.string().min(1),
  blocks: z.array(PageColumnLeafBlockSchema).max(MAX_BLOCKS_PER_COLUMN),
});

const ColumnsBlockSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("columns"),
    data: z.object({
      columnCount: z.union([z.literal(2), z.literal(3)]),
      ratio: z.enum(["1-1", "2-1", "1-2", "1-1-1"]),
      gap: z.enum(["none", "sm", "md", "lg"]).default("md"),
      verticalAlign: z.enum(["top", "center", "bottom"]).default("top"),
      columns: z.array(PageColumnSchema).min(2).max(3),
    }),
  })
  .superRefine((block, ctx) => {
    const { columnCount, ratio, columns } = block.data;
    if (columns.length !== columnCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "columns"],
        message: "columns dizisinin uzunluğu columnCount ile eşit olmalıdır.",
      });
    }
    const allowedRatios = columnCount === 2 ? ["1-1", "2-1", "1-2"] : ["1-1-1"];
    if (!allowedRatios.includes(ratio)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "ratio"],
        message: `ratio, columnCount=${columnCount} ile uyumlu değil.`,
      });
    }
  });

const BlockSchema = z.record(z.unknown()).superRefine((block, ctx) => {
  if ((block as Record<string, unknown>).type !== "columns") return; // eski davranış aynen korunur
  const parsed = ColumnsBlockSchema.safeParse(block);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue(issue);
    }
  }
});

/** §10.17.3 — sayfa başına (iç içe dahil) toplam en fazla 200 blok. */
function refineTotalBlockCount(blocks: unknown[] | undefined): boolean {
  if (!blocks) return true;
  return flattenPageBlocks(blocks).length <= MAX_TOTAL_PAGE_BLOCKS;
}
const TOTAL_BLOCK_COUNT_REFINEMENT = {
  message: `Toplam blok sayısı (iç içe dahil) en fazla ${MAX_TOTAL_PAGE_BLOCKS} olabilir.`,
  path: ["blocks"],
};

// §9 backend-agent madde 5 — locale bazında `null` = çeviriyi SİL (bkz. openapi.yaml
// `ContentTranslations` açıklaması, lib/localization.ts::mergeTranslations).
//
// GÜVENLİK DÜZELTMESİ (security-agent denetimi, §10.17 sonrası) — bu şema önceden
// `fields.blocks`'un İÇERİĞİNE hiç bakmıyordu (`z.record(z.unknown())`). Sonuç: üst seviye
// `blocks` alanı için bağlayıcı olan iki kural — (a) `columns` derinliği en fazla 1
// (`ColumnsBlockSchema` üzerinden, bir sütunun içine `columns`/`hero` KONULAMAZ) ve (b) sayfa
// başına toplam en fazla `MAX_TOTAL_PAGE_BLOCKS` blok — `translations.<LOCALE>.blocks` için
// UYGULANMIYORDU. `sanitizePageBlocks`/`flattenPageBlocks` (bkz. sanitize-blocks.ts,
// lib/page-blocks.ts) sınırsız derinlikte özyinelemeli çalıştığından, kötü niyetli/ele geçirilmiş
// bir EDITOR hesabı `translations` alanına keyfi derinlikte iç içe `columns` yerleştirip (a) şema
// seviyesinde YASAKLANMIŞ bir yapıyı DB'ye yazdırabilir, (b) `flattenPageBlocks`'u
// (seo-score.ts/sanitize-blocks.ts tarafından çağrılır) çok derin özyinelemeye zorlayarak
// kaynak tüketimi/`RangeError: Maximum call stack size exceeded` (DoS) riski oluşturabilirdi.
// XSS açısından risk YOKTU (sanitizePageTranslations zaten derinlik sınırı olmaksızın özyineler
// ve her seviyedeki `text` bloğunu temizler) — ancak bu, dokümante edilmiş "derinlik en fazla 1"
// değişmezinin (invariant) tutarsız uygulanması ve bir DoS yüzeyiydi. Düzeltme: her `locale`
// için `fields.blocks` diziyse AYNI `BlockSchema`'dan (dolayısıyla `ColumnsBlockSchema`'dan) VE
// `refineTotalBlockCount`'tan geçirilir.
const TranslationsSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()).nullable())
  .superRefine((translations, ctx) => {
    for (const [locale, fields] of Object.entries(translations)) {
      if (!fields || !Array.isArray(fields.blocks)) continue;

      const parsedBlocks = z.array(BlockSchema).safeParse(fields.blocks);
      if (!parsedBlocks.success) {
        for (const issue of parsedBlocks.error.issues) {
          ctx.addIssue({ ...issue, path: ["translations", locale, "blocks", ...issue.path] });
        }
        continue;
      }

      if (!refineTotalBlockCount(parsedBlocks.data)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["translations", locale, "blocks"],
          message: TOTAL_BLOCK_COUNT_REFINEMENT.message,
        });
      }
    }
  });

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
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT)
  .refine((data) => refineTotalBlockCount(data.blocks), TOTAL_BLOCK_COUNT_REFINEMENT);

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
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT)
  .refine((data) => refineTotalBlockCount(data.blocks), TOTAL_BLOCK_COUNT_REFINEMENT);
