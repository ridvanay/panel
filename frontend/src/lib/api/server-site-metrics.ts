import { fetchServerJson } from "./server-fetch";
import type { SiteMetrics } from "../page-builder/counter-metrics";

/**
 * Paket AK (K2) — `GET /public/site-metrics` (60 sn önbellek; kişisel veri yok). Hata/404'te `null` döner:
 * canlı veriye bağlı sayaç öğeleri o durumda gösterilmez, sayfa bozulmaz. Yanıt `{ data: {...} }` ya da düz nesne olabilir.
 */
export async function fetchSiteMetricsServer(): Promise<SiteMetrics | null> {
  try {
    const json = await fetchServerJson<{ data?: SiteMetrics } & Partial<SiteMetrics>>("/public/site-metrics");
    if (!json) return null;
    return (json.data ?? json) as SiteMetrics;
  } catch {
    return null;
  }
}
