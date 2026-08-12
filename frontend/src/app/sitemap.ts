import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { fetchProductsServer } from "@/lib/api/server-products";
import { fetchPortfolioItemsServer } from "@/lib/api/server-portfolio";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { ContentLocalization, Locale } from "@/lib/api/types";

/**
 * §6.2 çok dilli sitemap — `.claude/architect-scope-i18n.md`. Her içerik için TEK `url` girdisi
 * (varsayılan dil) + `alternates.languages` altında çevrilmiş diller. `translated: false` diller
 * girdiye DAHİL EDİLMEZ (aksi halde Google'a duplicate içerik sunulmuş olur, §6.1 ile AYNI kural).
 *
 * Mevcut sitemap yalnızca Page/BlogPost içeriyordu — Product ve PortfolioItem eksikti; bu,
 * i18n'den bağımsız önceden var olan bir SEO boşluğudur, bu işte KAPATILDI (§6.2 son madde).
 */
function buildLanguageAlternates(
  localizations: ContentLocalization[],
  locales: Locale[],
  defaultLocale: Locale,
  pathPrefix: string
): Record<string, string> | undefined {
  const languages: Record<string, string> = {};
  for (const item of localizations) {
    if (!item.translated && item.locale !== defaultLocale.code) continue;
    const locale = locales.find((l) => l.code === item.locale);
    if (!locale || !locale.enabled) continue;
    const hreflangKey = locale.hreflang ?? locale.code;
    const path = `${pathPrefix}/${item.slug}`;
    languages[hreflangKey] = `${SITE_URL}${withLocalePrefix(path, locale.code, defaultLocale.code)}`;
  }
  if (Object.keys(languages).length === 0) return undefined;
  const defaultItem = localizations.find((l) => l.locale === defaultLocale.code);
  if (defaultItem) languages["x-default"] = `${SITE_URL}${pathPrefix}/${defaultItem.slug}`;
  return languages;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, posts, products, portfolioItems, settings, locales] = await Promise.all([
    fetchPublishedPagesServer(),
    fetchBlogPostsServer(),
    fetchProductsServer(),
    fetchPortfolioItemsServer(),
    fetchSiteSettingsServer(),
    fetchLocalesServer(),
  ]);

  const defaultLocale = locales.find((l) => l.isDefault) ?? locales[0];
  if (!defaultLocale) return [];

  const homePage = pages.find((page) => page.id === settings.homePageId);

  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: homePage?.updatedAt,
      changeFrequency: "daily",
      priority: 1,
      alternates: homePage
        ? { languages: buildLanguageAlternates(homePage.localizations, locales, defaultLocale, "") }
        : undefined,
    },
    {
      url: `${SITE_URL}/blog`,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  for (const page of pages) {
    // Ana sayfa olarak seçilen sayfa kök URL'de zaten temsil ediliyor — mükerrer girdi olmasın.
    if (page.id === settings.homePageId) continue;
    entries.push({
      url: `${SITE_URL}/${page.slug}`,
      lastModified: page.updatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
      alternates: { languages: buildLanguageAlternates(page.localizations, locales, defaultLocale, "") },
    });
  }

  for (const post of posts) {
    entries.push({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: post.updatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
      alternates: { languages: buildLanguageAlternates(post.localizations, locales, defaultLocale, "/blog") },
    });
  }

  // §6.2 — daha önce eksikti (i18n'den bağımsız SEO boşluğu), bu turda eklendi.
  for (const product of products) {
    entries.push({
      url: `${SITE_URL}/products/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
      alternates: { languages: buildLanguageAlternates(product.localizations, locales, defaultLocale, "/products") },
    });
  }

  for (const item of portfolioItems) {
    entries.push({
      url: `${SITE_URL}/portfolio/${item.slug}`,
      lastModified: item.updatedAt,
      changeFrequency: "monthly",
      priority: 0.5,
      alternates: { languages: buildLanguageAlternates(item.localizations, locales, defaultLocale, "/portfolio") },
    });
  }

  return entries;
}
