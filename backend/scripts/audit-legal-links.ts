/**
 * Paket A2 (2026-10-18) — canlı backend logundaki yasal sayfa 404'lerinin
 * (`/pages/terms-of-use`, `/pages/explicit-consent-statement`, `/pages/Distance%20Service%20Agreement`)
 * kaynağını bulmak için SALT OKUNUR tespit script'i. Hiçbir şey YAZMAZ, sayfa OLUŞTURMAZ.
 *
 * Raporlar:
 *   1. Footer, ana menü, header CTA ve sayfa bloklarındaki (blok `href`/`url` alanları ve zengin
 *      metin içi `<a href>`) site içi bağlantılardan, yayınlanmış bir sayfaya ya da bilinen bir
 *      uygulama rotasına çözülemeyenler (kırık) ve yolunda geçersiz karakter (boşluk, büyük harf,
 *      Türkçe karakter) olanlar.
 *   2. Yasal belge (`isLegalDocument`) olarak işaretli sayfalar: durum + dil bazında slug'lar.
 *   3. Randevu onay kutularının ihtiyaç duyduğu yasal metinlerden hangilerinin yayında OLMADIĞI.
 *
 * ÇALIŞTIRMA (backend/ dizininden): npx tsx scripts/audit-legal-links.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** `frontend/src/app/[lang]/(site)` ve `(auth)` altındaki sabit rotaların ilk yol parçası. */
const APP_ROUTE_SEGMENTS = new Set([
  "",
  "about",
  "activate-account",
  "blog",
  "cart",
  "checkout",
  "consultation",
  "contact",
  "doctors",
  "doctor",
  "hesabim",
  "patient",
  "portfolio",
  "products",
  "siparislerim",
  "specialties",
  "login",
  "register",
  "forgot-password",
  "reset-password",
  "verify-email",
  "uploads",
]);

const VALID_PATH = /^\/[a-z0-9\-._/]*$/;

/** Onay kutularının bağlandığı metinler — `frontend/src/lib/legal-pages.ts` ile aynı anahtar kelimeler. */
const REQUIRED_LEGAL_DOCUMENTS: { label: string; pattern: RegExp }[] = [
  { label: "KVKK Aydınlatma Metni (kimlik adımı onay kutusu)", pattern: /kvkk|aydınlatma|aydinlatma|privacy|data[- ]protection/i },
  { label: "Sağlık Verisi Açık Rıza Metni (tıbbi belge adımı onay kutusu)", pattern: /açık rıza|acik-riza|explicit[- ]consent/i },
  { label: "Kullanım Koşulları", pattern: /kullanım koşulları|kullanim-kosullari|terms[- ]of[- ]use/i },
  { label: "Mesafeli Hizmet Sözleşmesi", pattern: /mesafeli|distance[- ]service/i },
];

interface LinkRef {
  source: string;
  href: string;
}

function collectFromJson(value: unknown, source: string, out: LinkRef[]) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/href="(\/[^"]*)"/g)) out.push({ source, href: match[1]! });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFromJson(item, source, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "href" || key === "url") && typeof child === "string" && child.startsWith("/") && !child.startsWith("//")) {
        out.push({ source, href: child });
      } else {
        collectFromJson(child, source, out);
      }
    }
  }
}

function pathOf(href: string): string {
  return href.split(/[?#]/)[0]!;
}

async function main() {
  const [footerLinks, navItems, settings, pages, pageSlugs] = await Promise.all([
    prisma.footerLink.findMany({ select: { label: true, href: true, column: { select: { title: true } } } }),
    prisma.navigationItem.findMany({ select: { label: true, href: true } }),
    prisma.siteSettings.findMany({ select: { headerCtaHref: true } }),
    prisma.page.findMany({ where: { deletedAt: null }, select: { id: true, title: true, slug: true, status: true, isLegalDocument: true, blocks: true, translations: true } }),
    prisma.contentSlug.findMany({ where: { entityType: "PAGE" }, select: { entityId: true, locale: true, slug: true } }),
  ]);

  const publishedPageIds = new Set(pages.filter((p) => p.status === "PUBLISHED").map((p) => p.id));
  const resolvableSlugs = new Set<string>();
  for (const page of pages) if (publishedPageIds.has(page.id)) resolvableSlugs.add(page.slug);
  for (const row of pageSlugs) if (publishedPageIds.has(row.entityId)) resolvableSlugs.add(row.slug);

  const links: LinkRef[] = [];
  for (const link of footerLinks) {
    if (link.href.startsWith("/")) links.push({ source: `footer "${link.column.title}" › "${link.label}"`, href: link.href });
  }
  for (const item of navItems) {
    if (item.href.startsWith("/")) links.push({ source: `menü › "${item.label}"`, href: item.href });
  }
  for (const s of settings) {
    if (s.headerCtaHref?.startsWith("/")) links.push({ source: "header CTA", href: s.headerCtaHref });
  }
  for (const page of pages) {
    collectFromJson(page.blocks, `sayfa "${page.title}" (${page.slug}) blokları`, links);
    collectFromJson(page.translations, `sayfa "${page.title}" (${page.slug}) çevirileri`, links);
  }

  console.log("== 1) Site içi bağlantılar ==");
  let problems = 0;
  for (const link of links) {
    const path = pathOf(link.href);
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // bozuk % kodlaması — olduğu gibi raporlanır
    }
    const segments = decoded.replace(/^\/+/, "").split("/");
    // Dil öneki (/en/...) atlanır.
    const first = /^[a-z]{2}$/.test(segments[0] ?? "") && segments.length > 1 ? segments[1]! : segments[0]!;
    const invalid = !VALID_PATH.test(path);
    const isAppRoute = APP_ROUTE_SEGMENTS.has(first);
    const broken = !isAppRoute && !resolvableSlugs.has(first);
    if (invalid || broken) {
      problems += 1;
      const reasons = [invalid ? "GEÇERSİZ KARAKTER (slug yerine başlık?)" : null, broken ? "yayınlanmış sayfa YOK → 404" : null].filter(Boolean).join(", ");
      console.log(`  [!] ${link.href}  — ${reasons}  — kaynak: ${link.source}`);
    }
  }
  if (problems === 0) console.log("  Sorunlu bağlantı yok.");

  console.log("\n== 2) Yasal belge olarak işaretli sayfalar ==");
  const legalPages = pages.filter((p) => p.isLegalDocument);
  if (legalPages.length === 0) console.log("  Hiç yasal belge sayfası yok.");
  for (const page of legalPages) {
    const localized = pageSlugs.filter((row) => row.entityId === page.id).map((row) => `${row.locale}:${row.slug}`);
    console.log(`  - "${page.title}" [${page.status}] slug=${page.slug}${localized.length ? `  (${localized.join(", ")})` : ""}`);
  }

  console.log("\n== 3) Onay kutuları için gereken yasal metinler (YAYINDA olmalı) ==");
  for (const doc of REQUIRED_LEGAL_DOCUMENTS) {
    const match = legalPages.find((p) => p.status === "PUBLISHED" && (doc.pattern.test(p.title) || doc.pattern.test(p.slug)));
    console.log(`  ${match ? "[ok]" : "[EKSİK]"} ${doc.label}${match ? ` → /${match.slug}` : ""}`);
  }
  console.log("\nNot: Bu script hiçbir şey yazmaz. Eksik metinler hukuk danışmanından alınıp admin panelinden girilmelidir.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
