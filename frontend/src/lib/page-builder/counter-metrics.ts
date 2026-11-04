import type { CounterMetric } from "./types";

/** Paket AK (K2) — `GET /public/site-metrics` alanları ve editör etiketleri (yönetici arayüzü Türkçe). */
export const COUNTER_METRIC_OPTIONS: { value: CounterMetric; label: string }[] = [
  { value: "activeServices", label: "Aktif hizmet sayısı" },
  { value: "visitorLanguages", label: "Ziyaretçi dili sayısı" },
  { value: "activeCoordinators", label: "Aktif koordinatör sayısı" },
  { value: "consultationMinutes", label: "Görüşme süresi (dakika)" },
];

export interface SiteMetrics {
  activeServices: number | null;
  visitorLanguages: number | null;
  activeCoordinators: number | null;
  consultationMinutes: number | null;
}

/** Geçerli (sonlu, > 0) bir sayı değilse `null` — renderer bu öğeyi göstermez. */
export function metricValue(metrics: Partial<SiteMetrics> | null | undefined, metric: CounterMetric): number | null {
  const v = metrics?.[metric];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}
