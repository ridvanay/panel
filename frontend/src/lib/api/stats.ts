import { apiFetch } from "./client";
import type { DailyViewStats } from "./types";

export function getViewStats(days = 30): Promise<DailyViewStats[]> {
  return apiFetch<DailyViewStats[]>("/admin/stats/views", { query: { days } });
}
