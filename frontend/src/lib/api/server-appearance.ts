import { SERVER_API_BASE_URL } from "../env";
import type { PublicSiteAppearance } from "./types";

/**
 * `GET /appearance`'ın satır-yoksa (hiç kaydedilmemiş) davranışıyla birebir aynı `DEFAULTS`
 * (bkz. backend/src/modules/appearance/appearance.routes.ts::DEFAULTS + backend `Appearance.dto`
 * çözümlenmiş alanları) — ağ hatasında/backend erişilemezken `(site)` layout'unun asla
 * çökmemesi için (bkz. server-settings.ts'teki AYNI desen, `fetchSiteSettingsServer`).
 */
const DEFAULT_APPEARANCE: PublicSiteAppearance = {
  pageHeaderStyle: "PLAIN",
  pageHeaderBackgroundColor: null,
  pageHeaderBackgroundUrl: null,
  pageHeaderOverlayOpacity: 40,
  primaryColor: "#4f46e5",
  secondaryColor: "#111827",
  buttonColor: "#4f46e5",
  buttonTextColor: "#ffffff",
  linkColor: "#4f46e5",
  accentColor: "#f59e0b",
  backgroundColor: "#ffffff",
  surfaceColor: "#f9fafb",
  textColor: "#111827",
  mutedTextColor: "#6b7280",
  headingFont: "SYSTEM",
  bodyFont: "SYSTEM",
  baseFontSize: 16,
  borderRadius: "MD",
  buttonStyle: "SOLID",
  socialShareEnabled: false,
  socialShareNetworks: [],
  backToTopEnabled: true,
  stickyHeaderEnabled: true,
  cookieBannerEnabled: false,
  cookieBannerText: null,
  cookieBannerPolicyHref: null,
  maintenanceModeEnabled: false,
  maintenanceMessage: null,
  notFoundTitle: null,
  notFoundMessage: null,
  notFoundButtonLabel: null,
  notFoundButtonHref: null,
  customCss: null,
  customJs: null,
};

/**
 * Sunucu bileşenlerinden çağrılır — bkz. server-settings.ts'teki `apiFetch` kullanılmama gerekçesi
 * (aynı gerekçe burada da geçerli). `revalidate: 60` — `GET /settings` ile AYNI önbellek politikası
 * (§10.12.9): görünüm değişikliği siteye en geç 60 saniyede yansır, `cache: "no-store"` YASAKTIR.
 */
export async function fetchSiteAppearanceServer(): Promise<PublicSiteAppearance> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/appearance`, { next: { revalidate: 60 } });
    if (!res.ok) return DEFAULT_APPEARANCE;
    const json = (await res.json()) as { data: PublicSiteAppearance };
    return json.data;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export { DEFAULT_APPEARANCE };
