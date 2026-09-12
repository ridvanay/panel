"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { DoctorPortalProfile } from "@/lib/api/types";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

/**
 * `.claude/design-notes-telehealth.md` §12.6 — doktor/hasta portalı, admin panelinin AYRI token
 * sistemini/dashboard kabuğunu KULLANMAZ; kamu sitesinin `.site-scope` paletiyle DEVAM eder. Sade
 * bir üst çubuk (`max-w-5xl`, sidebar YOK) — mevcut `hesabim-shell.tsx`'in TEK auth-guard desenini
 * izler, ama doktor için EK bir katman vardır: `DoctorProfile.userId` ilişkisi + `twoFactorEnabled`
 * kapısı (§9.7.7 KARAR K). `SiteRole.DOCTOR` YOKTUR — bu SADECE `GET /doctor/me`'nin başarıyla
 * dönmesiyle doğrulanır.
 *
 * NOT: `children` fonksiyon/render-prop DEĞİLDİR — `page.tsx` bir Server Component olduğundan bu
 * `"use client"` bileşenine yalnızca serileştirilebilir veri/React elemanları geçebilir (fonksiyon
 * RSC sınırını geçemez, runtime'da 500 verir). Bu yüzden çekilen `profile` bir Context ile expose
 * edilir; alt paneller `useDoctorPortalProfile()` hook'u ile okur (`PatientPortalShell`/
 * `HesabimShell` İLE AYNI plain-`ReactNode`-children deseni).
 */
const DoctorPortalProfileContext = createContext<DoctorPortalProfile | null>(null);

/** Yalnızca `DoctorPortalShell` içindeki (yani `status === "authenticated"` ve profil doğrulanmış) alt bileşenlerde kullanılır. */
export function useDoctorPortalProfile(): DoctorPortalProfile {
  const profile = useContext(DoctorPortalProfileContext);
  if (!profile) {
    throw new Error("useDoctorPortalProfile() yalnızca <DoctorPortalShell> içinde kullanılabilir.");
  }
  return profile;
}

interface DoctorPortalShellProps {
  children: ReactNode;
}

export function DoctorPortalShell({ children }: DoctorPortalShellProps) {
  const { status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const localize = useLocalizePath();

  const [profile, setProfile] = useState<DoctorPortalProfile | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await telehealthApi.getDoctorPortalProfile();
        if (!cancelled) {
          setProfile(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiClientError ? err : new ApiClientError(500, { code: "INTERNAL_ERROR", message: friendlyErrorMessage(err) }));
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status !== "authenticated" || loadingProfile) {
    return (
      <div className="mx-auto flex max-w-5xl justify-center px-4 py-24 sm:px-6">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  if (error?.code === "NOT_A_DOCTOR") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-10 text-center">
          <AlertTriangle className="h-8 w-8 text-foreground/40" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Bu hesaba bağlı bir doktor profili bulunamadı.</p>
          <p className="max-w-sm text-xs text-foreground/50">
            Doktor portalına yalnızca sisteme kayıtlı bir doktor profiliyle ilişkilendirilmiş hesaplar erişebilir.
          </p>
        </div>
      </div>
    );
  }

  if (error?.code === "TWO_FACTOR_REQUIRED") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-warning" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Bu işlem için iki adımlı doğrulamanın (2FA) etkin olması gerekir.</p>
          <p className="max-w-sm text-xs text-foreground/60">
            Doktor portalına erişebilmek için önce hesap güvenlik ayarlarınızdan iki adımlı doğrulamayı etkinleştirin.
          </p>
          <Link href={localize("/hesabim/profil")} className="mt-2">
            <Button type="button" size="sm" className="rounded-[var(--site-radius)]">
              Güvenlik Ayarlarına Git
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-10 text-center">
          <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{error ? friendlyErrorMessage(error) : "Profil yüklenemedi."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
            Tekrar Dene
          </Button>
        </div>
      </div>
    );
  }

  const bookingsHref = localize("/doctor");
  const earningsHref = localize("/doctor/earnings");
  const profileHref = localize("/doctor/profile");

  return (
    <DoctorPortalProfileContext.Provider value={profile}>
      <div>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
            <span className="text-sm font-semibold text-foreground">{profile.doctorProfile.title} {profile.doctorProfile.fullName}</span>
            <nav className="flex items-center gap-4 text-sm text-foreground/70">
              <Link href={bookingsHref} className={pathname === bookingsHref ? "font-medium text-primary" : "hover:text-foreground"}>
                Randevularım
              </Link>
              <Link href={earningsHref} className={pathname === earningsHref ? "font-medium text-primary" : "hover:text-foreground"}>
                Kazançlarım
              </Link>
              <Link href={profileHref} className={pathname === profileHref ? "font-medium text-primary" : "hover:text-foreground"}>
                Profilim
              </Link>
              <button type="button" onClick={() => void logout()} className="text-foreground/50 hover:text-danger">
                Çıkış Yap
              </button>
            </nav>
          </div>
        </header>
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</div>
      </div>
    </DoctorPortalProfileContext.Provider>
  );
}
