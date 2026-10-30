import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { PublicAccreditation } from "./types";

/**
 * Paket V — `GET /accreditations?locale=` (public). Sitede gösterilecek yetki belgeleri; hata/yanıt
 * yoksa boş liste (şerit, footer logoları ve Hakkımızda listesi o zaman hiç render edilmez).
 */
export async function fetchAccreditationsServer(locale?: string): Promise<PublicAccreditation[]> {
  try {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    const json = await fetchServerJson<{ data: PublicAccreditation[] }>(`/accreditations${query}`, { tags: [CACHE_TAGS.accreditations] });
    return json?.data ?? [];
  } catch {
    return [];
  }
}
