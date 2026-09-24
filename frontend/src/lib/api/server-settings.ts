import { SERVER_API_BASE_URL } from "../env";
import type { SiteSettings, SitePage } from "./types";

const DEFAULT_SETTINGS: SiteSettings = {
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
  // Fetch başarısız olursa güvenli (fail-closed) varsayılan — gerçek değer her zaman `/settings`den gelir.
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
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/settings`, { next: { revalidate: 60 } });
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
    const res = await fetch(`${SERVER_API_BASE_URL}/settings/homepage`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: SitePage | null };
    return json.data;
  } catch {
    return null;
  }
}
