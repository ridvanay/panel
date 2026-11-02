import { permanentRedirect } from "next/navigation";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { requestFormPath } from "@/lib/intermediary";

/**
 * Paket AH — ziyaretçi randevu/ödeme/sepet girişleri kapalıdır: talep formuna kalıcı yönlendirme.
 * Bölüm ya da paket biliniyorsa sorgu parametresiyle taşınır. Hiç dönmez (`permanentRedirect` fırlatır).
 */
export async function redirectVisitorToRequest(lang: string, params?: { service?: string | null; pkg?: string | null }): Promise<never> {
  const locales = await fetchLocalesServer();
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const path = requestFormPath(params);
  const [pathname, query] = path.split("?");
  permanentRedirect(`${withLocalePrefix(pathname!, lang, defaultLocaleCode)}${query ? `?${query}` : ""}`);
}
