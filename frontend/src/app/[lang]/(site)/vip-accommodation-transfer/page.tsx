import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, Car, Headset, Languages, MapPinned, Plane, type LucideIcon } from "lucide-react";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";

/**
 * Paket AH — VIP konaklama ve transfer (sade sayfa; Faz 2 de zenginleşecek). FİYAT YOK, abartılı vaat yok;
 * her bölümde ve sayfa sonunda "Request" düğmesi talep formuna gider. 8 dil (sözlük `request.vip*`).
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
  const title = dict.request.vipMetaTitle;
  const description = dict.request.vipMetaDescription;
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
  const [locales, dict, settings] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const requestHref = withLocalePrefix("/request", lang, defaultLocaleCode);
  const t = dict.request;

  const items: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: Plane, title: t.vipTransferTitle, text: t.vipTransferText },
    { icon: BedDouble, title: t.vipStayTitle, text: t.vipStayText },
    { icon: Car, title: t.vipCompanionTitle, text: t.vipCompanionText },
    { icon: Languages, title: t.vipInterpreterTitle, text: t.vipInterpreterText },
    { icon: MapPinned, title: t.vipCityTitle, text: t.vipCityText },
    { icon: Headset, title: t.vipCoordinatorTitle, text: t.vipCoordinatorText },
  ];
  const buttonClass =
    "inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]";

  return (
    <div dir={localeDirection(lang)} className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14" data-testid="vip-page">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t.vipTitle}</h1>
      <p className="mt-3 max-w-3xl text-base text-foreground/80">{t.vipIntro}</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="vip-items">
        {items.map((item) => (
          <li key={item.title} className="flex flex-col rounded-[var(--site-radius)] border border-border bg-surface p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]">
              <item.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 font-heading text-lg font-semibold text-foreground">{item.title}</h2>
            <p className="mt-1 flex-1 text-sm text-foreground/75">{item.text}</p>
            <Link href={requestHref} className={`${buttonClass} mt-4 w-full sm:w-fit`} data-testid="vip-request">
              {t.vipRequestCta}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-foreground/70">{t.vipNote}</p>
      <div className="mt-6">
        <Link href={requestHref} className={buttonClass}>
          {t.requestCta}
        </Link>
      </div>

      <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} className="mt-10" />
    </div>
  );
}
