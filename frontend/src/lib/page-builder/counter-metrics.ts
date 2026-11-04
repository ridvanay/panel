import type { CounterMetric } from "./types";

/** Paket AK (K2) — `GET /public/site-metrics` yanıtı (kişisel veri yok; alınamayan değer `null`). */
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
