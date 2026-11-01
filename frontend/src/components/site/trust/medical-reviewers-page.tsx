import Link from "next/link";
import { ArrowRight, BadgeCheck, Check, ClipboardList, Users } from "lucide-react";
import { fetchBlogReviewersServer } from "@/lib/api/server-blog";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import type { PublicBlogReviewerItem } from "@/lib/api/types";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SITE_URL } from "@/lib/env";
import { fillBlogString, formatBlogDate } from "@/lib/blog/format";
import { TRUST_PAGES_UPDATED_ISO, TRUST_PAGE_PATH, buildTrustWebPageJsonLd } from "@/lib/blog/trust-pages";
import { JsonLdScript } from "@/components/site/json-ld-script";
import { BlogAvatar } from "@/components/site/blog/blog-article-parts";
import { TrustCard, TrustHero, TrustLinkButton, TrustSectionTitle, TRUST_CONTAINER } from "./trust-parts";
import { cn } from "@/lib/utils";

/** `name` unvani zaten iceriyorsa unvan ayrica yazilmaz (yinelenen "Prof. Dr. Prof. Dr. ..." onlenir). */
export function reviewerTitleLine(reviewer: Pick<PublicBlogReviewerItem, "name" | "title">): string | null {
  const title = reviewer.title?.trim();
  if (!title) return null;
  return reviewer.name.toLowerCase().includes(title.toLowerCase()) ? null : title;
}

/**
 * Paket Z1-ek - `/[lang]/medical-reviewers`: Editorial Team karti, "What a review covers" ikonlu liste ve
 * inceleyen hekimler izgarasi. Izgara YALNIZCA `/blog/reviewers` ucunun dondurdugu hekimleri gosterir (uc,
 * en az bir yaziyi onaylamis ve herkese acik hekimlerle sinirlidir); liste bossa notr bir cumle cikar.
 */
export async function MedicalReviewersPage({ lang }: { lang: string }) {
  const [locales, dict, settings, reviewers] = await Promise.all([
    fetchLocalesServer(),
    getSiteDictionary(lang),
    fetchSiteSettingsServer(),
    fetchBlogReviewersServer(lang),
  ]);
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocale);
  const t = dict.trustPages;
  const blog = dict.blog;
  const covers = [t.mrCover1, t.mrCover2, t.mrCover3];

  return (
    <div dir={localeDirection(lang)} data-testid="trust-medical-reviewers">
      <JsonLdScript
        json={buildTrustWebPageJsonLd({
          url: `${SITE_URL}${localize(TRUST_PAGE_PATH["medical-reviewers"])}`,
          name: t.mrTitle,
          description: t.mrMetaDescription,
          lang,
          siteName: settings.siteName,
        })}
      />
      <TrustHero
        crumbs={[{ label: dict.common.home, href: localize("/") }, { label: blog.pageTitle, href: localize("/blog") }, { label: t.mrTitle }]}
        crumbsAria={blog.breadcrumbAria}
        title={t.mrTitle}
        intro={t.mrIntro}
        updatedLabel={t.lastUpdated}
        updatedDate={formatBlogDate(TRUST_PAGES_UPDATED_ISO, lang)}
        updatedIso={TRUST_PAGES_UPDATED_ISO}
      />

      <div className={cn(TRUST_CONTAINER, "space-y-14 py-10 sm:space-y-16 sm:py-14")}>
        <section className="grid gap-4 lg:grid-cols-2" data-testid="trust-editorial">
          <TrustCard icon={Users} title={t.mrEditorialTitle}>
            <p>{t.mrEditorialText}</p>
          </TrustCard>
          <TrustCard icon={ClipboardList} title={t.mrCoversTitle}>
            <ul className="space-y-2" data-testid="trust-covers">
              {covers.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-foreground/70">{t.mrCoversNote}</p>
          </TrustCard>
        </section>

        <section aria-labelledby="trust-reviewers" data-testid="trust-reviewers">
          <TrustSectionTitle id="trust-reviewers">{t.mrReviewersTitle}</TrustSectionTitle>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-foreground/80">{t.mrReviewersText}</p>
          {reviewers.length > 0 ? (
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="trust-reviewer-grid">
              {reviewers.map((reviewer) => {
                const titleLine = reviewerTitleLine(reviewer);
                return (
                  <li key={reviewer.slug} className="flex flex-col rounded-[var(--site-radius)] border border-border bg-background p-5" data-testid="trust-reviewer-card">
                    <div className="flex items-center gap-4">
                      <BlogAvatar src={reviewer.avatarUrl} size={64} />
                      <div className="min-w-0">
                        {titleLine ? <p className="text-xs font-medium uppercase tracking-wide text-foreground/70">{titleLine}</p> : null}
                        <p className="font-heading text-base font-semibold text-foreground">{reviewer.name}</p>
                        {reviewer.specialty ? <p className="text-sm text-foreground/70">{reviewer.specialty.name}</p> : null}
                      </div>
                    </div>
                    <p className="mt-4 flex items-center gap-1.5 text-sm text-foreground/80">
                      <BadgeCheck className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                      {fillBlogString(t.mrReviewedCount, { n: reviewer.approvedCount })}
                    </p>
                    <Link
                      href={localize(`/physicians/${reviewer.slug}`)}
                      aria-label={fillBlogString(blog.profileAria, { name: reviewer.name })}
                      className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--site-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
                    >
                      {t.profileLink}
                      <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-6 rounded-[var(--site-radius)] border border-dashed border-border p-6 text-base text-foreground/80" data-testid="trust-reviewers-empty">
              {t.mrReviewersEmpty}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-[var(--site-radius)] border border-border bg-[var(--site-primary)]/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" data-testid="trust-contact">
          <p className="max-w-2xl text-base text-foreground/85">{t.mrContactText}</p>
          <TrustLinkButton href={localize("/contact")} variant="outline">
            {t.contactLink}
          </TrustLinkButton>
        </section>
      </div>
    </div>
  );
}
