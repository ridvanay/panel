import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { PackageCategory, PackageDetailData, PackageListData } from "./types";

/**
 * Paket X — `GET /packages` ve `GET /packages/:slug` (herkese açık, yalnızca aktif paketler). Telehealth modülü kapalıysa
 * uçlar 404 döner; hata ya da 404'te boş liste / null (panel ve bölüm o zaman hiç görünmez). Medya adresleri genel
 * adresle kalır (iç adres yalnızca next/image `src`'i içindir — bkz. SafeImage).
 */
const EMPTY: PackageListData = { items: [], categories: [] };

export async function fetchPackagesServer(locale?: string, filters: { category?: PackageCategory; featured?: boolean } = {}): Promise<PackageListData> {
  try {
    const query = new URLSearchParams();
    if (locale) query.set("locale", locale);
    if (filters.category) query.set("category", filters.category);
    if (filters.featured) query.set("featured", "true");
    const qs = query.toString();
    const json = await fetchServerJson<{ data: PackageListData }>(`/packages${qs ? `?${qs}` : ""}`, { tags: [CACHE_TAGS.packages] });
    return json?.data ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function fetchPackageServer(slug: string, locale?: string): Promise<PackageDetailData | null> {
  try {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const json = await fetchServerJson<{ data: PackageDetailData }>(`/packages/${encodeURIComponent(slug)}${query}`, { tags: [CACHE_TAGS.packages] });
    return json?.data ?? null;
  } catch {
    return null;
  }
}
