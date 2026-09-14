"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { isDoctorHostname, isSubdomainModeEnabled, toDoctorOrigin } from "@/lib/doctor-host";

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
 *
 * `.claude/architect-scope-doctor-subdomain.md` §5.6 — bu guard `(site)/layout.tsx`'te KALIR
 * (`(doctor)` grubuna eklenmez, orada ters yönde bir döngü üretir). Subdomain modu AÇIKKEN
 * (`isSubdomainModeEnabled()`) ve şu an ana host'taysak (`(site)` sayfaları YALNIZCA ana host'ta
 * render edilir, ama bu bileşenin kendisi `window.location.hostname`'e bakarak KORUR), `router.replace`
 * YERİNE `window.location.assign` ile TAM SAYFA gezinme yapılır — `router.replace` bir RSC
 * navigasyonu başlatır ve proxy'nin döndüğü cross-origin 307'yi Next istemci router'ının izlemesi
 * GARANTİ DEĞİLDİR (bellek-içi access token da origin değiştiğinde zaten kaybolur, yeni origin'de
 * oturum yalnızca refresh cookie ile kurulur — bkz. karar dokümanı §6).
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
    if (isSubdomainModeEnabled() && !isDoctorHostname(window.location.hostname)) {
      window.location.assign(toDoctorOrigin("/doctor"));
      return;
    }
    router.replace(localize("/doctor"));
  }, [isDoctorSession, pathname, router, localize]);

  return null;
}
