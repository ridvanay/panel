import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type { DoctorProfile, Locale, SitePage, Specialty } from "@/lib/api/types";
import { SITEMAP_SECTIONS, buildIndex, buildSection, isHomepageDuplicate, type SitemapData } from "@/lib/sitemap/build";
import { SITEMAP_MAX_URLS, renderSitemapIndex, renderUrlset } from "@/lib/sitemap/xml";
import { LLMS_EMERGENCY_NOTE, buildLlmsTxt } from "@/lib/seo/llms";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { noindexHeaderSources } from "@/lib/seo/private-paths";

/**
 * Paket S — sitemap index + alt sitemap'ler (hreflang yalnızca açık diller, x-default, image, lastmod),
 * hariç tutulanlar (/home1 kopyası, taslak/noindex, arşivli/pasif doktor, portal), XML geçerliliği,
 * llms.txt bölümleri/kurucu/acil not/kişisel bilgi-fiyat yok, robots.txt eşleşmeleri ve noindex başlıkları.
 */
const SITE = "https://wmhealthistanbul.com";
const LOCALES: Locale[] = [
  { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: "en-US" },
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1, hreflang: "tr-TR" },
  { code: "ar", label: "Arapça", nativeLabel: "العربية", isDefault: false, enabled: true, sortOrder: 2, hreflang: "ar" },
  { code: "es", label: "İspanyolca", nativeLabel: "Español", isDefault: false, enabled: false, sortOrder: 3, hreflang: "es" },
];
const page = (over: Partial<SitePage>): SitePage =>
  ({
    id: over.slug,
    title: over.slug,
    status: "PUBLISHED",
    noIndex: false,
    isLegalDocument: false,
    blocks: [{ type: "text" }],
    publishedAt: "2026-09-16T10:00:00.000Z",
    updatedAt: "2026-10-27T05:41:32.866Z", // görüntülenme sayacı bunu değiştirir — kullanılmamalı
    localizations: [
      { locale: "en", slug: over.slug, translated: true },
      { locale: "tr", slug: over.slug, translated: true },
      { locale: "es", slug: over.slug, translated: true },
    ],
    ...over,
  }) as unknown as SitePage;
const doctor = (over: Partial<DoctorProfile>): DoctorProfile =>
  ({
    id: over.slug,
    title: "Dr.",
    fullName: "Test",
    isActive: true,
    archivedAt: null,
    isFounder: false,
    order: 5,
    bio: "",
    subSpecialty: null,
    specialty: { name: "General Surgery" },
    avatarMedia: null,
    updatedAt: "2026-10-20T08:00:00.000Z",
    ...over,
  }) as unknown as DoctorProfile;

const DATA: SitemapData & { siteName: string } = {
  siteUrl: SITE,
  siteName: "WM Health Istanbul",
  locales: LOCALES,
  homePageId: "home",
  pages: [
    page({ id: "home", slug: "home", blocks: [{ type: "container" }] as never }),
    page({ id: "about", slug: "about" }),
    page({ id: "kvkk", slug: "kvkk-aydinlatma-metni-2", title: "Privacy Notice (PDPL / KVKK)", isLegalDocument: true }),
    page({ id: "home1", slug: "home1", blocks: [{ type: "home-page" }] as never }),
    page({ id: "hidden", slug: "hidden-page", noIndex: true }),
    page({ id: "draft", slug: "draft-page", status: "DRAFT" as never }),
  ],
  doctors: [
    doctor({ slug: "hakan-sofu", fullName: "Hakan Sofu", order: 1, specialty: { name: "Obesity and Metabolic Surgery", slug: "obesity-and-metabolic-surgery" } as never }),
    doctor({
      slug: "vahit-mutlu",
      title: "Assoc. Prof. Dr.",
      fullName: "Vahit Mutlu",
      isFounder: true,
      order: 9,
      avatarMedia: { url: "/uploads/vahit.jpg" } as never,
      bio: "General surgeon with over 5,000 operations. Contact him at vahit@example.com. Consultation fee is €150.",
    }),
    doctor({ slug: "arsiv-doktor", archivedAt: "2026-10-01T00:00:00.000Z" as never }),
    doctor({ slug: "pasif-doktor", isActive: false }),
  ],
  specialties: [{ slug: "obesity-and-metabolic-surgery", name: "Obesity and Metabolic Surgery", description: "Surgical treatment of obesity. Includes sleeve gastrectomy.", isActive: true, order: 1, updatedAt: "2026-10-10T00:00:00.000Z" } as unknown as Specialty],
  posts: [],
  products: [],
  portfolio: [],
};

const allEntries = () => SITEMAP_SECTIONS.flatMap((s) => buildSection(s, DATA));

describe("sitemap", () => {
  it("index: pages/doctors/specialties alt sitemap'leri; yayımlanmış yazı yoksa blog yok", () => {
    const index = buildIndex(DATA);
    expect(index.map((i) => i.loc)).toEqual([`${SITE}/sitemaps/pages.xml`, `${SITE}/sitemaps/physicians.xml`, `${SITE}/sitemaps/specialties.xml`]);
    const withPost = buildIndex({ ...DATA, posts: [{ slug: "ilk-yazi", publishedAt: "2026-10-01T00:00:00.000Z", localizations: [] }] });
    expect(withPost.map((i) => i.loc)).toContain(`${SITE}/sitemaps/blog.xml`);
  });

  it("hreflang: her dil sürümü kendi <url>'i; yalnızca açık diller + x-default; kapalı dil (es) yok", () => {
    const doctors = buildSection("physicians", DATA);
    const vahit = doctors.filter((e) => e.loc.includes("vahit-mutlu"));
    expect(vahit.map((e) => e.loc)).toEqual([`${SITE}/physicians/vahit-mutlu`, `${SITE}/tr/physicians/vahit-mutlu`, `${SITE}/ar/physicians/vahit-mutlu`]);
    expect(vahit[1]!.alternates).toEqual([
      { hreflang: "en-US", href: `${SITE}/physicians/vahit-mutlu` },
      { hreflang: "tr-TR", href: `${SITE}/tr/physicians/vahit-mutlu` },
      { hreflang: "ar", href: `${SITE}/ar/physicians/vahit-mutlu` },
      { hreflang: "x-default", href: `${SITE}/physicians/vahit-mutlu` },
    ]);
    expect(JSON.stringify(allEntries())).not.toMatch(/\/es\/|"hreflang":"es"/);
  });

  it("hariç: /home1 (ana sayfa kopyası), noindex, taslak, arşivli/pasif doktor, portal/admin/giriş", () => {
    const locs = allEntries().map((e) => e.loc);
    expect(isHomepageDuplicate(DATA.pages[3]!, "home")).toBe(true);
    expect(locs.some((l) => /home1|hidden-page|draft-page|arsiv-doktor|pasif-doktor/.test(l))).toBe(false);
    expect(locs.some((l) => /\/(patient|doctor|admin|dashboard|login|register|consultation|checkout)(\/|$)/.test(l))).toBe(false);
    expect(locs).toContain(`${SITE}/kvkk-aydinlatma-metni-2`);
    expect(locs).toContain(`${SITE}/contact`);
    expect(locs).toContain(SITE);
    expect(locs).toContain(`${SITE}/tr`);
  });

  it("lastmod: sayfada publishedAt (updatedAt değil); doktorda updatedAt; image:image mutlak avatar", () => {
    const kvkk = buildSection("pages", DATA).find((e) => e.loc === `${SITE}/kvkk-aydinlatma-metni-2`)!;
    expect(kvkk.lastmod).toBe("2026-09-16T10:00:00.000Z");
    const contact = buildSection("pages", DATA).find((e) => e.loc === `${SITE}/contact`)!;
    expect(contact.lastmod).toBeNull();
    const vahit = buildSection("physicians", DATA).find((e) => e.loc === `${SITE}/physicians/vahit-mutlu`)!;
    expect(vahit.lastmod).toBe("2026-10-20T08:00:00.000Z");
    expect(vahit.images).toEqual([`${SITE}/uploads/vahit.jpg`]);
  });

  it("XML: XSL bağlantısı, sitemaps.org kök elemanları ve namespace'ler, iyi biçimli, mutlak https URL'ler, ≤50.000 URL, changefreq/priority yok", () => {
    const urlset = renderUrlset(buildSection("physicians", DATA));
    const index = renderSitemapIndex(buildIndex(DATA));
    for (const xml of [urlset, index]) {
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>')).toBe(true);
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
      expect(doc.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
      const locs = Array.from(doc.getElementsByTagNameNS("http://www.sitemaps.org/schemas/sitemap/0.9", "loc")).map((n) => n.textContent ?? "");
      expect(locs.length).toBeGreaterThan(0);
      expect(locs.every((l) => l.startsWith("https://"))).toBe(true);
      expect(xml).not.toMatch(/changefreq|priority/);
    }
    const doc = new DOMParser().parseFromString(urlset, "application/xml");
    expect(doc.documentElement.localName).toBe("urlset");
    expect(doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link").length).toBeGreaterThan(0);
    expect(doc.getElementsByTagNameNS("http://www.google.com/schemas/sitemap-image/1.1", "loc")[0]!.textContent).toBe(`${SITE}/uploads/vahit.jpg`);
    expect(new DOMParser().parseFromString(index, "application/xml").documentElement.localName).toBe("sitemapindex");
    const huge = Array.from({ length: SITEMAP_MAX_URLS + 5 }, (_, i) => ({ loc: `${SITE}/x/${i}` }));
    expect((renderUrlset(huge).match(/<url>/g) ?? []).length).toBe(SITEMAP_MAX_URLS);
  });

  it("route handler'lar: Content-Type application/xml; bilinmeyen/boş alt sitemap 404", async () => {
    vi.resetModules();
    vi.doMock("@/lib/sitemap/load", () => ({ loadSiteContent: async () => DATA }));
    const index = await import("@/app/sitemap.xml/route");
    const sub = await import("@/app/sitemaps/[file]/route");
    const res = await index.GET();
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await res.text()).toContain("<sitemapindex");
    const pages = await sub.GET(new Request(`${SITE}/sitemaps/pages.xml`), { params: Promise.resolve({ file: "pages.xml" }) });
    expect(pages.status).toBe(200);
    expect(pages.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect((await sub.GET(new Request(`${SITE}/sitemaps/blog.xml`), { params: Promise.resolve({ file: "blog.xml" }) })).status).toBe(404);
    expect((await sub.GET(new Request(`${SITE}/sitemaps/x.xml`), { params: Promise.resolve({ file: "x.xml" }) })).status).toBe(404);
    vi.doUnmock("@/lib/sitemap/load");
  });
});

describe("llms.txt", () => {
  it("bölümler eksiksiz ve sırayla; kurucu en üstte; acil durum notu; diller ve önekleri; yasal metinler", () => {
    const text = buildLlmsTxt(DATA);
    expect(text.startsWith("# WM Health Istanbul\n\n> ")).toBe(true);
    const order = ["## Specialties", "## Physicians", "## How it works", "## Languages", "## Legal", "## Contact"].map((h) => text.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const doctorsBlock = text.slice(text.indexOf("## Physicians"), text.indexOf("## How it works"));
    expect(doctorsBlock.split("\n")[2]).toBe(`- [Assoc. Prof. Dr. Vahit Mutlu](${SITE}/physicians/vahit-mutlu) (founder): General Surgery`);
    expect(doctorsBlock).not.toMatch(/arsiv-doktor|pasif-doktor/);
    expect(text).toContain(LLMS_EMERGENCY_NOTE);
    expect(text).toContain("Founded by Assoc. Prof. Dr. Vahit Mutlu.");
    expect(text).toContain(`- Turkish (tr): ${SITE}/tr`);
    expect(text).not.toContain("Spanish");
    expect(text).toContain(`[Privacy Notice (PDPL / KVKK)](${SITE}/kvkk-aydinlatma-metni-2)`);
    expect(text).toContain("info@wmhealthistanbul.com");
  });

  it("llms-full: biyografi + çekince; kişisel iletişim bilgisi ve fiyat yok", () => {
    const full = buildLlmsTxt(DATA, { full: true });
    expect(full).toContain("General surgeon with over 5,000 operations. (Figures as stated in the doctor's professional biography.)");
    expect(full).toContain("Includes sleeve gastrectomy.");
    expect(full).not.toMatch(/vahit@example\.com|€|fee/);
    expect(full.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)).toEqual(["info@wmhealthistanbul.com"]);
  });

  it("temizleme: yıl aralıkları korunur; sözcükle fiyat, telefon ve HTML atılır", async () => {
    const { sanitizePublicText } = await import("@/lib/seo/llms");
    expect(sanitizePublicText("Fellowship 2010-2015 in Vienna. Fee is 100 euros. Call +90 212 555 1234. <b>Board certified</b>.")).toBe(
      "Fellowship 2010-2015 in Vienna. Board certified ."
    );
  });

  it("route: Content-Type text/plain; charset=utf-8", async () => {
    vi.resetModules();
    vi.doMock("@/lib/sitemap/load", () => ({ loadSiteContent: async () => DATA }));
    const llms = await import("@/app/llms.txt/route");
    const full = await import("@/app/llms-full.txt/route");
    for (const res of [await llms.GET(), await full.GET()]) expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    vi.doUnmock("@/lib/sitemap/load");
  });
});

/** Google'ın robots.txt yorumu: en uzun eşleşen kural kazanır, `*` joker, eşitlikte Allow. */
function isAllowed(robots: string, path: string): boolean {
  let best: { len: number; allow: boolean } = { len: -1, allow: true };
  for (const line of robots.split("\n")) {
    const m = /^(Allow|Disallow):\s*(\S*)/.exec(line);
    if (!m || !m[2]) continue;
    const exact = m[2].endsWith("$");
    const body = (exact ? m[2].slice(0, -1) : m[2]).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const pattern = new RegExp(`^${body}${exact ? "$" : ""}`);
    if (pattern.test(path) && (m[2].length > best.len || (m[2].length === best.len && m[1] === "Allow"))) best = { len: m[2].length, allow: m[1] === "Allow" };
  }
  return best.allow;
}

describe("robots.txt", () => {
  const robots = buildRobotsTxt(SITE, LOCALES);

  it("herkese açık sayfalar engellenmez: /doctors/vahit-mutlu (/doctor/ öneki /doctors/ ile eşleşmez)", () => {
    for (const path of ["/", "/physicians", "/physicians/vahit-mutlu", "/tr/physicians/vahit-mutlu", "/specialties/dentalcare", "/blog/x", "/kvkk-aydinlatma-metni-2", "/llms.txt", "/sitemap.xml", "/cartilage-repair", "/administration-team", "/tr/checkout-guide"]) {
      expect(isAllowed(robots, path), path).toBe(true);
    }
  });

  it("özel alanlar engellenir: /patient/..., /tr/doctor/..., /consultation, /api/, giriş, ödeme sonucu", () => {
    for (const path of ["/patient/bookings", "/tr/patient/bookings/1", "/doctor/schedule", "/tr/doctor/schedule", "/ar/consultation/abc", "/api/v1/x", "/login", "/register", "/forgot-password", "/checkout/success", "/tr/checkout/cancel", "/admin", "/admin/pages", "/dashboard", "/cart", "/tr/cart", "/hesabim/profil", "/reset-password?token=abc", "/login?next=%2Fpatient", "/tr/checkout?session=1"]) {
      expect(isAllowed(robots, path), path).toBe(false);
    }
  });

  it("dil önekli satırlar * deseniyle ve yorumda yalnızca açık diller; sitemap ve LLM satırı", () => {
    expect(robots).toContain("Disallow: /*/patient/");
    expect(robots).toMatch(/enabled languages: tr, ar\)/);
    expect(robots).not.toMatch(/\/es\//);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toContain(`# LLM summary: ${SITE}/llms.txt`);
  });

  it("noindex başlıkları (X-Robots-Tag) özel sayfalarda; herkese açık sayfalarda yok", () => {
    const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as { pathToRegexp: (p: string) => RegExp };
    const regexes = noindexHeaderSources().map((s) => pathToRegexp(s));
    const noindexed = (path: string) => regexes.some((r) => r.test(path));
    for (const path of ["/admin", "/admin/pages", "/login", "/register", "/patient", "/patient/bookings", "/tr/patient/bookings/1", "/doctor", "/en/doctor/schedule", "/consultation/x", "/tr/checkout/success", "/cart", "/ar/hesabim/profil", "/activate-account"]) {
      expect(noindexed(path), path).toBe(true);
    }
    for (const path of ["/", "/physicians", "/physicians/vahit-mutlu", "/tr/physicians/vahit-mutlu", "/about", "/blog/cart", "/contact", "/kvkk-aydinlatma-metni-2"]) {
      expect(noindexed(path), path).toBe(false);
    }
  });
});
