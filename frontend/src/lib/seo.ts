import type { Metadata } from "next";
import type { ContentLocalization, Locale } from "@/lib/api/types";
import { SITE_URL } from "@/lib/env";
import { withLocalePrefix } from "@/lib/i18n/site-path";

/**
 * `SitePage`/`BlogPost`/`Product`/`PortfolioItem` içerik türlerinin ortak SEO alanlarından
 * `generateMetadata` çıktısı üretir. Sadece (site) route grubundaki içerik detay sayfaları
 * kullanır (bkz. `[slug]/page.tsx`, `blog/[slug]/page.tsx`, kök `[lang]/page.tsx`).
 */
export interface SeoContentFields {
  /** Zaten çözümlenmiş, gösterilecek başlık (örn. `page.seoTitle || page.title`). */
  title: string;
  /** Meta açıklaması — `null`/boşsa `description` alanı hiç set edilmez. */
  description: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
}

export interface BuildContentMetadataOptions {
  /** `canonicalUrl` boşsa kullanılacak mutlak URL (bkz. `sitemap.ts`'teki ana sayfa istisnası). */
  fallbackCanonicalUrl: string;
  /** Ayarlar'daki genel site adı — `openGraph.siteName` için kullanılır. */
  siteName: string;
  type?: "website" | "article";
  /** `ogImageUrl` boşsa kullanılacak ek görsel (örn. blog kapak görseli). */
  fallbackImageUrl?: string | null;
  /**
   * §6.1 hreflang — içeriğin TÜM dillerdeki slug/çeviri durumu. Verilirse `alternates.languages`
   * + `x-default` üretilir (yalnızca `translated: true` olan diller, `.claude/architect-scope-i18n.md`
   * §6.1 — çevrilmemiş dil için alternate ÜRETİLMEZ, aksi halde Google'a duplicate içerik sunulur).
   */
  localizations?: ContentLocalization[];
  /** `GET /locales` — hreflang anahtarı `Locale.hreflang ?? code` ile üretilir. */
  locales?: Locale[];
  /** Bu sayfanın render edildiği aktif dil kodu — kendi dilinin canonical'ı bunun üzerinden kurulur. */
  activeLocale?: string;
  /** İçerik türünün URL öneki (`""` Page, `"/blog"`, `"/products"`, `"/portfolio"`). */
  pathPrefix?: string;
}

export function buildContentMetadata(fields: SeoContentFields, options: BuildContentMetadataOptions): Metadata {
  const description = fields.description ?? undefined;
  const ogTitle = fields.ogTitle || fields.title;
  const imageUrl = fields.ogImageUrl || options.fallbackImageUrl || null;
  const images = imageUrl ? [imageUrl] : undefined;
  const canonical = fields.canonicalUrl || options.fallbackCanonicalUrl;

  const metadata: Metadata = {
    title: fields.title,
    description,
    alternates: { canonical, ...buildLanguageAlternates(options) },
    openGraph: {
      title: ogTitle,
      description,
      type: options.type ?? "website",
      siteName: options.siteName,
      images,
      locale: resolveOgLocale(options),
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: ogTitle,
      description,
      images,
    },
  };

  if (fields.noIndex) {
    metadata.robots = { index: false, follow: false };
  }

  return metadata;
}

/**
 * §6.1 — `alternates.languages` + zorunlu `x-default`. `locales`/`localizations` verilmemişse
 * (henüz i18n'e taşınmamış bir çağrı yeri — geriye dönük uyumluluk) boş obje döner.
 */
function buildLanguageAlternates(options: BuildContentMetadataOptions): { languages?: Record<string, string> } {
  if (!options.localizations || !options.locales || options.pathPrefix === undefined) return {};

  const defaultLocale = options.locales.find((l) => l.isDefault);
  if (!defaultLocale) return {};

  const languages: Record<string, string> = {};
  for (const item of options.localizations) {
    // Çevrilmemiş dil için alternate ÜRETİLMEZ (bağlayıcı SEO kuralı, §6.1).
    if (!item.translated && item.locale !== defaultLocale.code) continue;
    const locale: Locale | undefined = options.locales.find((l) => l.code === item.locale);
    if (!locale || !locale.enabled) continue;
    const hreflangKey = locale.hreflang ?? locale.code;
    const path = `${options.pathPrefix}/${item.slug}`;
    const localizedPath = withLocalePrefix(path, locale.code, defaultLocale.code);
    languages[hreflangKey] = `${SITE_URL}${localizedPath}`;
  }

  if (Object.keys(languages).length === 0) return {};

  const defaultItem = options.localizations.find((l) => l.locale === defaultLocale.code);
  const defaultPath = defaultItem ? `${options.pathPrefix}/${defaultItem.slug}` : undefined;
  // `x-default` ZORUNLUDUR ve varsayılan dilin prefix'siz URL'sini gösterir (§6.1).
  if (defaultPath) {
    languages["x-default"] = `${SITE_URL}${defaultPath}`;
  }

  return { languages };
}

function resolveOgLocale(options: BuildContentMetadataOptions): string | undefined {
  if (!options.activeLocale || !options.locales) return undefined;
  const locale = options.locales.find((l) => l.code === options.activeLocale);
  return locale?.hreflang ?? locale?.code;
}
