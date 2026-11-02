"use client";

import Link from "next/link";
import { ContactCta } from "@/components/site/contact/contact-cta";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { usePackagesStrings } from "@/lib/i18n/use-packages-strings";
import { useServiceBooking } from "@/components/site/service-booking/service-booking-context";
import { bookingPath } from "@/lib/service-booking-links";
import { PackageInquiryForm, focusPackageInquiryForm } from "./package-inquiry-form";

/** Paket X / AH — tam sayfadaki istemci eylemleri: "Request this package" (talep formu), `ContactCta` (topic = paket adı) ve planlama formu. */
export function PackageDetailActions({ slug, title }: { slug: string; title: string }) {
  const t = usePackagesStrings();
  const localize = useLocalizePath();
  const { enabled: bookingEnabled, bookLabel } = useServiceBooking();
  return (
    <div className="space-y-6">
      {bookingEnabled && (
        <Link
          href={localize(bookingPath({ pkg: slug }))}
          data-testid="package-book-cta"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
        >
          {bookLabel}
        </Link>
      )}
      <Link
        href={`${localize("/request")}?package=${encodeURIComponent(slug)}`}
        data-testid="package-request-cta"
        className={
          bookingEnabled
            ? "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-primary)] px-5 text-sm font-semibold text-[var(--site-primary)] transition-all duration-300 hover:bg-[var(--site-primary)]/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
            : "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
        }
      >
        {t.requestPackage}
      </Link>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">{t.contactTitle}</p>
        <ContactCta topic={title} onCallback={focusPackageInquiryForm} />
      </div>
      <PackageInquiryForm slug={slug} />
    </div>
  );
}
