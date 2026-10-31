"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarCheck, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Mobil alt çubuk / diğer tetikleyiciler için: randevu alanını açar. */
export const OPEN_BOOKING_EVENT = "doctor-profile:open-booking";

export function openBookingPanel(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_BOOKING_EVENT));
}

function shouldAutoOpen(doctorSlug: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.hash === "#randevu") return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get("booking") && params.get("t")) return true;
  try {
    return sessionStorage.getItem(`wm-telehealth-pending-booking:${doctorSlug}`) !== null;
  } catch {
    return false;
  }
}

/**
 * Paket AE — randevu alanı kapsayıcısı. Sihirbaz (BookingWizard) DOM'da ve bağlı kalır (durum kaybolmaz), yalnızca
 * görünürlüğü değişir: varsayılan kapalı; "Randevu Oluştur" düğmesi, `#randevu` bağlantıları (hızlı randevu kartı,
 * eşleştirici), mobil alt çubuk, `?booking=&t=` dönüşü ve bekleyen rezervasyon varsa AÇILIR.
 * Sihirbaz kodu ve randevu kurallarına dokunulmaz.
 */
export function DoctorBookingPanel({
  doctorSlug,
  title,
  openLabel,
  hideLabel,
  hint,
  headerExtra,
  children,
}: {
  doctorSlug: string;
  title: string;
  openLabel: string;
  hideLabel: string;
  hint: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const autoOpen = () => {
      if (shouldAutoOpen(doctorSlug)) setOpen(true);
    };
    autoOpen();
    const onHash = () => {
      if (window.location.hash === "#randevu") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href="#randevu"]');
      if (anchor) setOpen(true);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener(OPEN_BOOKING_EVENT, show);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener(OPEN_BOOKING_EVENT, show);
      document.removeEventListener("click", onClick, true);
    };
  }, [doctorSlug, show]);

  return (
    <section id="randevu" data-testid="doctor-booking-panel" className="mt-8 scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {headerExtra}
      </div>
      {!open && <p className="mt-2 text-sm text-foreground/70">{hint}</p>}
      <div className="mt-3">
        <Button
          type="button"
          size="lg"
          aria-expanded={open}
          aria-controls="randevu-icerik"
          variant={open ? "outline" : "default"}
          onClick={() => setOpen((v) => !v)}
          className="gap-2"
        >
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <CalendarCheck className="h-4 w-4" aria-hidden="true" />}
          {open ? hideLabel : openLabel}
        </Button>
      </div>
      <div id="randevu-icerik" hidden={!open} className="mt-4">
        {children}
      </div>
    </section>
  );
}
