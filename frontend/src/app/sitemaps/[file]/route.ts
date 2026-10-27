import { loadSiteContent } from "@/lib/sitemap/load";
import { SITEMAP_SECTIONS, buildSection, type SitemapSection } from "@/lib/sitemap/build";
import { XML_HEADERS, renderUrlset } from "@/lib/sitemap/xml";

/** Paket S — `/sitemaps/{pages|doctors|specialties|blog|products|portfolio}.xml`; boş bölüm ya da bilinmeyen dosya 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const section = file.replace(/\.xml$/, "") as SitemapSection;
  if (!file.endsWith(".xml") || !SITEMAP_SECTIONS.includes(section)) return new Response("Not found", { status: 404 });
  const entries = buildSection(section, await loadSiteContent());
  if (entries.length === 0) return new Response("Not found", { status: 404 });
  return new Response(renderUrlset(entries), { headers: XML_HEADERS });
}
