import Link from "next/link";
import { DOCTORS_VISIBLE_TO_VISITORS } from "@/lib/intermediary";
import { Check, Clock, X } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import type { PackagesStrings } from "@/lib/i18n/site-dictionaries/en/packages";
import type { PackageDetailData } from "@/lib/api/types";
import { fill, formatPackagePrice } from "./package-format";

function initials(name: string): string {
  const parts = name.replace(/^(?:prof|doç|dr|assoc|assist)\.?\s+/gi, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return `${parts[0]![0]}${parts.length > 1 ? parts[parts.length - 1]![0] : ""}`.toUpperCase();
}

/**
 * Paket X — paket ayrıntısının ortak gövdesi (süre, fiyat, uygun olanlar, dahil/dahil değil, ilgili hekimler).
 * Hem tam sayfada (sunucu) hem ayrıntı sheet'inde (istemci) kullanılır; kancasız saf bileşen. Fiyat YALNIZCA API `price`
 * doluysa çizilir ve her zaman "kesin fiyat tıbbi değerlendirmeden sonra" notuyla; sepet/ödeme bağlantısı YOKTUR.
 */
export function PackageDetailBody({
  pkg,
  t,
  intlLocale,
  localize,
  showFaq = false,
}: {
  pkg: PackageDetailData;
  t: PackagesStrings;
  intlLocale: string;
  localize: (path: string) => string;
  showFaq?: boolean;
}) {
  return (
    <div className="space-y-6" data-testid="package-detail-body">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {pkg.duration && (
          <p className="inline-flex items-center gap-2 text-foreground/80" data-testid="package-duration">
            <Clock className="h-4 w-4 text-[var(--site-primary)]" aria-hidden="true" />
            <span>
              <span className="font-semibold text-foreground">{t.durationLabel}:</span> {pkg.duration}
            </span>
          </p>
        )}
      </div>

      {pkg.price && (
        <div className="rounded-[var(--site-radius)] border border-border bg-surface p-4" data-testid="package-price">
          <p className="font-heading text-lg font-semibold text-foreground">{fill(t.priceFrom, { price: formatPackagePrice(pkg.price, intlLocale) })}</p>
          <p className="mt-1 text-xs text-foreground/70" data-testid="package-price-note">
            {t.priceNote}
          </p>
        </div>
      )}

      {pkg.idealFor && (
        <section aria-labelledby="package-ideal-title">
          <h3 id="package-ideal-title" className="mb-1 text-sm font-semibold text-foreground">
            {t.idealForTitle}
          </h3>
          <p className="text-sm text-foreground/80">{pkg.idealFor}</p>
        </section>
      )}

      {pkg.includes.length > 0 && (
        <section aria-labelledby="package-includes-title">
          <h3 id="package-includes-title" className="mb-2 text-sm font-semibold text-foreground">
            {t.includesTitle}
          </h3>
          <ul className="space-y-1.5 text-sm text-foreground/80" data-testid="package-includes">
            {pkg.includes.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pkg.notIncluded.length > 0 && (
        <section aria-labelledby="package-not-included-title">
          <h3 id="package-not-included-title" className="mb-2 text-sm font-semibold text-foreground">
            {t.notIncludedTitle}
          </h3>
          <ul className="space-y-1.5 text-sm text-foreground/80" data-testid="package-not-included">
            {pkg.notIncluded.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-start gap-2">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Paket AH — hekim listesi ziyaretçi tarafında gösterilmez. */}
      {DOCTORS_VISIBLE_TO_VISITORS && pkg.relatedDoctors.length > 0 && (
        <section aria-labelledby="package-doctors-title">
          <h3 id="package-doctors-title" className="mb-2 text-sm font-semibold text-foreground">
            {t.relatedDoctorsTitle}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="package-related-doctors">
            {pkg.relatedDoctors.map((doctor) => (
              <li key={doctor.slug}>
                <Link
                  href={localize(`/physicians/${doctor.slug}`)}
                  aria-label={fill(t.viewPhysicianAria, { name: doctor.name })}
                  className="flex min-h-14 items-center gap-3 rounded-[var(--site-radius)] border border-border bg-background p-2.5 transition-colors hover:border-[var(--site-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--site-primary)]/10 text-xs font-semibold text-[var(--site-primary)]">
                    {doctor.avatarUrl ? <SafeImage src={doctor.avatarUrl} alt="" fill sizes="40px" className="object-cover" /> : initials(doctor.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{doctor.name}</span>
                    {doctor.specialty && <span className="block truncate text-xs text-foreground/70">{doctor.specialty}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showFaq && pkg.faq.length > 0 && (
        <section aria-labelledby="package-faq-title">
          <h2 id="package-faq-title" className="mb-3 font-heading text-xl font-semibold text-foreground">
            {t.faqTitle}
          </h2>
          <dl className="space-y-4">
            {pkg.faq.map((entry, index) => (
              <div key={`${index}-${entry.question}`}>
                <dt className="text-sm font-semibold text-foreground">{entry.question}</dt>
                <dd className="mt-1 text-sm text-foreground/80">{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
