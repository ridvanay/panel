import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchBlogPostsServer } from "@/lib/api/server-blog";
import { fetchProductsServer } from "@/lib/api/server-products";
import { fetchPortfolioItemsServer } from "@/lib/api/server-portfolio";
import { fetchDoctorsServer, fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { DEFAULT_SETTINGS, fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { FALLBACK_LOCALES, fetchLocalesServer } from "@/lib/api/server-locales";
import { withBuildTimeFallback } from "@/lib/api/server-fetch";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { ABOUT_PAGE_SLUG } from "@/lib/about-page";
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
  pathPrefix: string,
  /**
   * qa-agent bulgusu (2026-09-16) — ana sayfa bir `Page` kaydı (`slug: "anasayfa"`) olarak
   * modellenir ama PREFİX'SİZ kanonik URL'i HER ZAMAN `/` / `/tr`'dir, kaydın kendi slug'ı DEĞİL.
   * `true` iken her alternate `pathPrefix + slug` yerine kök path (`"/"`) kullanır (`generateMetadata`'daki
   * AYNI `isHomepage` bayrağı, bkz. `lib/seo.ts`).
   */
  isHomepage = false
): Record<string, string> | undefined {
  const languages: Record<string, string> = {};
  for (const item of localizations) {
    if (!item.translated && item.locale !== defaultLocale.code) continue;
    const locale = locales.find((l) => l.code === item.locale);
    if (!locale || !locale.enabled) continue;
    const hreflangKey = locale.hreflang ?? locale.code;
    const path = isHomepage ? "/" : `${pathPrefix}/${item.slug}`;
    const localizedPath = withLocalePrefix(path, locale.code, defaultLocale.code);
    // Kök "/" (varsayılan dilin ana sayfası) `SITE_URL`e trailing-slash EKLEMEDEN birleştirilir —
    // `loc`/`x-default` İLE TUTARLI tek bir kök URL şekli (qa-agent bulgusu, 2026-09-16).
    languages[hreflangKey] = localizedPath === "/" ? SITE_URL : `${SITE_URL}${localizedPath}`;
  }
  if (Object.keys(languages).length === 0) return undefined;
  const defaultItem = localizations.find((l) => l.locale === defaultLocale.code);
  if (defaultItem) languages["x-default"] = isHomepage ? SITE_URL : `${SITE_URL}${pathPrefix}/${defaultItem.slug}`;
  return languages;
}

/**
 * Görev (2026-09-16) — `Specialty`de `translations`/`localizations` YOK (§ görev notu, `doctors/
 * [slug]/page.tsx`'in `DoctorProfile` İLE AYNI durum). `buildLanguageAlternates` (üstteki fonksiyon)
 * `ContentLocalization[]` bekler — burada YOKTUR, bu yüzden `specialties/[slug]/page.tsx`'teki
 * `buildSelfLanguageAlternates` İLE AYNI "kendine referans" deseni kullanılır: AYNI slug her aktif
 * dilin kendi prefix'li URL'sine eşlenir, `x-default` varsayılan dilin prefix'siz URL'sidir.
 */
function buildSpecialtyLanguageAlternates(
  locales: Locale[],
  defaultLocale: Locale,
  pathPrefix: string,
  slug: string
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    const hreflangKey = locale.hreflang ?? locale.code;
    const path = `${pathPrefix}/${slug}`;
    languages[hreflangKey] = `${SITE_URL}${withLocalePrefix(path, locale.code, defaultLocale.code)}`;
  }
  languages["x-default"] = `${SITE_URL}${pathPrefix}/${slug}`;
  return languages;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, posts, products, portfolioItems, doctors, specialties, settings, locales] = await Promise.all([
    withBuildTimeFallback(() => fetchPublishedPagesServer(), []),
    withBuildTimeFallback(() => fetchBlogPostsServer(), []),
    withBuildTimeFallback(() => fetchProductsServer(), []),
    withBuildTimeFallback(() => fetchPortfolioItemsServer(), []),
    // `.claude/architect-scope-telehealth-template.md` §9.5 — `telehealth` modülü kapalıyken
    // `GET /doctors` 404 döner ve `fetchDoctorsServer` bunu `[]`e çevirir (bkz. yorumu);
    // dolayısıyla modül kapalı/hiç doktor yokken aşağıdaki döngü hiçbir girdi üretmez.
    withBuildTimeFallback(() => fetchDoctorsServer({}), []),
    // AYNI gerekçe — `GET /specialties` de `telehealth` modülü kapalıyken 404 döner, `[]`e çevrilir.
    withBuildTimeFallback(() => fetchSpecialtiesServer(), []),
    withBuildTimeFallback(() => fetchSiteSettingsServer(), DEFAULT_SETTINGS),
    withBuildTimeFallback(() => fetchLocalesServer(), FALLBACK_LOCALES),
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
        ? { languages: buildLanguageAlternates(homePage.localizations, locales, defaultLocale, "", true) }
        : undefined,
    },
    {
      url: `${SITE_URL}/blog`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    // Statik `/about` sayfası (`[lang]/(site)/about/page.tsx`) — CMS kaydı olsun olmasın her aktif
    // dilde mevcuttur (kayıt yoksa sözlük metinleri); `buildSpecialtyLanguageAlternates` AYNI
    // "kendine referans" haritasını üretir (`"" + "/about"`). CMS kaydı aşağıdaki sayfa döngüsünde
    // ATLANIR — aynı URL iki kez girmesin.
    {
      url: `${SITE_URL}/${ABOUT_PAGE_SLUG}`,
      lastModified: pages.find((page) => page.slug === ABOUT_PAGE_SLUG)?.updatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
      alternates: { languages: buildSpecialtyLanguageAlternates(locales, defaultLocale, "", ABOUT_PAGE_SLUG) },
    },
  ];

  for (const page of pages) {
    // Ana sayfa olarak seçilen sayfa kök URL'de zaten temsil ediliyor — mükerrer girdi olmasın.
    if (page.id === settings.homePageId) continue;
    // "Hakkımızda" kaydı yukarıdaki statik `/about` girdisiyle temsil ediliyor.
    if (page.slug === ABOUT_PAGE_SLUG) continue;
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

  // `.claude/architect-scope-telehealth-template.md` §9.5 — `/doctors` (statik liste) ve
  // `/doctors/[slug]` (dinamik) girdileri. `DoctorProfile`'da `localizations` YOKTUR (§3.8 —
  // doktor profili `ContentSlug`/i18n sistemine dahil değil), bu yüzden `alternates.languages`
  // ÜRETİLMEZ (`buildLanguageAlternates` burada KULLANILMAZ). `/consultation/*` KASITLI OLARAK
  // eklenmez — o yol zaten `noindex, nofollow` (`consultation/[id]/page.tsx::generateMetadata`).
  // Statik `/doctors` girdisi yalnızca en az bir yayınlanmış (aktif) doktor varsa eklenir —
  // aksi halde modül kapalıyken/hiç doktor yokken 404 dönen bir URL sitemap'e sızardı (kural 3).
  if (doctors.length > 0) {
    entries.push({
      url: `${SITE_URL}/doctors`,
      changeFrequency: "daily",
      priority: 0.7,
    });
    for (const doctor of doctors) {
      entries.push({
        url: `${SITE_URL}/doctors/${doctor.slug}`,
        lastModified: doctor.updatedAt,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  // Görev (2026-09-16) — `/specialties` (statik liste) ve `/specialties/[slug]` girdileri, `/doctors`
  // İLE AYNI "yalnızca modül açık/en az bir aktif branş varsa ekle" kuralı (kural 3 — 404 dönen bir
  // URL sitemap'e sızmasın). `Specialty`de `updatedAt` VAR (`SpecialtySchema`) — `lastModified` olarak
  // kullanılır.
  if (specialties.length > 0) {
    entries.push({
      url: `${SITE_URL}/specialties`,
      changeFrequency: "weekly",
      priority: 0.6,
    });
    for (const specialty of specialties) {
      entries.push({
        url: `${SITE_URL}/specialties/${specialty.slug}`,
        lastModified: specialty.updatedAt,
        changeFrequency: "weekly",
        priority: 0.5,
        alternates: { languages: buildSpecialtyLanguageAlternates(locales, defaultLocale, "/specialties", specialty.slug) },
      });
    }
  }

  return entries;
}
