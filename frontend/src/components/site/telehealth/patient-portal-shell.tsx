"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Spinner } from "@/components/ui/spinner";

/**
 * `.claude/design-notes-telehealth.md` §12.6 — hasta portalı, `/{lang}/patient/bookings` (oturum
 * GEREKİR, 2FA GEREKMEZ — §9.7.7 madde 3/4). §K6 — tek hedefi olduğu için sekme şeridi de
 * anlamsızdır; marka/hesap/çıkış Katman 1 (`SiteHeader`) üzerinden gelir, bu kabuk kendi
 * `<header>`'ını RENDER ETMEZ. Misafir hasta (magic-link, `?t=`) BU KABUĞU KULLANMAZ —
 * `/patient/bookings/{id}?t=` doğrudan oturumsuz erişilebilir bir sayfadır (bkz. o sayfanın kendi
 * bileşeni).
 */
export function PatientPortalShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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

  return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</div>;
}
