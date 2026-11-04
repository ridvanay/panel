import Link from "next/link";
import { CalendarCheck, Send } from "lucide-react";
import type { Specialty } from "@/lib/api/types";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { requestFormPath } from "@/lib/intermediary";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { bookingPath } from "@/lib/service-booking-links";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { ServicesStrings } from "@/lib/i18n/site-dictionaries/types";

/** `icon-box-block.tsx` ile aynı `react-hooks/static-components` yanlış-pozitifi kaçınma deseni. */
function iconGlyph(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * Paket AI — "Health Tourism Services" sayfası hizmet kartı: ikon, ad (hizmet sayfasına bağlantı), tek satır kısa
 * açıklama (yoksa gösterilmez), alt uzmanlık çipleri ve "Book a consultation" / "Request" bağlantıları. AI İş 3: rezervasyon
 * açıkken "Book" → `/book-consultation?service=<slug>`, ikincil düğme "Request a call back" → `/request?service=<slug>`;
 * kapalıyken ikisi de `/request?service=<slug>` (önceki davranış).
 */
export function ServiceCard({
  service,
  subServices,
  strings,
  activeLocaleCode,
  defaultLocaleCode,
  bookingEnabled = false,
  callbackLabel,
  bookCtaEnabled = true,
}: {
  service: Pick<Specialty, "slug" | "name" | "icon" | "shortDescription">;
  subServices: Pick<Specialty, "slug" | "name">[];
  strings: ServicesStrings;
  activeLocaleCode: string;
  defaultLocaleCode: string;
  /** `GET /service-consultations/config` `enabled` (sunucudan). */
  bookingEnabled?: boolean;
  /** Rezervasyon açıkken ikincil düğme etiketi ("Request a call back"). */
  callbackLabel?: string;
  /** Paket AK — `bookConsultationCtaEnabled`; `false` iken "Book a consultation" düğmesi çizilmez (ikincil talep düğmesi kalır). */
  bookCtaEnabled?: boolean;
}) {
  const localize = (path: string) => withLocalePrefix(path, activeLocaleCode, defaultLocaleCode);
  const requestHref = localize(requestFormPath({ service: service.slug }));
  const bookHref = bookingEnabled ? localize(bookingPath({ service: service.slug })) : requestHref;
  const secondaryLabel = bookingEnabled && callbackLabel ? callbackLabel : strings.cardRequest;
  const secondaryAria = bookingEnabled && callbackLabel ? `${callbackLabel}: ${service.name}` : formatSiteString(strings.cardRequestAria, { service: service.name });
  const actionClass =
    "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[var(--site-radius)] px-3 py-2 text-center text-sm leading-tight font-semibold transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]/40";
  return (
    <article
      data-testid="service-card"
      className="flex h-full flex-col rounded-[var(--site-radius)] border border-border bg-surface p-5 transition-all duration-150 hover:border-primary/30 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{iconGlyph(service.icon, "size-6")}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">
            <Link href={localize(`/specialties/${service.slug}`)} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]/40">
              {service.name}
            </Link>
          </h3>
          {service.shortDescription && <p className="mt-1 text-sm text-foreground/60">{service.shortDescription}</p>}
        </div>
      </div>
      {subServices.length > 0 && (
        <div data-testid="service-card-chips" className="mt-3 flex flex-wrap gap-1.5">
          <span className="sr-only">{strings.relatedProceduresAria}</span>
          {subServices.map((child) => (
            <Link
              key={child.slug}
              href={localize(`/specialties/${child.slug}`)}
              className="inline-flex min-h-8 items-center rounded-full border border-border px-3 text-xs font-semibold text-[var(--site-primary)] hover:bg-surface-muted"
            >
              {child.name}
            </Link>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {bookCtaEnabled && (
        <Link
          href={bookHref}
          data-testid="service-card-book"
          aria-label={`${strings.bookConsultation}: ${service.name}`}
          className={`${actionClass} bg-[var(--site-button)] text-[var(--site-button-text)] hover:opacity-90`}
        >
          <CalendarCheck className="size-4" aria-hidden="true" />
          {strings.bookConsultation}
        </Link>
        )}
        <Link
          href={requestHref}
          data-testid="service-card-request"
          aria-label={secondaryAria}
          className={`${actionClass} border border-[var(--site-primary)] text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5`}
        >
          <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          {secondaryLabel}
        </Link>
      </div>
    </article>
  );
}

/** Paket AI — süreç şeridi: Request/Book → Coordinator call → Authorized facility & plan → Travel & stay → Treatment → Aftercare. */
export function ServicesProcessStrip({ strings }: { strings: ServicesStrings }) {
  const steps = [strings.processStep1, strings.processStep2, strings.processStep3, strings.processStep4, strings.processStep5, strings.processStep6];
  return (
    <section aria-labelledby="services-process-heading" data-testid="services-process" className="mt-8 rounded-2xl border border-border bg-surface-muted/50 p-5">
      <h2 id="services-process-heading" className="text-sm font-bold tracking-wide text-foreground/70 uppercase">
        {strings.processHeading}
      </h2>
      <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-2.5">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--site-primary)] text-sm font-semibold text-[var(--site-button-text,#fff)]"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="pt-0.5 text-sm leading-snug font-medium text-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
