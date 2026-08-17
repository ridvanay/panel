import { SERVER_API_BASE_URL } from "../env";
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
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/pages/${slug}${localeQuery(locale)}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: SitePage };
    return json.data;
  } catch {
    return null;
  }
}

/** Site nav'ı için — yayınlanmış tüm sayfaların hafif listesi. */
export async function fetchPublishedPagesServer(locale?: string): Promise<SitePage[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/pages${localeQuery(locale)}`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: SitePage[] };
    return json.data;
  } catch {
    return [];
  }
}
