import Link from "next/link";
import { Clock, HeartPulse } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import type { PackageCardData } from "@/lib/api/types";
import type { PackagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";
import { cn } from "@/lib/utils";
import { categoryLabel, fill, formatPackagePrice } from "./package-format";

type Action = { kind: "button"; onSelect: (pkg: PackageCardData) => void } | { kind: "link"; href: string };

/**
 * Paket X — paket kartı. `button`: yan panelde ayrıntı sheet'ini açar; `link`: /packages ızgarasında ayrıntı sayfasına gider.
 * Fiyat yalnızca `pkg.price` doluysa (yönetici `showPrice` açtıysa) ve her zaman kesin-fiyat notuyla gösterilir.
 */
export function PackageCard({
  pkg,
  t,
  intlLocale,
  action,
  variant = "grid",
  priority = false,
}: {
  pkg: PackageCardData;
  t: PackagesStrings;
  intlLocale: string;
  action: Action;
  variant?: "grid" | "compact";
  priority?: boolean;
}) {
  const compact = variant === "compact";
  const body = (
    <>
      <span className={cn("relative block shrink-0 overflow-hidden bg-[var(--site-primary)]/10", compact ? "h-16 w-16 rounded-md" : "aspect-[16/9] w-full")}>
        {pkg.cover ? (
          <SafeImage src={pkg.cover.url} alt={pkg.cover.alt ?? ""} fill sizes={compact ? "64px" : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"} priority={priority} className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--site-primary)]">
            <HeartPulse className={compact ? "h-6 w-6" : "h-10 w-10"} aria-hidden="true" />
          </span>
        )}
      </span>
      <span className={cn("block min-w-0", compact ? "flex-1" : "p-4")}>
        <span className="block text-xs font-medium uppercase tracking-wide text-[var(--site-primary)]">{categoryLabel(t, pkg.category)}</span>
        <span className={cn("mt-0.5 block font-heading font-semibold text-foreground", compact ? "line-clamp-2 text-sm" : "text-lg")}>{pkg.title}</span>
        {!compact && pkg.summary && <span className="mt-1 line-clamp-3 block text-sm text-foreground/70">{pkg.summary}</span>}
        {pkg.duration && (
          <span className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground/70">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {pkg.duration}
          </span>
        )}
        {pkg.price && (
          <span className="mt-1.5 block text-xs text-foreground/80" data-testid="package-card-price">
            <span className="font-semibold text-foreground">{fill(t.priceFrom, { price: formatPackagePrice(pkg.price, intlLocale) })}</span>
            {!compact && <span className="block text-foreground/60">{t.priceNote}</span>}
          </span>
        )}
      </span>
    </>
  );
  const base = cn(
    "group flex w-full rounded-[var(--site-radius)] border border-border bg-background text-start transition-colors hover:border-[var(--site-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]",
    compact ? "items-start gap-3 p-2.5" : "flex-col overflow-hidden"
  );
  if (action.kind === "link") {
    return (
      <Link href={action.href} className={base} data-testid="package-card">
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => action.onSelect(pkg)} className={base} data-testid="package-card">
      {body}
    </button>
  );
}
