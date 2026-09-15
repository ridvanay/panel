"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { isDoctorHostname, isSubdomainModeEnabled, toDoctorOrigin } from "@/lib/doctor-host";

/**
 * §K6 (`.claude/architect-scope-telehealth-template.md`) + görev talimatı — doktor hesabı
 * (`User.doctorProfileId !== null`) oturum açtığında `(site)` route grubunda `/doctor/**` DIŞINDA
 * bir sayfaya erişemez; her navigasyonda `/doctor`'a geri yönlendirilir. TEK istisna
 * `/consultation/{id}`'dir (2026-09-15, bkz. `isDoctorSharedRouteException`). Guard SADECE bu
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

/**
 * **architect KARARI (2026-09-15, bug-fix turu — "doktor konsültasyon odasına ulaşamıyor" blocker'ı):**
 * `.claude/architect-scope-doctor-subdomain.md` §5.6'ya bakınız (karar ve gerekçe ORADA yazılıdır).
 *
 * Bu desen `proxy.ts::DOCTOR_PORTAL_ROUTE_PATTERN` İLE PAYLAŞILMAZ ve ORAYA TAŞINMAZ — iki katman
 * BİRBİRİNDEN FARKLI iki soruya cevap verir ve bu rota tam olarak ikisinin AYRIŞTIĞI ilk yerdir:
 *   - `proxy.ts` (oturumdan habersiz): "bu istek hangi HOST'ta servis edilir?" → `/consultation/**`
 *     ana host'ta servis edilir (hasta magic-link `?t=` erişimi DAHİL). Bu deseni oraya eklemek,
 *     ana host'a gelen HER hasta isteğini doktor subdomain'ine 307'lerdi — hasta orada authenticated
 *     DEĞİLDİR (login döngüsü/404), işlevsel VE güvenlik açısından YANLIŞ.
 *   - bu guard (host'tan habersiz): "doktor OTURUMU bu sayfada KALABİLİR Mİ?" → EVET, çünkü
 *     konsültasyon odası bir vitrin sayfası DEĞİL, doktorun KENDİ randevusunun çalışma yüzeyidir
 *     (hasta ve doktor tarafından PAYLAŞILAN TEK sayfa).
 *
 * **KAPSAM DAR TUTULUR (bağlayıcı):** bu listeye yeni bir rota eklemek bir MİMARİ karardır —
 * §5.6'ya tarihli bir not düşmeden genişletilmez. Kolaylık gerekçesiyle (`/products`, `/cart`,
 * `/hesabim` vb.) büyütülmesi §5.6'nın "hekim ana vitrinde kalamaz" kuralını boşaltır.
 *
 * Yetkilendirme BU guard'da DEĞİLDİR: doktorun BU randevuya erişip erişemeyeceğine API karar verir
 * (`POST /appointments/{id}/meeting-token` — doktor yalnızca KENDİ randevusu için token alır);
 * guard yalnızca bir gezinme/UX izolasyon katmanıdır.
 */
function isDoctorSharedRouteException(pathname: string | null): boolean {
  if (!pathname) return false;
  // YALNIZCA `/consultation/{id}` (`app/[lang]/(site)/consultation/[id]/page.tsx`) — `{id}`
  // segmenti ZORUNLUDUR, çıplak `/consultation` bir sayfa DEĞİLDİR.
  return /^\/(?:[a-z]{2}\/)?consultation\/[^/]+/.test(pathname);
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
    // 2026-09-15 istisnası — bkz. `isDoctorSharedRouteException` başlığı + §5.6.
    if (isDoctorSharedRouteException(pathname)) return;
    if (isSubdomainModeEnabled() && !isDoctorHostname(window.location.hostname)) {
      window.location.assign(toDoctorOrigin("/doctor"));
      return;
    }
    router.replace(localize("/doctor"));
  }, [isDoctorSession, pathname, router, localize]);

  return null;
}
