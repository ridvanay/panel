import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchReviewsListServer } from "@/lib/api/server-telehealth";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { isReviewsFiltered, parseReviewsQuery, reviewsQueryString } from "@/lib/review-query";
import { SITE_URL } from "@/lib/env";
import { ReviewsPageView } from "@/components/site/reviews/reviews-page-view";

/**
 * Paket AE — `/[lang]/reviews`: herkese açık hasta yorumları (hekim / dil / en az puan filtresi, sayfalama).
 * Filtreler ve sayfa URL sorgusundadır (paylaşılabilir). Telehealth modülü kapalıysa 404.
 * Sıralamayı (ziyaretçi dili önce) sunucu yapar; `locale` bu yüzden uca iletilir.
 */
type PageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [rawQuery, locales, dict] = await Promise.all([searchParams, fetchLocalesServer(), getSiteDictionary(lang)]);
  const query = parseReviewsQuery(rawQuery);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const basePath = withLocalePrefix("/reviews", lang, defaultLocaleCode);
  // Filtreli görünüm `noindex` + temel yola canonical (sonsuz kombinasyon kopya içerik üretmesin);
  // yalnızca sayfalama kendi canonical'ını taşır.
  const filtered = isReviewsFiltered(query);
  const canonical = `${SITE_URL}${basePath}${filtered ? "" : reviewsQueryString({ page: query.page })}`;

  const languages: Record<string, string> = {};
  for (const locale of locales) {
    if (!locale.enabled) continue;
    languages[locale.hreflang ?? locale.code] = `${SITE_URL}${withLocalePrefix("/reviews", locale.code, defaultLocaleCode)}`;
  }
  languages["x-default"] = `${SITE_URL}${withLocalePrefix("/reviews", defaultLocaleCode, defaultLocaleCode)}`;

  const title = dict.reviews.reviewsPageTitle;
  const description = dict.reviews.reviewsPageMetaDescription;
  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: { title, description, type: "website", url: canonical },
    twitter: { card: "summary", title, description },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ReviewsPage({ params, searchParams }: PageProps) {
  const { lang } = await params;
  if (!(await isModuleEnabledServer("telehealth"))) notFound();

  const query = parseReviewsQuery(await searchParams);
  const [locales, dict, data] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchReviewsListServer({ locale: lang, doctor: query.doctor, language: query.language, minRating: query.minRating, page: query.page }),
  ]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  return (
    <ReviewsPageView
      t={dict.reviews}
      data={data}
      query={query}
      basePath={withLocalePrefix("/reviews", lang, defaultLocaleCode)}
      intlLocale={contentLocaleToIntl(lang)}
      defaultLocaleCode={defaultLocaleCode}
      dir={localeDirection(lang)}
    />
  );
}
