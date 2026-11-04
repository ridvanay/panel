import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { PackageCardData } from "@/lib/api/types";
import type { BlogStrings } from "@/lib/i18n/site-dictionaries/en/blog";
import type { PackagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";
import { FindTreatmentGate } from "@/components/site/site-features-context";
import { MatcherLaunchButton } from "@/components/site/matcher/matcher-modal";
import { PackageCard } from "@/components/site/packages/package-card";

/** Paket Z1 — liste ara CTA: "Not sure which physician you need?" + W sihirbazı düğmesi ("Find my physician"). */
export function BlogFindPhysicianCta({ t }: { t: BlogStrings }) {
  return (
    <FindTreatmentGate>
      <aside className="rounded-[var(--site-radius)] border border-border bg-[var(--site-primary)]/5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6" data-testid="blog-find-physician-cta">
        <div>
          <p className="font-heading text-lg font-semibold text-foreground">{t.ctaTitle}</p>
          <p className="mt-1 text-sm text-foreground/70">{t.ctaText}</p>
        </div>
        <MatcherLaunchButton className="mt-4 w-full sm:mt-0 sm:w-auto sm:shrink-0" />
      </aside>
    </FindTreatmentGate>
  );
}

/**
 * Paket Z1 — "Popular packages" (Paket X). `items` boşsa HİÇBİR ŞEY çizilmez (aktif paket yoksa başlık da yok).
 * Öne çıkan paketler önceliklidir; yoksa aktif paketlerin ilk üçü. Fiyat yalnızca paket `showPrice` açtıysa gelir.
 */
export function pickPopularPackages(items: PackageCardData[], limit = 3): PackageCardData[] {
  const featured = items.filter((p) => p.isFeatured);
  return (featured.length > 0 ? featured : items).slice(0, limit);
}

export function BlogPopularPackages({
  items,
  t,
  packagesStrings,
  intlLocale,
  hrefFor,
  allHref,
}: {
  items: PackageCardData[];
  t: BlogStrings;
  packagesStrings: PackagesStrings;
  intlLocale: string;
  hrefFor: (slug: string) => string;
  allHref: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="blog-popular-packages" className="mt-12" data-testid="blog-popular-packages">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="blog-popular-packages" className="font-heading text-2xl font-semibold text-foreground">
          {t.popularPackages}
        </h2>
        <Link href={allHref} className="text-sm font-medium text-[var(--site-primary)] hover:underline">
          {packagesStrings.viewAll}
        </Link>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} t={packagesStrings} intlLocale={intlLocale} action={{ kind: "link", href: hrefFor(pkg.slug) }} />
        ))}
      </div>
    </section>
  );
}

/** Paket Z1 — editoryal güven satırı. Yalnızca YAYINDAKİ CMS sayfalarının bağlantıları gelir; hiçbiri yoksa satır çizilmez. */
export function BlogTrustLinks({ links, t }: { links: { label: string; href: string }[]; t: BlogStrings }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={t.trustAria} className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-6 text-sm text-foreground/70" data-testid="blog-trust-links">
      <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
      {links.map((link, index) => (
        <span key={link.href} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <Link href={link.href} className="font-medium text-foreground hover:text-[var(--site-primary)] hover:underline">
            {link.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
