import { SITE_URL } from "@/lib/env";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { fetchProductsServer } from "@/lib/api/server-products";
import { fetchPortfolioItemsServer } from "@/lib/api/server-portfolio";
import { fetchDoctorsServer, fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { DEFAULT_SETTINGS, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { FALLBACK_LOCALES, fetchLocalesServer } from "@/lib/api/server-locales";
import { withBuildTimeFallback } from "@/lib/api/server-fetch";
import { fetchPackagesServer } from "@/lib/api/server-packages";
import type { PackageSitemapItem, SitemapData } from "./build";

/** Paket X — her açık dil için aktif paket listesi; paket yalnızca içeriği o dilde olan sürümlerle (`contentLocale`) eklenir. */
async function loadPackages(locales: SitemapData["locales"]): Promise<PackageSitemapItem[]> {
  const enabled = locales.filter((l) => l.enabled);
  const order = [...enabled].sort((a, b) => Number(b.code === "en") - Number(a.code === "en"));
  const lists = await Promise.all(order.map(async (l) => ({ code: l.code, items: (await fetchPackagesServer(l.code)).items })));
  const bySlug = new Map<string, PackageSitemapItem>();
  for (const { code, items } of lists) {
    for (const item of items) {
      if (item.contentLocale !== code) continue;
      const entry = bySlug.get(item.slug) ?? { slug: item.slug, locales: [], title: item.title, summary: item.summary };
      entry.locales.push(code);
      bySlug.set(item.slug, entry);
    }
  }
  return [...bySlug.values()];
}

/**
 * Paket S — sitemap ve llms.txt için ortak veri (yalnızca yayımlanmış/aktif içerik dönen public uçlar).
 * Önbellek: `fetchServerJson`'ın içerik etiketleri (sayfa/blog/doktor/uzmanlık/dil kaydında yenilenir);
 * ürün/portföy listelerinde etiket yok — en geç 60 sn'lik `revalidate` ile yenilenir. Liste uçlarının
 * sınırları (blog/ürün/portföy 50, doktor 100) bugünkü içerik sayısının çok üstünde; aşılırsa sayfalama gerekir.
 */
export async function loadSiteContent(): Promise<SitemapData & { siteName: string }> {
  const [pages, posts, products, portfolio, doctors, specialties, settings, locales] = await Promise.all([
    withBuildTimeFallback(() => fetchPublishedPagesServer(), []),
    withBuildTimeFallback(() => fetchBlogPostsServer(), []),
    withBuildTimeFallback(() => fetchProductsServer(), []),
    withBuildTimeFallback(() => fetchPortfolioItemsServer(), []),
    withBuildTimeFallback(() => fetchDoctorsServer({}), []),
    withBuildTimeFallback(() => fetchSpecialtiesServer(), []),
    withBuildTimeFallback(() => fetchSiteSettingsServer(), DEFAULT_SETTINGS),
    withBuildTimeFallback(() => fetchLocalesServer(), FALLBACK_LOCALES),
  ]);
  const packages = await withBuildTimeFallback(() => loadPackages(locales), []);
  return {
    siteUrl: SITE_URL.replace(/\/$/, ""),
    siteName: settings.siteName,
    locales,
    homePageId: settings.homePageId ?? null,
    pages,
    doctors,
    specialties,
    posts,
    products: products as unknown as SitemapData["products"],
    portfolio,
    packages,
  };
}
