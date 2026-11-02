import { createElement } from "react";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, ClipboardCheck, FileSearch, PenLine, RefreshCw, ShieldAlert, ShieldCheck, CalendarClock, Send } from "lucide-react";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { formatBlogDate } from "@/lib/blog/format";
import { TRUST_PAGES_UPDATED_ISO, TRUST_PAGE_PATH, buildTrustWebPageJsonLd } from "@/lib/blog/trust-pages";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { MatcherLaunchButton } from "@/components/site/matcher/matcher-modal";
import { IntermediaryNotice } from "@/components/site/intermediary-notice";
import { TrustAlert, TrustCard, TrustHero, TrustLinkButton, TrustSectionTitle, TRUST_CONTAINER } from "./trust-parts";
import { cn } from "@/lib/utils";

const STEP_ICONS = [PenLine, FileSearch, ClipboardCheck, Send, CalendarClock] as const;

/** Paket Z1-ek - `/[lang]/content-standards`: ilke kartlari, surec semasi, uyari kutusu, iki CTA. */
export async function ContentStandardsPage({ lang }: { lang: string }) {
  const [locales, dict, settings] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang), fetchSiteSettingsServer()]);
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocale);
  const t = dict.trustPages;
  const blog = dict.blog;

  const cards = [
    { icon: PenLine, title: t.csWrittenTitle, text: t.csWrittenText },
    { icon: ClipboardCheck, title: t.csReviewTitle, text: t.csReviewText },
    { icon: BookOpenCheck, title: t.csSourcesTitle, text: t.csSourcesText },
    { icon: RefreshCw, title: t.csUpdatesTitle, text: t.csUpdatesText, contact: true },
    { icon: ShieldAlert, title: t.csNotTitle, text: t.csNotText },
  ];
  const steps = [
    { title: t.csStep1Title, text: t.csStep1Text },
    { title: t.csStep2Title, text: t.csStep2Text },
    { title: t.csStep3Title, text: t.csStep3Text },
    { title: t.csStep4Title, text: t.csStep4Text },
    { title: t.csStep5Title, text: t.csStep5Text },
  ];

  return (
    <div dir={localeDirection(lang)} data-testid="trust-content-standards">
      <JsonLdScript
        json={buildTrustWebPageJsonLd({
          url: `${SITE_URL}${localize(TRUST_PAGE_PATH["content-standards"])}`,
          name: t.csTitle,
          description: t.csMetaDescription,
          lang,
          siteName: settings.siteName,
        })}
      />
      <TrustHero
        crumbs={[{ label: dict.common.home, href: localize("/") }, { label: blog.pageTitle, href: localize("/blog") }, { label: t.csTitle }]}
        crumbsAria={blog.breadcrumbAria}
        title={t.csTitle}
        intro={t.csIntro}
        updatedLabel={t.lastUpdated}
        updatedDate={formatBlogDate(TRUST_PAGES_UPDATED_ISO, lang)}
        updatedIso={TRUST_PAGES_UPDATED_ISO}
      />

      <div className={cn(TRUST_CONTAINER, "space-y-14 py-10 sm:space-y-16 sm:py-14")}>
        <section aria-label={t.csPrinciplesAria}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <li key={card.title} className="flex">
                <TrustCard icon={card.icon} title={card.title} className="w-full">
                  <p>{card.text}</p>
                  {card.contact ? (
                    <Link
                      href={localize("/contact")}
                      className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--site-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
                    >
                      {t.contactLink}
                      <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                    </Link>
                  ) : null}
                </TrustCard>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="trust-process" data-testid="trust-process">
          <TrustSectionTitle id="trust-process">{t.csProcessTitle}</TrustSectionTitle>
          <ol aria-label={t.csProcessAria} className="mt-8 grid gap-8 md:grid-cols-5 md:gap-x-6">
            {steps.map((step, index) => (
              <li key={step.title} className="relative flex gap-4 md:flex-col md:gap-3" data-testid="trust-step">
                {index < steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute start-5 top-12 -bottom-8 w-px bg-[var(--site-primary)]/30 md:start-12 md:top-5 md:bottom-auto md:h-px md:w-[calc(100%-3rem+1.5rem)]"
                  />
                ) : null}
                <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-primary)] text-white">
                  {createElement(STEP_ICONS[index]!, { className: "h-5 w-5", "aria-hidden": true })}
                </span>
                <div>
                  <h3 className="font-heading text-base font-semibold text-foreground">
                    <span className="text-[var(--site-primary)]">{index + 1}. </span>
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-foreground/80">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <TrustAlert title={t.csAlertTitle}>{t.csAlertText}</TrustAlert>

        <section className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-testid="trust-ctas">
          <TrustLinkButton href={localize("/blog")}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t.ctaGuides}
          </TrustLinkButton>
          <MatcherLaunchButton variant="outline" />
        </section>

        <IntermediaryNotice strings={dict.intermediary} certificateNo={settings.healthTourismCertificateNo} />
      </div>
    </div>
  );
}
