"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactCta } from "@/components/site/contact/contact-cta";
import { useActiveLocaleCode, useLocalizePath } from "@/context/locale-alternates-context";
import { getPackage } from "@/lib/api/packages";
import type { PackageCardData, PackageDetailData } from "@/lib/api/types";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { usePackagesStrings } from "@/lib/i18n/use-packages-strings";
import { useServiceBooking } from "@/components/site/service-booking/service-booking-context";
import { bookingPath } from "@/lib/service-booking-links";
import { PackageDetailBody } from "./package-detail-body";
import { PackageInquiryForm, focusPackageInquiryForm } from "./package-inquiry-form";
import { PackageViewBeacon } from "./package-view-beacon";

type DetailState = { status: "loading" } | { status: "error" } | { status: "ready"; pkg: PackageDetailData };

/**
 * Paket X — kart tıklaması sonrası ayrıntı sheet'i (Base UI Dialog: odak tuzağı, ESC, aria). Üç durum: yükleniyor
 * (iskelet), hata (yeniden dene) ve dolu. "Find my physician" tıklanınca sheet kapanır, eşleştirme modalı açılır.
 */
export function PackageDetailSheet({ card, onClose }: { card: PackageCardData | null; onClose: () => void }) {
  const t = usePackagesStrings();
  const localize = useLocalizePath();
  const [attempt, setAttempt] = useState(0);

  return (
    <Sheet open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 data-[side=right]:sm:max-w-xl" data-testid="package-detail-sheet" data-crm-ignore="">
        <div className="space-y-6 p-4 pt-12 sm:p-6 sm:pt-12">
          <div>
            <SheetTitle className="font-heading text-xl font-semibold">{card?.title ?? ""}</SheetTitle>
            <SheetDescription className="mt-1">{card?.summary}</SheetDescription>
            {card && (
              <Link href={localize(`/packages/${card.slug}`)} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-[var(--site-link,var(--site-primary))] underline">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t.viewDetails}
              </Link>
            )}
          </div>
          {card && <PackageViewBeacon key={card.slug} kind="package" slug={card.slug} />}
          {card && <DetailLoader key={`${card.slug}:${attempt}`} card={card} onClose={onClose} onRetry={() => setAttempt((n) => n + 1)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Her paket/yeniden deneme için yeniden kurulur (`key`): durum "yükleniyor"la başlar, efektte eşzamanlı setState yok. */
function DetailLoader({ card, onClose, onRetry }: { card: PackageCardData; onClose: () => void; onRetry: () => void }) {
  const t = usePackagesStrings();
  const lang = useActiveLocaleCode();
  const localize = useLocalizePath();
  const { enabled: bookingEnabled, bookLabel } = useServiceBooking();
  const intlLocale = contentLocaleToIntl(lang);
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const slug = card.slug;

  useEffect(() => {
    let cancelled = false;
    getPackage(slug, lang)
      .then((pkg) => !cancelled && setState({ status: "ready", pkg }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [slug, lang]);

  const onCallback = useCallback(() => focusPackageInquiryForm(), []);

  if (state.status === "loading") {
    return (
      <div role="status" aria-label={t.detailLoading} className="space-y-3" data-testid="package-detail-loading">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger" data-testid="package-detail-error">
        <p>{t.detailError}</p>
        <button type="button" onClick={onRetry} className="mt-2 min-h-11 rounded-[var(--site-radius)] border border-danger/40 px-4 font-semibold">
          {t.retry}
        </button>
      </div>
    );
  }
  return (
    <>
      <PackageDetailBody pkg={state.pkg} t={t} intlLocale={intlLocale} localize={localize} />
      <div onClickCapture={onClose} className="space-y-3">
        {bookingEnabled && (
          <Link
            href={localize(bookingPath({ pkg: card.slug }))}
            data-testid="package-book-cta"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
          >
            {bookLabel}
          </Link>
        )}
        <Link
          href={`${localize("/request")}?package=${encodeURIComponent(card.slug)}`}
          data-testid="package-request-cta"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
        >
          {t.requestPackage}
        </Link>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">{t.contactTitle}</p>
        <ContactCta topic={card.title} onCallback={onCallback} />
      </div>
      <PackageInquiryForm slug={card.slug} />
    </>
  );
}
