"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { callbackPath, primaryBookPath, type ServiceLinkParams } from "@/lib/service-booking-links";

interface ServiceBookingContextValue {
  enabled: boolean;
  /** İkincil "Request a call back" etiketi (aktif dilde; sunucudan gelir). */
  callbackLabel: string;
  /** "Book an online consultation" etiketi (aktif dilde; paket sayfası düğmesi). */
  bookLabel: string;
}

/**
 * AI İş 3 — `GET /service-consultations/config` `enabled` bilgisi `(site)/layout.tsx`'ten (sunucu, 60 sn) bu bağlama
 * akar; istemci düğmeleri (header CTA, mega menü, Find your treatment …) hedefini buradan seçer. Provider yoksa
 * (ör. eski testler) varsayılan KAPALIdır → mevcut `/request` davranışı değişmez.
 */
const ServiceBookingContext = createContext<ServiceBookingContextValue>({ enabled: false, callbackLabel: "Request a call back", bookLabel: "Book an online consultation" });

export function ServiceBookingProvider({ enabled, callbackLabel, bookLabel, children }: { enabled: boolean; callbackLabel: string; bookLabel: string; children: ReactNode }) {
  const value = useMemo(() => ({ enabled, callbackLabel, bookLabel }), [enabled, callbackLabel, bookLabel]);
  return <ServiceBookingContext.Provider value={value}>{children}</ServiceBookingContext.Provider>;
}

export function useServiceBookingEnabled(): boolean {
  return useContext(ServiceBookingContext).enabled;
}

export function useServiceBooking(): ServiceBookingContextValue {
  return useContext(ServiceBookingContext);
}

/** Dil önekli birincil rezervasyon bağlantısı üretici. */
export function useBookHref(): (params?: ServiceLinkParams) => string {
  const { enabled } = useContext(ServiceBookingContext);
  const localize = useLocalizePath();
  return useCallback((params?: ServiceLinkParams) => localize(primaryBookPath(enabled, params)), [enabled, localize]);
}

/** Dil önekli "Request a call back" (talep formu) bağlantısı üretici. */
export function useCallbackHref(): (params?: ServiceLinkParams) => string {
  const localize = useLocalizePath();
  return useCallback((params?: ServiceLinkParams) => localize(callbackPath(params)), [localize]);
}
