import Link from "next/link";
import type { PackageCardData, PackageCategory } from "@/lib/api/types";
import type { PackagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";
import { PackageCard } from "./package-card";
import { categoryLabel } from "./package-format";
import { cn } from "@/lib/utils";

/**
 * Paket X — `/packages` gövdesi (sunucu, saf): kategori filtre bağlantıları (`?category=`), kart ızgarası ve boş durum.
 * `categories` filtresiz listeden gelir (filtre çipleri hep tam küme kalır).
 */
export function PackagesPageView({
  t,
  items,
  categories,
  active,
  basePath,
  intlLocale,
  localize,
  dir,
}: {
  t: PackagesStrings;
  items: PackageCardData[];
  categories: PackageCategory[];
  active: PackageCategory | null;
  basePath: string;
  intlLocale: string;
  localize: (path: string) => string;
  dir?: "ltr" | "rtl";
}) {
  const chip = (selected: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]",
      selected ? "border-[var(--site-primary)] bg-[var(--site-primary)] text-white" : "border-border bg-background text-foreground hover:border-[var(--site-primary)]"
    );
  return (
    <div data-testid="packages-page" dir={dir} className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t.pageTitle}</h1>
      <p className="mt-2 max-w-3xl text-base text-foreground/70">{t.pageIntro}</p>

      {categories.length > 0 && (
        <nav aria-label={t.filterAria} className="mt-6 flex flex-wrap gap-2" data-testid="packages-filter">
          <Link href={basePath} aria-current={active === null ? "page" : undefined} className={chip(active === null)}>
            {t.allCategories}
          </Link>
          {categories.map((category) => (
            <Link key={category} href={`${basePath}?category=${category}`} aria-current={active === category ? "page" : undefined} className={chip(active === category)}>
              {categoryLabel(t, category)}
            </Link>
          ))}
        </nav>
      )}

      {items.length === 0 ? (
        <p className="mt-10 rounded-[var(--site-radius)] border border-border bg-surface p-6 text-center text-sm text-foreground/70" data-testid="packages-empty">
          {active ? t.emptyCategory : t.noPackages}
        </p>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="packages-grid">
          {items.map((pkg, index) => (
            <li key={pkg.id} className="flex">
              <PackageCard pkg={pkg} t={t} intlLocale={intlLocale} priority={index < 3} action={{ kind: "link", href: localize(`/packages/${pkg.slug}`) }} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
