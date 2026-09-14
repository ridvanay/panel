"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { useDoctorPortalContext } from "@/components/site/telehealth/doctor-portal-context";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

/**
 * `.claude/design-notes-telehealth.md` §12.6 — doktor/hasta portalı, admin panelinin AYRI token
 * sistemini/dashboard kabuğunu KULLANMAZ; kamu sitesinin `.site-scope` paletiyle DEVAM eder. Sade
 * bir üst çubuk (sidebar YOK — bu kabuk kendisi bir sidebar RENDER ETMEZ) — mevcut `hesabim-shell.tsx`'in
 * TEK auth-guard desenini izler, ama doktor için EK bir katman vardır: `DoctorProfile.userId`
 * ilişkisi + `twoFactorEnabled` kapısı (§9.7.7 KARAR K). `SiteRole.DOCTOR` YOKTUR — bu SADECE
 * `GET /doctor/me`'nin başarıyla dönmesiyle doğrulanır.
 *
 * `.claude/architect-scope-doctor-subdomain.md` §5.4 invariant 1 — profil fetch/guard/hata
 * durumları artık `(doctor)/layout.tsx`'teki `DoctorPortalProvider`'da (`GET /doctor/me` sayfa
 * yüklemesi başına BİR kez). Bu kabuk artık yalnızca İÇERİK KONTEYNERİ + SEKME ŞERİDİ'dir;
 * `useDoctorPortalContext()`/`useDoctorPortalProfile()` ile context'i TÜKETİR, kendi fetch'ini
 * ATMAZ.
 *
 * §5.4 — Katman 1 (marka/hekim kimliği/bildirimler/çıkış) ARTIK YALNIZCA `DoctorTopBar`'da yaşar
 * (`(doctor)/layout.tsx`'te, bu kabuğun ÜSTÜNDE mount edilir); bu kabuk kendi `<header>`'ını RENDER
 * ETMEZ, yalnızca sekme şeridini (Randevularım/Kazançlarım/Profilim) taşır — doktor adı/unvanı
 * TEKRAR gösterilmez (tekilleştirme, çift-gösterim YASAK).
 *
 * `max-w-6xl` — frontend-agent grid görevi (2026-09-14): `/doctor` (Randevularım) artık `children`
 * İÇİNDE `lg:grid-cols-12` 2 kolonlu bir dashboard grid'i (ana alan + "Portal Akışı" sidebar'ı)
 * kullanıyor; eski `max-w-5xl` (1024px) bunun için sıkışıktı. `/doctor/earnings` ve `/doctor/profile`
 * bu genişlikten ETKİLENİR ama zarar GÖRMEZ (zaten dar içerikli, tek kolon sayfalar).
 */

interface DoctorPortalShellProps {
  children: ReactNode;
}

export function DoctorPortalShell({ children }: DoctorPortalShellProps) {
  const pathname = usePathname();
  const localize = useLocalizePath();
  const { status, error, retry } = useDoctorPortalContext();

  if (status === "loading" || status === "unauthenticated" || status === "skipped") {
    return (
      <div className="mx-auto flex max-w-6xl justify-center px-4 py-24 sm:px-6">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  if (error?.code === "NOT_A_DOCTOR") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
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
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
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

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-10 text-center">
          <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">{friendlyErrorMessage(error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="mb-6 flex flex-wrap items-center gap-4 border-b border-border pb-4 text-sm text-foreground/70">
        <Link href={bookingsHref} className={pathname === bookingsHref ? "font-medium text-primary" : "hover:text-foreground"}>
          Randevularım
        </Link>
        <Link href={earningsHref} className={pathname === earningsHref ? "font-medium text-primary" : "hover:text-foreground"}>
          Kazançlarım
        </Link>
        <Link href={profileHref} className={pathname === profileHref ? "font-medium text-primary" : "hover:text-foreground"}>
          Profilim
        </Link>
      </nav>
      {children}
    </div>
  );
}
