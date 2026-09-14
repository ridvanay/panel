"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { DoctorPortalProfile } from "@/lib/api/types";
import { DoctorPortalContext, type DoctorPortalContextValue, type DoctorPortalStatus } from "@/components/site/telehealth/doctor-portal-context";

/**
 * `/doctor/login` (opsiyonel `[a-z]{2}` locale prefix'i — `doctor-portal-route-guard.tsx`'teki
 * AYNI genel örüntü). `DoctorPortalRouteGuard`'ın `isDoctorPortalRoute`'undan FARKLIDIR: bu SADECE
 * giriş sayfasını eşler (invariant 3 — provider bu rotada guard/fetch YAPMAZ).
 */
function isDoctorLoginRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/(?:[a-z]{2}\/)?doctor\/login(?:\/|$)/.test(pathname);
}

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.4 invariant 1 — `GET /doctor/me` profil
 * fetch/guard/hata durumları eskiden `doctor-portal-shell.tsx`'in İÇİNDEYDİ; `DoctorTopBar`
 * layout'ta shell'in ÜSTÜNDE olduğu için bu context'e erişemiyordu. Artık `(doctor)/layout.tsx`
 * seviyesinde TEK bir kez çalışır (sayfa yüklemesi başına `GET /doctor/me` bir kez, invariant 1);
 * `DoctorPortalShell` ve `DoctorTopBar` AYNI context'i (`useDoctorPortalContext()`) tüketir.
 */
export function DoctorPortalProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isLoginRoute = isDoctorLoginRoute(pathname);

  const [profile, setProfile] = useState<DoctorPortalProfile | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    // invariant 3 — giriş rotası guard'lanmaz (aksi hâlde kendi kendini `/login`'e yönlendirip döngü üretir).
    if (isLoginRoute) return;
    if (authStatus === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname ?? "/doctor")}`);
    }
  }, [isLoginRoute, authStatus, router, pathname]);

  useEffect(() => {
    if (isLoginRoute) return;
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await telehealthApi.getDoctorPortalProfile();
        if (!cancelled) {
          setProfile(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setProfile(null);
          setError(
            err instanceof ApiClientError ? err : new ApiClientError(500, { code: "INTERNAL_ERROR", message: friendlyErrorMessage(err) })
          );
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `retryToken`: "Tekrar Dene" butonu (bkz. doctor-portal-shell.tsx) fetch'i yeniden tetikler.
  }, [isLoginRoute, authStatus, retryToken]);

  /**
   * `setLoadingProfile(true)` BİLEREK effect GÖVDESİNDE DEĞİL, burada (bir event handler'da)
   * çağrılır — `react-hooks/set-state-in-effect` kuralı bir effect'in senkron gövdesinde
   * `setState` çağrılmasını "cascading render" riski olarak işaretler. İlk yüklemede
   * `loadingProfile`'ın başlangıç değeri zaten `true`'dur (yukarıdaki `useState(true)`).
   */
  const retry = useCallback(() => {
    setLoadingProfile(true);
    setError(null);
    setRetryToken((t) => t + 1);
  }, []);

  let status: DoctorPortalStatus;
  if (isLoginRoute) status = "skipped";
  else if (authStatus === "unauthenticated") status = "unauthenticated";
  else if (authStatus === "loading" || loadingProfile) status = "loading";
  else if (error) status = "error";
  else if (profile) status = "ready";
  else status = "loading";

  const value: DoctorPortalContextValue = { status, profile, error, retry };

  return <DoctorPortalContext value={value}>{children}</DoctorPortalContext>;
}
