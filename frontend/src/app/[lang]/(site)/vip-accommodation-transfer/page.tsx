import type { Metadata } from "next";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { VIP_IMAGE_PAGE_SLUG, extractVipImages } from "@/lib/vip-images";
import { VipPageContent } from "@/components/site/vip/vip-page-content";

/**
 * Paket AJ (AJ-3) — VIP konaklama ve transfer, zengin içerik (6 ikonlu kart, yolculuk şeridi, CTA bandı).
 * FİYAT YOK, abartılı vaat YOK; her bölümde ve sayfa sonunda talep formuna giden düğme. 8 dil (sözlük `vip`).
 * Görseller CMS sayfasından gelir (`lib/vip-images.ts`); yoksa ikonlu yer tutucu.
 */
type PageProps = { params: Promise<{ lang: string }> };

const PATH = "/vip-accommodation-transfer";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [locales, dict, settings] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const canonical = `${SITE_URL}${withLocalePrefix(PATH, lang, defaultLocaleCode)}`;
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    languages[locale.hreflang ?? locale.code] = `${SITE_URL}${withLocalePrefix(PATH, locale.code, defaultLocaleCode)}`;
  }
  languages["x-default"] = `${SITE_URL}${withLocalePrefix(PATH, defaultLocaleCode, defaultLocaleCode)}`;
  const title = dict.vip.metaTitle;
  const description = dict.vip.metaDescription;
  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: { title, description, type: "website", siteName: settings.siteName, url: canonical },
    twitter: { card: "summary", title, description },
  };
}

export default async function VipAccommodationTransferPage({ params }: PageProps) {
  const { lang } = await params;
  const [locales, dict, settings, imagePage] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(),
    fetchPageBySlugServer(VIP_IMAGE_PAGE_SLUG, lang).catch(() => null),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocaleCode);

  return (
    <div dir={localeDirection(lang)}>
      <VipPageContent
        strings={dict.vip}
        intermediary={dict.intermediary}
        certificateNo={settings.healthTourismCertificateNo}
        images={extractVipImages(imagePage?.blocks)}
        hrefs={{ request: localize("/request"), find: localize("/find-your-treatment") }}
      />
    </div>
  );
}
