import { API_BASE_URL } from "../env";
import type { SiteSettings, SitePage } from "./types";

const DEFAULT_SETTINGS: SiteSettings = { siteName: "Site", logoUrl: null, homePageId: null, siteTemplate: "SHOWCASE" };

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchSiteSettingsServer(): Promise<SiteSettings> {
  try {
    const res = await fetch(`${API_BASE_URL}/settings`, { next: { revalidate: 60 } });
    if (!res.ok) return DEFAULT_SETTINGS;
    const json = (await res.json()) as { data: SiteSettings };
    return json.data;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Kök `/` rotası için: seçili ve yayınlanmış ana sayfayı çözümler, yoksa null döner. */
export async function fetchHomepageServer(): Promise<SitePage | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/settings/homepage`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: SitePage | null };
    return json.data;
  } catch {
    return null;
  }
}
