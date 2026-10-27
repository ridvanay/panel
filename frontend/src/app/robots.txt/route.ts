import { SITE_URL } from "@/lib/env";
import { FALLBACK_LOCALES, fetchLocalesServer } from "@/lib/api/server-locales";
import { withBuildTimeFallback } from "@/lib/api/server-fetch";
import { buildRobotsTxt } from "@/lib/seo/robots";

/**
 * Paket S — `/robots.txt` (route handler: Next'in `robots.ts` biçimi yorum satırı yazamıyor; bu dosya
 * her satırı açıklıyor). Herkese açık hiçbir sayfa engellenmez; yalnızca özel alanlar.
 */
export async function GET(): Promise<Response> {
  const locales = await withBuildTimeFallback(() => fetchLocalesServer(), FALLBACK_LOCALES);
  return new Response(buildRobotsTxt(SITE_URL.replace(/\/$/, ""), locales), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
