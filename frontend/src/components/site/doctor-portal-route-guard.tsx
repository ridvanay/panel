"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";

/**
 * §K6 (`.claude/architect-scope-telehealth-template.md`) + görev talimatı — doktor hesabı
 * (`User.doctorProfileId !== null`) oturum açtığında `(site)` route grubunda `/doctor/**` DIŞINDA
 * bir sayfaya erişemez; her navigasyonda `/doctor`'a geri yönlendirilir. Guard SADECE bu
 * `"use client"` bileşende yaşar — `proxy.ts` erişim tokenına (bellek-içi) sahip DEĞİLDİR,
 * bkz. `frontend/src/proxy.ts` (bakım modu + locale rewrite/redirect dışında sorumluluğu YOK).
 *
 * `/doctors/[slug]` (kamuya açık doktor profili LİSTESİ/DETAYI, ÇOĞUL) `/doctor` (doktor
 * portalı, TEKİL) İLE KARIŞTIRILMAZ — aşağıdaki örüntü `site-header.tsx::isDoctorDetailRoute`
 * İLE AYNI genel `[a-z]{2}` locale prefix segmentini (`Locale.code` ile SINIRLI DEĞİL) kullanır.
 */
function isDoctorPortalRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/(?:[a-z]{2}\/)?doctor(?:\/|$)/.test(pathname);
}

export function DoctorPortalRouteGuard() {
  const auth = useAuthOptional();
  const pathname = usePathname();
  const router = useRouter();
  const localize = useLocalizePath();

  // `.claude/architect-scope-telehealth-template.md` K6 — `SiteRole.DOCTOR` YOKTUR; doktorluk
  // `User.doctorProfileId` ilişkisinden TÜRETİLİR (`site-header.tsx`'teki AYNI desen).
  const isDoctorSession = auth?.status === "authenticated" && auth.user?.doctorProfileId != null;

  useEffect(() => {
    // `status` `authenticated` DIŞINDAYKEN (ör. `logout()` sonrası `unauthenticated`'a düşünce)
    // guard ARTIK müdahale ETMEZ — `isDoctorSession` `false` olur, effect erken çıkar.
    if (!isDoctorSession) return;
    if (isDoctorPortalRoute(pathname)) return;
    router.replace(localize("/doctor"));
  }, [isDoctorSession, pathname, router, localize]);

  return null;
}
