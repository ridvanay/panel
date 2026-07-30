import { API_BASE_URL } from "../env";
import type { NavigationConfigDto } from "./types";

const DEFAULT_NAVIGATION_CONFIG: NavigationConfigDto = {
  headerCtaLabel: null,
  headerCtaHref: null,
  footerCopyrightText: null,
  navigationItems: [],
  socialLinks: [],
  footerColumns: [],
};

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchNavigationConfigServer(): Promise<NavigationConfigDto> {
  try {
    const res = await fetch(`${API_BASE_URL}/navigation`, { next: { revalidate: 60 } });
    if (!res.ok) return DEFAULT_NAVIGATION_CONFIG;
    const json = (await res.json()) as { data: NavigationConfigDto };
    return json.data;
  } catch {
    return DEFAULT_NAVIGATION_CONFIG;
  }
}
