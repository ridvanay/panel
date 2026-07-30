import { API_BASE_URL } from "../env";
import type { SiteSettings } from "./types";

const DEFAULT_SETTINGS: SiteSettings = { siteName: "Site", logoUrl: null };

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
