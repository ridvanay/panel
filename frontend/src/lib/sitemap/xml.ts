/**
 * Paket S — sitemaps.org 0.9 XML üretimi (sitemap index + urlset), Google `xhtml:link` hreflang ve
 * `image:image` uzantılarıyla. Tarayıcıda okunabilir görünüm için `/sitemap.xsl` bağlanır.
 * `changefreq`/`priority` YAZILMAZ (Google dikkate almıyor); `lastmod` yalnızca güvenilir bir
 * içerik tarihi varsa yazılır.
 */
export const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1";
/** sitemaps.org: dosya başına en fazla 50.000 URL. */
export const SITEMAP_MAX_URLS = 50_000;
const STYLESHEET = '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>';

export interface SitemapAlternate {
  hreflang: string;
  href: string;
}

export interface SitemapEntry {
  loc: string;
  /** ISO 8601 tarih/saat; yoksa yazılmaz. */
  lastmod?: string | null;
  alternates?: SitemapAlternate[];
  images?: string[];
}

export interface SitemapIndexItem {
  loc: string;
  lastmod?: string | null;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function lastmodTag(value: string | null | undefined, indent: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${indent}<lastmod>${date.toISOString()}</lastmod>\n`;
}

export function renderUrlset(entries: readonly SitemapEntry[]): string {
  const limited = entries.slice(0, SITEMAP_MAX_URLS);
  const body = limited
    .map((entry) => {
      let xml = `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n`;
      xml += lastmodTag(entry.lastmod, "    ");
      for (const alt of entry.alternates ?? []) {
        xml += `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.hreflang)}" href="${escapeXml(alt.href)}"/>\n`;
      }
      for (const image of entry.images ?? []) {
        xml += `    <image:image>\n      <image:loc>${escapeXml(image)}</image:loc>\n    </image:image>\n`;
      }
      return `${xml}  </url>\n`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${STYLESHEET}\n<urlset xmlns="${SITEMAP_NS}" xmlns:xhtml="${XHTML_NS}" xmlns:image="${IMAGE_NS}">\n${body}</urlset>\n`;
}

export function renderSitemapIndex(items: readonly SitemapIndexItem[]): string {
  const body = items
    .slice(0, SITEMAP_MAX_URLS)
    .map((item) => `  <sitemap>\n    <loc>${escapeXml(item.loc)}</loc>\n${lastmodTag(item.lastmod, "    ")}  </sitemap>\n`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${STYLESHEET}\n<sitemapindex xmlns="${SITEMAP_NS}">\n${body}</sitemapindex>\n`;
}

export const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  // Kısa süreli önbellek; veri katmanı zaten içerik etiketleriyle (revalidateTag) yenilenir.
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
} as const;
