import type { Metadata } from "next";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { SITE_URL } from "@/lib/env";
import { getSiteDictionary, hasSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";

/**
 * Paket Z1-ek - editoryal guven sayfalari (ozel route'lar; CMS `[slug]` route'unun onune gecer).
 * Metin onay tarihi sabittir (2026-11-01, uydurma degil): sayfa metni degistiginde BU sabit guncellenir.
 */
export const TRUST_PAGES_UPDATED_ISO = "2026-11-01";

export type TrustPageKey = "content-standards" | "medical-reviewers";

export const TRUST_PAGE_PATH: Record<TrustPageKey, string> = {
  "content-standards": "/content-standards",
  "medical-reviewers": "/medical-reviewers",
};

/** Sozlugu olan (9) ve etkin dillerin hepsi icin hreflang + x-default. */
export function buildTrustLanguageAlternates(
  locales: { code: string; enabled: boolean; isDefault: boolean; hreflang: string | null }[],
  key: TrustPageKey
): Record<string, string> {
  const defaultCode = locales.find((l) => l.isDefault)?.code ?? "en";
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled || !hasSiteDictionary(locale.code)) continue;
    languages[locale.hreflang ?? locale.code] = `${SITE_URL}${withLocalePrefix(TRUST_PAGE_PATH[key], locale.code, defaultCode)}`;
  }
  languages["x-default"] = `${SITE_URL}${withLocalePrefix(TRUST_PAGE_PATH[key], defaultCode, defaultCode)}`;
  return languages;
}

export async function buildTrustMetadata(lang: string, key: TrustPageKey): Promise<Metadata> {
  const [locales, dict, settings] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  const defaultCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const t = dict.trustPages;
  const title = key === "content-standards" ? t.csMetaTitle : t.mrMetaTitle;
  const description = key === "content-standards" ? t.csMetaDescription : t.mrMetaDescription;
  const canonical = `${SITE_URL}${withLocalePrefix(TRUST_PAGE_PATH[key], lang, defaultCode)}`;
  return {
    title,
    description,
    alternates: { canonical, languages: buildTrustLanguageAlternates(locales, key) },
    openGraph: { title, description, type: "website", siteName: settings.siteName, url: canonical },
    twitter: { card: "summary", title, description },
  };
}

/** `WebPage` JSON-LD (tek nesne; `</` kacisi `safeJsonLdString` ile). */
export function buildTrustWebPageJsonLd(input: { url: string; name: string; description: string; lang: string; siteName: string }): string {
  return safeJsonLdString({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: input.name,
    description: input.description,
    url: input.url,
    inLanguage: input.lang,
    dateModified: TRUST_PAGES_UPDATED_ISO,
    isPartOf: { "@type": "WebSite", name: input.siteName, url: SITE_URL },
    publisher: { "@type": "Organization", name: input.siteName, url: SITE_URL },
  });
}
