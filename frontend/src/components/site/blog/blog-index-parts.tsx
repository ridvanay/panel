import { createElement } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { PublicBlogTopicGroup, Specialty } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import { fillBlogString } from "@/lib/blog/format";
import { specialtyIconFor, specialtyToneFor } from "@/lib/blog/specialty-icon";
import { cn } from "@/lib/utils";
import { ContactCta } from "@/components/site/contact/contact-cta";
import { FindTreatmentGate } from "@/components/site/site-features-context";
import { MatcherLaunchButton } from "@/components/site/matcher/matcher-modal";

/**
 * Paket Z1-ek - blog ust bandi: marka tonunda hafif zemin (yalnizca tema tokenlari). Baslik, aciklama, arama (cocuk)
 * ve guven satiri ("Reviewed by physicians - Sources cited - Regularly updated" -> Content standards).
 */
export function BlogHero({ breadcrumb, t, trustHref, children }: { breadcrumb: React.ReactNode; t: BlogStrings; trustHref: string; children: React.ReactNode }) {
  const items = [t.trustReviewed, t.trustSources, t.trustUpdated];
  return (
    <header className="border-b border-border bg-[var(--site-primary)]/5" data-testid="blog-hero">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        {breadcrumb}
        <h1 className="mt-5 max-w-3xl font-heading text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{t.pageTitle}</h1>
        <p className="mt-3 max-w-3xl text-base text-foreground/80 sm:text-lg">{t.pageIntro}</p>
        {children}
        <Link
          href={trustHref}
          aria-label={t.contentStandards}
          title={t.contentStandards}
          className="mt-5 inline-flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-md text-sm font-medium text-foreground/80 hover:text-[var(--site-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
          data-testid="blog-trust-line"
        >
          <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
          {items.map((item, index) => (
            <span key={item} className="inline-flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <span className="underline-offset-4 hover:underline">{item}</span>
            </span>
          ))}
        </Link>
      </div>
    </header>
  );
}

/**
 * "Browse by specialty": aktif uzmanliklardan ikonlu kartlar. Yazisi olan uzmanlik -> filtre + gercek yazi sayisi
 * (`/blog/topics` sayilarindan); yazisi olmayan -> uzmanlik sayfasi ve SAYI YOK (sahte sayi yazilmaz).
 */
export function BlogSpecialtyBrowse({
  specialties,
  groups,
  activeTopic,
  t,
  filterHref,
  specialtyHref,
}: {
  specialties: Pick<Specialty, "slug" | "name">[];
  groups: PublicBlogTopicGroup[];
  activeTopic: string;
  t: BlogStrings;
  filterHref: (slug: string) => string;
  specialtyHref: (slug: string) => string;
}) {
  if (specialties.length === 0) return null;
  const counts = new Map(groups.map((g) => [g.specialty.slug, g.count]));
  return (
    <section aria-labelledby="blog-specialties" className="mt-10" data-testid="blog-specialties">
      <h2 id="blog-specialties" className="font-heading text-2xl font-semibold text-foreground">
        {t.specialtiesTitle}
      </h2>
      <ul aria-label={t.specialtiesAria} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {specialties.map((specialty) => {
          const count = counts.get(specialty.slug) ?? 0;
          const hasPosts = count > 0;
          const tone = specialtyToneFor(specialty.slug);
          const active = activeTopic === specialty.slug;
          return (
            <li key={specialty.slug} className="flex">
              <Link
                href={hasPosts ? filterHref(specialty.slug) : specialtyHref(specialty.slug)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group flex min-h-11 w-full items-center gap-3 rounded-[var(--site-radius)] border bg-background p-3 transition-colors duration-300 hover:border-[var(--site-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] motion-reduce:transition-none",
                  active ? "border-[var(--site-primary)]" : "border-border"
                )}
                data-testid="blog-specialty-card"
                data-has-posts={hasPosts ? "true" : "false"}
              >
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tone.soft)}>
                  {createElement(specialtyIconFor(specialty.slug), { className: "h-5 w-5", "aria-hidden": true })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{specialty.name}</span>
                  <span className="block truncate text-xs text-foreground/70" data-testid="blog-specialty-meta">
                    {hasPosts ? fillBlogString(t.specialtyGuides, { n: count }) : t.specialtyView}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-foreground/40 transition-colors group-hover:text-[var(--site-primary)] rtl:-scale-x-100" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Hic yayinda yazi yokken (filtre/arama yokken) gosterilen duzgun bos durum. "Articles: 0" ya da bos izgara YOK;
 * hekim bulucu + hasta koordinatoru eylemleri (Paket W / Paket X).
 */
export function BlogEmptyState({ t }: { t: BlogStrings }) {
  return (
    <section aria-labelledby="blog-empty-title" className="mt-10 rounded-[var(--site-radius)] border border-border bg-[var(--site-primary)]/5 p-6 text-center sm:p-10" data-testid="blog-empty">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]">
        <ShieldCheck className="h-7 w-7" aria-hidden="true" />
      </span>
      <h2 id="blog-empty-title" className="mt-4 font-heading text-xl font-semibold text-foreground sm:text-2xl">
        {t.emptyBlog}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-base text-foreground/75">{t.emptyBlogText}</p>
      <FindTreatmentGate>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <MatcherLaunchButton className="w-full sm:w-auto" />
        </div>
      </FindTreatmentGate>
    </section>
  );
}

/** "Talk to a patient coordinator": canli destek / WhatsApp / geri arama (Paket X `ContactCta`, yonetici ayarlarina gore). */
export function BlogCoordinatorCta({ t }: { t: BlogStrings }) {
  return (
    <aside className="mt-8 rounded-[var(--site-radius)] border border-border bg-background p-5 sm:p-6" data-testid="blog-coordinator-cta" aria-labelledby="blog-coordinator-title">
      <h2 id="blog-coordinator-title" className="font-heading text-lg font-semibold text-foreground">
        {t.coordinatorTitle}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-foreground/75">{t.coordinatorText}</p>
      <ContactCta topic={t.pageTitle} className="mt-4" />
    </aside>
  );
}
