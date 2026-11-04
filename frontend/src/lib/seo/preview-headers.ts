/**
 * Taslak blog önizlemesi — belirteç URL'de (`?t=`) taşındığı için sayfa yanıtı `Referrer-Policy: no-referrer`
 * (belirteç dış bağlantılara `Referer` ile sızmaz) ve `X-Robots-Tag: noindex, nofollow` gönderir.
 * `next.config.ts::headers()` bu kuralları kullanır; dil önekli ve önek-siz yollar ayrı yazılır.
 */
export const BLOG_PREVIEW_SOURCES = ["/blog/preview/:postId", "/:lang/blog/preview/:postId"] as const;

export function blogPreviewHeaderRules() {
  return BLOG_PREVIEW_SOURCES.map((source) => ({
    source,
    headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ],
  }));
}

/**
 * Paket AL İş 5 — belirteci URL'de (sorgu `?token=`/`?t=` ya da yol parçası) taşıyan diğer sayfalar da
 * `Referrer-Policy: no-referrer` alır (belirteç dış bağlantılara/üçüncü taraf isteklere `Referer` ile sızmasın).
 * `#mg_…` / `#sc_…` (URL parçası) adresleri zaten sunucuya ve Referer'a gitmez; yine de `meet` ve
 * `book-consultation/manage` meta `referrer` ile işaretlidir, burada ek olarak başlık da verilir.
 * Yalnızca yanıt başlığı eklenir; sayfa davranışı değişmez.
 */
const LANG_PREFIX = "/:lang([a-z]{2}|[a-z]{2}-[a-z]{4})";
export const TOKEN_PAGE_PATHS = [
  "/reset-password",
  "/invitations/:path*",
  "/consultation/:path*",
  "/patient/bookings/:path*",
  "/review/:path*",
  "/meet/:path*",
  "/book-consultation/manage",
] as const;

export function tokenPageHeaderRules() {
  const sources: string[] = [];
  for (const path of TOKEN_PAGE_PATHS) sources.push(path, `${LANG_PREFIX}${path}`);
  return sources.map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }));
}
