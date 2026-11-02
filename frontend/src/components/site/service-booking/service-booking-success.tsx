"use client";

import Link from "next/link";
import { CalendarCheck, Mail } from "lucide-react";
import { AddToCalendar, DualDateTimeSummary } from "@/components/site/telehealth/dual-time";
import { Alert } from "@/components/ui/alert";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { ServiceBookingStrings } from "@/lib/i18n/site-dictionaries/en/service-booking";
import type { ServiceConsultationCreated } from "@/lib/api/service-consultations";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Başarı ekranı: `SVC-…` numarası, iki saat diliminde zaman (hastanın dilimi + İstanbul), "Add to calendar" (eski
 * randevu sihirbazının `AddToCalendar`ı; dosya yalnızca tarayıcıda üretilir, içinde bağlantı/belirteç yoktur),
 * "Join link sent to your e-mail; the room opens 15 minutes before" ve yönetim bağlantısı notu.
 */
export function ServiceBookingSuccess({
  strings: s,
  result,
  displayTimeZone,
  intlLocale,
  serviceName,
  homeHref,
  servicesHref,
}: {
  strings: ServiceBookingStrings;
  result: ServiceConsultationCreated;
  displayTimeZone: string;
  intlLocale: string;
  serviceName: string | null;
  homeHref: string;
  servicesHref: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="service-booking-success">
      <Alert variant="success">
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold" tabIndex={-1} id="service-booking-success-title">
            <CalendarCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
            {s.successTitle}
          </h2>
          <p className="text-sm font-medium" data-testid="service-booking-number">
            {formatSiteString(s.successNumber, { number: result.consultationNumber })}
          </p>
          {serviceName && <p className="text-sm">{serviceName}</p>}
          <DualDateTimeSummary iso={result.startsAt} endIso={result.endsAt} timeZone={displayTimeZone} intlLocale={intlLocale} />
          <AddToCalendar
            events={[
              {
                uid: result.consultationNumber,
                title: s.successCalendarTitle,
                startsAt: result.startsAt,
                endsAt: result.endsAt,
                url: null,
              },
            ]}
          />
        </div>
      </Alert>

      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5 text-sm">
        <p className="flex items-start gap-2 text-foreground" data-testid="service-booking-join-note">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{s.successJoin}</span>
        </p>
        <p className="mt-2 text-foreground/70">{s.successManage}</p>
        <p className="mt-2 text-xs text-foreground/60">{s.successSpam}</p>
        <p className="mt-4 border-t border-border pt-3 text-xs text-foreground/60">{s.medicalNote}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={homeHref} className={cn(buttonVariants({ variant: "default" }), "rounded-[var(--site-radius)]")}>
          {s.successHome}
        </Link>
        <Link href={servicesHref} className={cn(buttonVariants({ variant: "outline" }), "rounded-[var(--site-radius)]")}>
          {s.successBrowse}
        </Link>
      </div>
    </div>
  );
}
