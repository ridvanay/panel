import { loadSiteContent } from "@/lib/sitemap/load";
import { SITEMAP_SECTIONS, buildSection, type SitemapSection } from "@/lib/sitemap/build";
import { XML_HEADERS, renderUrlset } from "@/lib/sitemap/xml";
import { SITE_URL } from "@/lib/env";

/** Paket S — `/sitemaps/{pages|specialties|blog|products|portfolio|packages}.xml`; boş bölüm ya da bilinmeyen dosya 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  // Paket V — eski `doctors.xml` (arama motorlarına gönderilmiş olabilir) yeni dosyaya kalıcı yönlenir.
  // Origin istekten değil yapılandırılmış site adresinden (ters vekil arkasında iç host sızmasın).
  // Paket AH — hekim sitemap dosyaları kaldırıldı: ana sitemap dizinine kalıcı yönlenir.
  if (file === "doctors.xml" || file === "physicians.xml") return Response.redirect(new URL("/sitemap.xml", SITE_URL), 301);
  const section = file.replace(/\.xml$/, "") as SitemapSection;
  if (!file.endsWith(".xml") || !SITEMAP_SECTIONS.includes(section)) return new Response("Not found", { status: 404 });
  const entries = buildSection(section, await loadSiteContent());
  if (entries.length === 0) return new Response("Not found", { status: 404 });
  return new Response(renderUrlset(entries), { headers: XML_HEADERS });
}
