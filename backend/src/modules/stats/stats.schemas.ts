import { z } from "zod";
import { CursorQuerySchema } from "../../schemas/common";
import { SiteRoleSchema } from "../../schemas/entities";

/** §10.8.10 — `PageView` günlük bucket'ından haftalık/aylık'a kadar toplama seçeneği. */
export const GranularitySchema = z.enum(["day", "week", "month"]);

const isoDateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Geçersiz ISO-8601 tarih.",
});

/**
 * §10.8.10 — `from`/`to` (ISO-8601 UTC) verilirse önceliklidir; verilmezse `days`
 * (DEPRECATED, geriye uyumluluk için korunur, bkz. `lib/stats-query.ts::resolveStatsRange`)
 * eski davranışı (varsayılan son 30 gün, en fazla 90 gün) sürdürür. İkisi birden verilirse
 * `from`/`to` kazanır. Aralık üst sınırı (`from`/`to` kullanıldığında) 366 gündür — aşımı
 * `resolveStatsRange` bir `ValidationError` (422) ile reddeder.
 */
export const StatsRangeQuerySchema = z
  .object({
    /** @deprecated `from`/`to` kullanın. */
    days: z.coerce.number().int().positive().max(90).optional(),
    from: isoDateStringSchema.optional(),
    to: isoDateStringSchema.optional(),
    granularity: GranularitySchema.default("day"),
    compare: z.coerce.boolean().default(false),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: "`from` ve `to` birlikte verilmelidir.",
    path: ["from"],
  });
export type StatsRangeQuery = z.infer<typeof StatsRangeQuerySchema>;

/** Geriye uyumluluk: eski `/views` ve `/breakdown` sözleşmesiyle birebir aynı adlar. */
export const ViewStatsQuerySchema = StatsRangeQuerySchema;

export const DailyViewStatsSchema = z.object({
  date: z.string(),
  pageViews: z.number().int(),
  postViews: z.number().int(),
});

export const LiveVisitorsSchema = z.object({
  count: z.number().int(),
});

export const BreakdownSchema = z.object({
  devices: z.array(
    z.object({
      type: z.enum(["MOBILE", "DESKTOP", "TABLET", "UNKNOWN"]),
      count: z.number().int(),
    })
  ),
  // "OTHER" — top 10 dışında kalan ülkelerin toplamı (yalnızca >0 ise eklenir).
  countries: z.array(
    z.object({
      country: z.string(),
      count: z.number().int(),
    })
  ),
});

// ---------------------------------------------------------------------------
// §10.8.10 — /admin/stats/summary
// ---------------------------------------------------------------------------

export const SummaryCompareSchema = z.object({
  pageViews: z.number().int(),
  postViews: z.number().int(),
  newUsers: z.number().int(),
});

/**
 * `activeSubscriptions`/`mrrCents` için `compare` DELTA'sı BİLEREK dönülmez: `Subscription`
 * geçmiş durum geçmişini (ör. "hangi tarihte kaç abonelik ACTIVE'ti") tutan bir tablo değil —
 * yalnızca ANLIK durumu taşıyor. Geçmiş bir dönem için "o an aktif olan abonelik sayısı"nı
 * güvenilir şekilde yeniden inşa etmek mümkün değil (bkz. backend-agent raporu — churn/geçmiş
 * durum için ayrı bir `SubscriptionStatusHistory` tablosu db-agent'a önerilebilir). Yanıltıcı
 * bir yaklaşıklık üretmek yerine bu iki alan için `compare` BİLEREK atlanır.
 */
export const SummaryStatsSchema = z.object({
  from: z.string(),
  to: z.string(),
  granularity: GranularitySchema,
  pageViews: z.number().int(),
  postViews: z.number().int(),
  newUsers: z.number().int(),
  /** ANLIK (şimdiki zaman) durumu — dönem sonuna göre DEĞİL, bkz. yukarıdaki not. */
  activeSubscriptions: z.number().int(),
  /** ANLIK MRR (yalnızca `Plan.priceMonthlyCents`; `Subscription` faturalama periyodunu
   * (aylık/yıllık) ayrı bir alanda TUTMUYOR — bkz. backend-agent raporu, yıllık abonelikler
   * bu toplamda AY KARŞILIĞI olarak yaklaşık hesaplanmıyor, olduğu gibi `priceMonthlyCents`
   * kullanılıyor). */
  mrrCents: z.number().int(),
  compare: SummaryCompareSchema.nullable(),
});
export type SummaryStatsDto = z.infer<typeof SummaryStatsSchema>;

// ---------------------------------------------------------------------------
// §10.8.10 — /admin/stats/top-content
// ---------------------------------------------------------------------------

export const TopContentQuerySchema = CursorQuerySchema.extend({
  days: z.coerce.number().int().positive().max(90).optional(),
  from: isoDateStringSchema.optional(),
  to: isoDateStringSchema.optional(),
}).refine((v) => (v.from === undefined) === (v.to === undefined), {
  message: "`from` ve `to` birlikte verilmelidir.",
  path: ["from"],
});
export type TopContentQuery = z.infer<typeof TopContentQuerySchema>;

export const TopContentItemSchema = z.object({
  contentType: z.enum(["page", "post"]),
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  views: z.number().int(),
});
export type TopContentItemDto = z.infer<typeof TopContentItemSchema>;

export const TopContentListMetaSchema = z.object({
  nextCursor: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// §10.8.10 — /admin/stats/users
// ---------------------------------------------------------------------------

export const UserSeriesPointSchema = z.object({
  date: z.string(),
  count: z.number().int(),
});

export const UsersStatsSchema = z.object({
  from: z.string(),
  to: z.string(),
  granularity: GranularitySchema,
  series: z.array(UserSeriesPointSchema),
  /** Dönemle SINIRLI DEĞİL — kullanıcı tablosunun ANLIK rol dağılımı. */
  roleDistribution: z.array(
    z.object({
      role: SiteRoleSchema,
      count: z.number().int(),
    })
  ),
});
export type UsersStatsDto = z.infer<typeof UsersStatsSchema>;

// ---------------------------------------------------------------------------
// §10.8.10 — /admin/stats/revenue
// ---------------------------------------------------------------------------

export const RevenueSeriesPointSchema = z.object({
  date: z.string(),
  /** Bucket içinde OLUŞTURULAN aboneliklerin `priceMonthlyCents` toplamı ("yeni MRR"). */
  newMrrCents: z.number().int(),
  /** Bucket içinde `CANCELED` durumuna geçen (yaklaşık — `updatedAt` referans alınır) abonelik sayısı. */
  churnedCount: z.number().int(),
});

export const RevenueStatsSchema = z.object({
  from: z.string(),
  to: z.string(),
  granularity: GranularitySchema,
  /** ANLIK toplamlar — bkz. `SummaryStatsSchema` üstündeki not. */
  activeSubscriptions: z.number().int(),
  mrrCents: z.number().int(),
  series: z.array(RevenueSeriesPointSchema),
});
export type RevenueStatsDto = z.infer<typeof RevenueStatsSchema>;
