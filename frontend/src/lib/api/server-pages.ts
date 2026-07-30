import { API_BASE_URL } from "../env";
import type { SitePage } from "./types";

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchPageBySlugServer(slug: string): Promise<SitePage | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/pages/${slug}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: SitePage };
    return json.data;
  } catch {
    return null;
  }
}

/** Site nav'ı için — yayınlanmış tüm sayfaların hafif listesi. */
export async function fetchPublishedPagesServer(): Promise<SitePage[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/pages`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: SitePage[] };
    return json.data;
  } catch {
    return [];
  }
}
