import { loadSiteContent } from "@/lib/sitemap/load";
import { buildIndex } from "@/lib/sitemap/build";
import { XML_HEADERS, renderSitemapIndex } from "@/lib/sitemap/xml";

/** Paket S — `/sitemap.xml`: sitemap index (alt sitemap'ler `/sitemaps/*.xml`). */
export async function GET(): Promise<Response> {
  const data = await loadSiteContent();
  return new Response(renderSitemapIndex(buildIndex(data)), { headers: XML_HEADERS });
}
