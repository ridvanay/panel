import { CACHE_TAGS } from "../cache-tags";
import { fetchServerJson } from "./server-fetch";
import type { SiteSettings, SitePage } from "./types";

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "Site",
  logoUrl: null,
  faviconUrl: null,
  appleTouchIconUrl: null,
  tagline: null,
  homePageId: null,
  siteTemplate: "SHOWCASE",
  headerLogoHeight: null,
  headerLogoMaxWidth: null,
  shippingFlatFeeCents: null,
  freeShippingThresholdCents: null,
  shippingEstimatedDaysMin: null,
  shippingEstimatedDaysMax: null,
  // Yalnızca 404'te kullanılır (diğer hatalar fırlatır, bkz. server-fetch.ts) — güvenli (fail-closed) varsayılan.
  demoPaymentsEnabled: false,
  demoPaymentsSupported: false,
  // Bkz. `types.ts::SiteSettings.liveChatEnabled` yorumu — backend mapper/şema wiring'i henüz
  // TAMAMLANMADI, bu alanlar gerçek yanıtta `undefined` gelir; fetch başarısız olursa da
  // güvenli (kapalı) varsayılan korunur.
  liveChatEnabled: false,
  liveChatProvider: "internal",
  liveChatScriptId: null,
};

/** Sunucu bileşenlerinden çağrılır — bkz. server-plans.ts'teki apiFetch kullanılmama gerekçesi. */
export async function fetchSiteSettingsServer(): Promise<SiteSettings> {
  const json = await fetchServerJson<{ data: SiteSettings }>("/settings", { tags: [CACHE_TAGS.settings] });
  return json?.data ?? DEFAULT_SETTINGS;
}

/** Kök `/` rotası için: seçili ve yayınlanmış ana sayfayı çözümler, yoksa null döner. */
export async function fetchHomepageServer(): Promise<SitePage | null> {
  // `settings`: anasayfa seçimi değişince. Seçili sayfanın içeriği değişince backend `/<dil>` path'ini yeniler.
  const json = await fetchServerJson<{ data: SitePage | null }>("/settings/homepage", { tags: [CACHE_TAGS.settings] });
  return json?.data ?? null;
}
