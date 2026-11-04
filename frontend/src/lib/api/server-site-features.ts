import { fetchSiteSettingsServer } from "./server-settings";
import { resolveSiteFeatures, type SiteFeatures } from "../site-features";

/** Paket AK — sunucu bileşenleri için site özellikleri (`/settings`, 60 sn önbellek, `settings` etiketi). Hatada: ikisi de AÇIK. */
export async function fetchSiteFeaturesServer(): Promise<SiteFeatures> {
  try {
    return resolveSiteFeatures(await fetchSiteSettingsServer());
  } catch {
    return resolveSiteFeatures(null);
  }
}
