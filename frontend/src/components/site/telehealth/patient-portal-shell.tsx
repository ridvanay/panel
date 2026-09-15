"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Spinner } from "@/components/ui/spinner";
import { PatientPortalNav } from "@/components/site/telehealth/patient-portal-nav";

/**
 * `.claude/design-notes-telehealth.md` §12.6 — hasta portalı, `/{lang}/patient/**` (oturum
 * GEREKİR, 2FA GEREKMEZ — §9.7.7 madde 3/4). ESKİ CÜMLE (2026-09-12, KORUNUR — repo convention,
 * `doctor-portal-route-guard.tsx`'teki 2026-09-15 istisna notuyla AYNI biçim): "tek hedefi olduğu
 * için sekme şeridi de anlamsızdır; marka/hesap/çıkış Katman 1 (`SiteHeader`) üzerinden gelir, bu
 * kabuk kendi `<header>`'ını RENDER ETMEZ. Misafir hasta (magic-link, `?t=`) BU KABUĞU
 * KULLANMAZ — `/patient/bookings/{id}?t=` doğrudan oturumsuz erişilebilir bir sayfadır."
 *
 * **REVİZE EDİLDİ (2026-09-15, [KHP] §9.8.2 KARAR M):** kurumsal hasta portalı artık 5 hedefli
 * bir yüzeydir (`/patient`, `/patient/appointments`, `/patient/documents`, `/patient/prescriptions`,
 * `/patient/profile`) — yukarıdaki "sekme şeridi anlamsızdır" öncülü ORTADAN KALKTI, kalıcı bir
 * portal-içi gezinme artık ZORUNLUDUR (`PatientPortalNav` — `lg:` sol ray / `<lg` yatay şerit,
 * `.claude/design-notes-telehealth.md` §14.1). §12.6'nın hâlâ geçerli olan çekirdeği AYNEN
 * KORUNUR: bu kabuk `.site-scope` paletinde kalır, admin token seti/kabuğu İTHAL EDİLMEZ ve
 * **kendi `<header>`'ını RENDER ETMEZ** (marka/hesap/çıkış hâlâ Katman 1'de, `SiteHeader`).
 * Konteyner genişliği `max-w-5xl` → `max-w-6xl` (§14.1 madde 1 — `DoctorPortalShell` ile eşleşti).
 *
 * **DOKUNULMADI (bağlayıcı, [KHP] §9.8.1 madde 3):** bu kabuk kendi doktor/admin kontrolünü
 * YAPMAZ — doktor oturumu `DoctorPortalRouteGuard` (`(site)/layout.tsx`, ayrı ve MEVCUT bir guard)
 * tarafından sessizce `/doctor`'a yönlendirilir; burada AYRICA bir kontrol eklemek iki guard'ın
 * aynı anda `router.replace` çağırmasına ve yönlendirme yarışına yol açardı. ADMIN/MANAGER/EDITOR
 * BİLİNÇLİ OLARAK yönlendirilmez (§9.8.1 madde 3/madde 3.c).
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
      <div className="mx-auto flex max-w-6xl justify-center px-4 py-24 sm:px-6">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PatientPortalNav variant="strip" className="mb-6 lg:hidden" />
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:items-start lg:gap-8">
        <PatientPortalNav variant="rail" className="hidden lg:sticky lg:top-6 lg:flex" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
