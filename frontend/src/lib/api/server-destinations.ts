import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { PackageCover } from "./types";

/** Paket X — `GET /destinations?locale=` öğesi. Fiyat yalnızca yönetici `showPrices` açtıysa dolu; hasta sayısı null olabilir. */
export interface Destination {
  id: string;
  slug: string;
  city: string;
  title: string;
  summary: string;
  highlights: string[];
  cover: PackageCover | null;
  patientCountLastYear: number | null;
  dataPeriodLabel: string | null;
  treatments: { label: string; price: { from: number; currency: string } | null }[];
}

/** Hata/modül kapalı (404) ya da kayıt yoksa boş liste → bölüm hiç çizilmez. */
export async function fetchDestinationsServer(locale?: string): Promise<Destination[]> {
  try {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const json = await fetchServerJson<{ data: { items: Destination[] } }>(`/destinations${query}`, { tags: [CACHE_TAGS.destinations] });
    return json?.data?.items ?? [];
  } catch {
    return [];
  }
}
