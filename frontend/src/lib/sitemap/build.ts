import type { ContentLocalization, DoctorProfile, Locale, SitePage, Specialty } from "@/lib/api/types";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { ABOUT_PAGE_SLUG } from "@/lib/about-page";
import type { SitemapEntry, SitemapIndexItem } from "./xml";

/**
 * Paket S — sitemap bölümleri (saf fonksiyonlar; veri `route.ts`'ten verilir, test edilebilir).
 *
 *  - Her URL'nin HER açık dil sürümü kendi `<url>` girdisidir ve hepsi aynı hreflang kümesini
 *    (açık diller + `x-default`) taşır (Google'ın önerdiği biçim). Kapalı diller hiç görünmez.
 *  - `lastmod`: sayfa/yazı görüntülenme sayacı `updatedAt`'i değiştirdiği için CMS içeriğinde
 *    `publishedAt`; doktor ve uzmanlıkta `updatedAt` (sayaçları yok); güvenilir tarih yoksa yazılmaz.
 *  - Hariç: taslak/yayınlanmamış (public uçlar zaten döndürmez), `noIndex`, ana sayfa kopyası/test
 *    sayfaları (ana sayfa olmayan ama `home-page` bloğu taşıyan sayfa — canlıdaki `/home1`),
 *    arşivlenmiş/pasif doktorlar, portal/admin/giriş sayfaları (hiç eklenmez).
 */
export const SITEMAP_SECTIONS = ["pages", "doctors", "specialties", "blog", "products", "portfolio"] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

interface LocalizedContent {
  slug: string;
  localizations?: ContentLocalization[];
  noIndex?: boolean;
  publishedAt?: string | null;
}

export interface SitemapData {
  siteUrl: string;
  locales: Locale[];
  homePageId: string | null;
  pages: SitePage[];
  doctors: DoctorProfile[];
  specialties: Specialty[];
  posts: LocalizedContent[];
  products: LocalizedContent[];
  portfolio: LocalizedContent[];
}

interface Variant {
  hreflang: string;
  path: string;
  isDefault: boolean;
}

function absolute(siteUrl: string, path: string): string {
  return path === "/" ? siteUrl : `${siteUrl}${path}`;
}

function enabledLocales(data: SitemapData): { list: Locale[]; defaultCode: string } {
  const list = data.locales.filter((l) => l.enabled);
  const defaultCode = (list.find((l) => l.isDefault) ?? list[0])?.code ?? "tr";
  return { list, defaultCode };
}

/** Aynı yol, her açık dilde (statik sayfalar, doktorlar, uzmanlıklar). */
function allLocaleVariants(data: SitemapData, path: string): Variant[] {
  const { list, defaultCode } = enabledLocales(data);
  return list.map((l) => ({ hreflang: l.hreflang ?? l.code, path: withLocalePrefix(path, l.code, defaultCode), isDefault: l.code === defaultCode }));
}

/** CMS içeriği: yalnızca çevrilmiş diller (+ varsayılan dil) — çevrilmemiş dil eklenmez (yinelenen içerik). */
function contentVariants(data: SitemapData, item: LocalizedContent, prefix: string, isHomepage = false): Variant[] {
  const { list, defaultCode } = enabledLocales(data);
  const localizations = item.localizations?.length ? item.localizations : [{ locale: defaultCode, slug: item.slug, translated: true } as ContentLocalization];
  const variants: Variant[] = [];
  for (const loc of localizations) {
    if (!loc.translated && loc.locale !== defaultCode) continue;
    const locale = list.find((l) => l.code === loc.locale);
    if (!locale) continue; // kapalı dil
    const path = isHomepage ? "/" : `${prefix}/${loc.slug}`;
    variants.push({ hreflang: locale.hreflang ?? locale.code, path: withLocalePrefix(path, locale.code, defaultCode), isDefault: locale.code === defaultCode });
  }
  return variants;
}

function expand(data: SitemapData, variants: Variant[], lastmod?: string | null, images?: string[]): SitemapEntry[] {
  if (variants.length === 0) return [];
  const alternates =
    variants.length > 1
      ? [
          ...variants.map((v) => ({ hreflang: v.hreflang, href: absolute(data.siteUrl, v.path) })),
          { hreflang: "x-default", href: absolute(data.siteUrl, (variants.find((v) => v.isDefault) ?? variants[0]!).path) },
        ]
      : undefined;
  return variants.map((v) => ({ loc: absolute(data.siteUrl, v.path), lastmod: lastmod ?? null, alternates, images }));
}

function mediaUrl(data: SitemapData, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") ? `${data.siteUrl}${url}` : null;
}

/** Ana sayfa olmayan ama şablon ana sayfa bloğunu taşıyan sayfa (ör. canlıdaki `/home1`) — kopya/test. */
export function isHomepageDuplicate(page: SitePage, homePageId: string | null): boolean {
  if (page.id === homePageId) return false;
  return (page.blocks ?? []).some((block) => (block as { type?: string }).type === "home-page");
}

export function buildSection(section: SitemapSection, data: SitemapData): SitemapEntry[] {
  switch (section) {
    case "pages": {
      const home = data.pages.find((p) => p.id === data.homePageId);
      const about = data.pages.find((p) => p.slug === ABOUT_PAGE_SLUG);
      const entries: SitemapEntry[] = [
        ...expand(data, home ? contentVariants(data, home, "", true) : allLocaleVariants(data, "/"), home?.publishedAt),
        ...expand(data, allLocaleVariants(data, `/${ABOUT_PAGE_SLUG}`), about?.publishedAt),
        ...expand(data, allLocaleVariants(data, "/contact")),
      ];
      for (const page of data.pages) {
        if (page.id === data.homePageId || page.slug === ABOUT_PAGE_SLUG) continue;
        if (page.noIndex || (page.status && page.status !== "PUBLISHED") || isHomepageDuplicate(page, data.homePageId)) continue;
        entries.push(...expand(data, contentVariants(data, page, ""), page.publishedAt));
      }
      return entries;
    }
    case "doctors": {
      const doctors = data.doctors.filter((d) => d.isActive !== false && !d.archivedAt);
      if (doctors.length === 0) return [];
      const entries = expand(data, allLocaleVariants(data, "/doctors"));
      for (const doctor of doctors) {
        const avatar = mediaUrl(data, doctor.avatarMedia?.url);
        entries.push(...expand(data, allLocaleVariants(data, `/doctors/${doctor.slug}`), doctor.updatedAt, avatar ? [avatar] : undefined));
      }
      return entries;
    }
    case "specialties": {
      const specialties = data.specialties.filter((s) => s.isActive !== false);
      if (specialties.length === 0) return [];
      const entries = expand(data, allLocaleVariants(data, "/specialties"));
      for (const s of specialties) entries.push(...expand(data, allLocaleVariants(data, `/specialties/${s.slug}`), (s as { updatedAt?: string }).updatedAt));
      return entries;
    }
    case "blog":
    case "products":
    case "portfolio": {
      const items = (section === "blog" ? data.posts : section === "products" ? data.products : data.portfolio).filter((i) => !i.noIndex);
      if (items.length === 0) return [];
      const prefix = section === "blog" ? "/blog" : section === "products" ? "/products" : "/portfolio";
      const entries = expand(data, allLocaleVariants(data, prefix));
      for (const item of items) entries.push(...expand(data, contentVariants(data, item, prefix), item.publishedAt));
      return entries;
    }
  }
}

/** Index: yalnızca girdisi olan bölümler (blog yalnızca yayımlanmış yazı varsa). */
export function buildIndex(data: SitemapData): SitemapIndexItem[] {
  const items: SitemapIndexItem[] = [];
  for (const section of SITEMAP_SECTIONS) {
    const entries = buildSection(section, data);
    if (entries.length === 0) continue;
    const dates = entries.map((e) => (e.lastmod ? new Date(e.lastmod).getTime() : NaN)).filter((t) => !Number.isNaN(t));
    items.push({ loc: `${data.siteUrl}/sitemaps/${section}.xml`, lastmod: dates.length ? new Date(Math.max(...dates)).toISOString() : null });
  }
  return items;
}
