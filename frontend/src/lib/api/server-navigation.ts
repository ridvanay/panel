import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
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
  const json = await fetchServerJson<{ data: NavigationConfigDto }>("/navigation", { tags: [CACHE_TAGS.navigation] });
  return json?.data ?? DEFAULT_NAVIGATION_CONFIG;
}
