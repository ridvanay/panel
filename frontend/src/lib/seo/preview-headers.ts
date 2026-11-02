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
