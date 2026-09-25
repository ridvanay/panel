import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { SitePage } from "./types";

function localeQuery(locale?: string): string {
  return locale ? `?locale=${encodeURIComponent(locale)}` : "";
}

/**
 * Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi.
 * `locale` verilmezse backend varsayılan dile düşer (bkz. `LocaleQuery` sözleşmesi — geçersiz/eksik
 * kod HATA DEĞİL, sessiz fallback'tir).
 */
export async function fetchPageBySlugServer(slug: string, locale?: string): Promise<SitePage | null> {
  // Etiketsiz: sayfa kaydı bu sayfanın path'ini yeniler (bkz. backend `triggerPublicPageRevalidation`).
  const json = await fetchServerJson<{ data: SitePage }>(`/pages/${slug}${localeQuery(locale)}`);
  return json?.data ?? null;
}

/** Site nav'ı için — yayınlanmış tüm sayfaların hafif listesi. */
export async function fetchPublishedPagesServer(locale?: string): Promise<SitePage[]> {
  const json = await fetchServerJson<{ data: SitePage[] }>(`/pages${localeQuery(locale)}`, { tags: [CACHE_TAGS.pages] });
  return json?.data ?? [];
}
