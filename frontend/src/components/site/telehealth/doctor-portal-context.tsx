"use client";

import { createContext, useContext } from "react";
import type { ApiClientError } from "@/lib/api/error";
import type { DoctorPortalProfile } from "@/lib/api/types";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.4 invariant 2 — Context KENDİ modülündedir
 * (`doctor-portal-shell.tsx`'ten AYRILDI); `doctor-portal-provider.tsx` (yazar) ve
 * `doctor-portal-shell.tsx`/`doctor-top-bar.tsx`/`doctor-portal-feed-card.tsx` (okuyucular)
 * bu modülü ORTAK import eder — döngüsel import (`shell` → `feed-card` → `shell`) OLUŞMAZ.
 *
 * `skipped`: `/doctor/login` rotasında provider `GET /doctor/me`'yi HİÇ ÇAĞIRMAZ (invariant 3 —
 * aksi hâlde giriş sayfası kendi kendini `/login`'e yönlendirip döngü üretir). Bu durumda
 * `DoctorTopBar` yalnızca kurum logosunu gösterir (hekim adı/bildirim/çıkış YOK).
 */
export type DoctorPortalStatus = "loading" | "unauthenticated" | "error" | "ready" | "skipped";

export interface DoctorPortalContextValue {
  status: DoctorPortalStatus;
  profile: DoctorPortalProfile | null;
  error: ApiClientError | null;
  /** Profil fetch'ini tekrar dener (`NOT_A_DOCTOR`/ağ hatası ekranlarındaki "Tekrar Dene" butonu). */
  retry: () => void;
}

export const DoctorPortalContext = createContext<DoctorPortalContextValue | null>(null);

/** Ham context değeri — `status`'a göre kendi UI'ını (spinner/hata/skipped) çizen bileşenler için. */
export function useDoctorPortalContext(): DoctorPortalContextValue {
  const ctx = useContext(DoctorPortalContext);
  if (!ctx) {
    throw new Error("useDoctorPortalContext() yalnızca <DoctorPortalProvider> içinde kullanılabilir.");
  }
  return ctx;
}

/**
 * Yalnızca `status === "ready"` olduğu (yani `DoctorPortalShell`'in kendisinin doğruladığı)
 * bağlamlarda kullanılır — `doctor-portal-feed-card.tsx` ve panel bileşenlerinin AYNI eski
 * sözleşimi (profil HER ZAMAN doludur, `null` kontrolü GEREKMEZ).
 */
export function useDoctorPortalProfile(): DoctorPortalProfile {
  const { profile } = useDoctorPortalContext();
  if (!profile) {
    throw new Error("useDoctorPortalProfile() yalnızca profil yüklendikten sonra (<DoctorPortalShell> içinde) kullanılabilir.");
  }
  return profile;
}
