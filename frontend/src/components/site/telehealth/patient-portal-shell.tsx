"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { Spinner } from "@/components/ui/spinner";

/**
 * `.claude/design-notes-telehealth.md` §12.6 — hasta portalı, `/{lang}/patient/bookings` (oturum
 * GEREKİR, 2FA GEREKMEZ — §9.7.7 madde 3/4). Sade üst çubuk, `hesabim-shell.tsx`/`doctor-portal-
 * shell.tsx` İLE AYNI auth-guard deseni. Misafir hasta (magic-link, `?t=`) BU KABUĞU KULLANMAZ —
 * `/patient/bookings/{id}?t=` doğrudan oturumsuz erişilebilir bir sayfadır (bkz. o sayfanın kendi
 * bileşeni).
 */
export function PatientPortalShell({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const localize = useLocalizePath();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  if (status !== "authenticated") {
    return (
      <div className="mx-auto flex max-w-5xl justify-center px-4 py-24 sm:px-6">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  const bookingsHref = localize("/patient/bookings");

  return (
    <div>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href={bookingsHref} className="text-sm font-semibold text-foreground">
            Randevularım
          </Link>
          <nav className="flex items-center gap-4 text-sm text-foreground/70">
            <button type="button" onClick={() => void logout()} className="text-foreground/50 hover:text-danger">
              Çıkış Yap
            </button>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</div>
    </div>
  );
}
