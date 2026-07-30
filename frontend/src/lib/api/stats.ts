import { apiFetch } from "./client";
import type { BreakdownDto, DailyViewStats, LiveVisitorsDto } from "./types";

export function getViewStats(days = 30): Promise<DailyViewStats[]> {
  return apiFetch<DailyViewStats[]>("/admin/stats/views", { query: { days } });
}

export function getLiveVisitors(): Promise<LiveVisitorsDto> {
  return apiFetch<LiveVisitorsDto>("/admin/stats/live-visitors");
}

export function getBreakdown(days = 30): Promise<BreakdownDto> {
  return apiFetch<BreakdownDto>("/admin/stats/breakdown", { query: { days } });
}
