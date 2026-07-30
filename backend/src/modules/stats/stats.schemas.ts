import { z } from "zod";

export const ViewStatsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(90).default(30),
});

export const DailyViewStatsSchema = z.object({
  date: z.string(),
  pageViews: z.number().int(),
  postViews: z.number().int(),
});
