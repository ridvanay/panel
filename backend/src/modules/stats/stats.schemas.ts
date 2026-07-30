import { z } from "zod";

export const ViewStatsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(90).default(30),
});

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
