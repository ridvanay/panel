import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SERVER_API_BASE_URL } from "@/lib/env";
import { DOCTOR_HOST, DOCTOR_ORIGIN, SITE_HOST, SITE_ORIGIN, isDoctorHostname } from "@/lib/doctor-host";
import { isSafeInternalPath } from "@/lib/safe-redirect";
import type { PublicSiteAppearance, Locale } from "@/lib/api/types";

/**
 * §10.12.5 Bakım Modu — SUNUM anahtarıdır, bir GÜVENLİK kontrolü DEĞİLDİR: API'yi kapatmaz,
 * hiçbir veriyi korumaz. Yalnızca ziyaretçi (`(site)`) sayfalarını etkiler — hekim portalını
 * (`(doctor)`) KAPSAMAZ (§3.3, aşağıda).
 *
 * **Neden `(site)/layout.tsx` DEĞİL, proxy (Next.js 16 — bkz. frontend/AGENTS.md, `middleware.ts`
 * ARTIK `proxy.ts` olarak yeniden adlandırıldı, node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md):** App Router'da bir Server Component'ten (layout/page) rastgele
 * bir HTTP durum kodu (503) döndürmenin bir yolu YOKTUR — yalnızca `notFound()` (404),
 * `redirect()`/`permanentRedirect()`, `forbidden()` (403) ve `unauthorized()` (401) gibi sabit kod
 * üreten yardımcılar mevcuttur (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/`). ARCHITECTURE.md §10.12.5 arama motorları için gerçek bir **503 + Retry-After**
 * ister (200 dönmek bakım sayfasının indekslenmesine yol açar) — bunu üretebilen tek Next.js
 * katmanı proxy'dir. Bu, ARCHITECTURE.md'nin "ileride bypass token gerekirse doğru yer
 * middleware.ts'tir" notuyla da TUTARLIDIR (oturum çerezi istek başına proxy'de okunabilir; not
 * mimari dokümanda eski isimle yazılmış olsa da kastedilen dosya BUDUR).
 *
 * **`.claude/architect-scope-doctor-subdomain.md` §6 — ESKİ `localhost` HOST'UNDAN MİGRASYON:**
 * yerel geliştirme ana site host'u `localhost` → `siteadi.localhost`'a taşındığında (SameSite=Strict
 * refresh cookie'sinin doktor subdomain'iyle AYNI kayıt edilebilir alan adında olması için, §6),
 * backend CORS allow-list'i artık YALNIZCA yeni host'u tanır — `Host: localhost`/`127.0.0.1` isteği
 * backend'e CORS hatasıyla (sessizce kopan `SameSite=Strict` oturum riskiyle) değil, EN BAŞTA (bakım
 * modu/locale fetch'inden ve §3.1 [1]'den bile ÖNCE, gereksiz API çağrısı yapmadan) doğru host'a 307
 * ile yönlendirilerek çözülür — bkz. `proxy()` içindeki `[-1]` adımı.
 *
 * **`.claude/architect-scope-doctor-subdomain.md` §3.1 — TEK proxy dosyası, ÜÇ sorumluluk:**
 * Next 16 tek bir proxy dosyasına izin verir (§2.1); `.claude/architect-scope-i18n.md` §4.3'ün
 * "TEK proxy dosyası, İKİ sorumluluk" notu (bakım modu + locale rewrite/redirect) artık ÜÇÜNCÜ bir
 * sorumlulukla genişledi: **hekim portalının (`/doctor/**`) host bazlı izolasyonu**
 * (`doktor.<domain>` ↔ ana domain). Bu üç sorumluluğun ÇALIŞMA SIRASI BAĞLAYICIDIR:
 *
 *   [0] Host tespiti (`request.headers.get("host")` — App Router'da `nextUrl` host/hostname
 *       ALANI SUNMAZ, bkz. doküman §2.3) → `isDoctorHost`.
 *   [1] SaaS auth yüzeyi erken çıkışı — `/login`/`/register`/`/forgot-password`/`/reset-password`/
 *       `/verify-email` (§8.1, `.claude/architect-scope-guest-account-otp.md`) ana host'ta HER
 *       ŞEYDEN ÖNCE `next()` ile geçer (bugünkü davranışın birebir korunması — bakım modu fetch'i
 *       de locale fetch'i de bu yolları GÖRMEZ).
 *   [2] Locale listesi HER İKİ host için de çekilir (rewrite hedefi + `<html lang>` için gerekir).
 *   ANA HOST dalı: [3] bakım modu (503, MEVCUT — DEĞİŞMEDİ) → [4] `/doctor/**` doktor host'una
 *       307 devri (yalnızca `DOCTOR_ORIGIN` yapılandırılmışsa) → [5] locale redirect/rewrite
 *       (MEVCUT — DEĞİŞMEDİ).
 *   DOKTOR HOST dalı: [6] bakım modu UYGULANMAZ (`/appearance` fetch'i HİÇ YAPILMAZ — §3.3) →
 *       [7] auth yüzeyi (`/login` → hekim girişine rewrite, `/forgot-password`/`/reset-password`/
 *       `/verify-email` jenerik ekran, `/register` ana host'a devir) → [8] portal rotaları (tek
 *       dilli — §3.5) → [9] diğer her şey ana host'a 307 devredilir → [10] TÜM doktor host
 *       yanıtlarına `X-Robots-Tag: noindex, nofollow` + `x-doctor-portal: 1` eklenir.
 *
 *   `/activate-account` (§8.2) BU LİSTEYE EKLENMEZ — `[lang]/(site)/activate-account` altındadır
 *       (e-postadaki bağlantının hedefi public site'tır) ve normal [2]/[5] locale akışından geçer.
 *
 * Bu sıra `.claude/architect-scope-doctor-subdomain.md` §3.1'de birebir tanımlıdır ve
 * SORGULANMADAN uygulanır — alternatifler (koşullu header render, cookie/header köprüsü vb.)
 * orada değerlendirilip REDDEDİLMİŞTİR (§5.1).
 *
 * **`/admin` KESİNLİKLE etkilenmez** — aşağıdaki `matcher` admin/api/dashboard/invitations/pricing
 * rotalarını (bu monorepo'nun site-DIŞI SaaS yüzeyi) negatif lookahead ile hariç tutar; yönetici
 * kendini asla kilitleyemez (bağlayıcı kural). Admin panelinin dili URL'de DEĞİL, `localStorage`'dadır
 * (§7) — bu proxy admin rotalarını HİÇ görmez. **Kabul edilen sınır (§3.2, bilinçli):** doktor
 * host'unda `/admin` ve `/dashboard` erişilebilir kalır (proxy onları görmez) — bu bir güvenlik
 * açığı DEĞİLDİR (yetkilendirme API tarafındadır, host bazlı değildir), yalnızca kozmetik bir
 * sızıntıdır; doğru katman reverse proxy/CDN'dir (devops-agent takip kalemi).
 *
 * **`public/` altındaki statik dosyalar (`.*\..*`):** Bu proxy TÜM istekleri (yukarıdaki
 * negatif liste hariç) `/${locale}/...`'a rewrite eder — `_next/static`, `favicon.ico`,
 * `robots.txt`, `sitemap.xml` gibi tek tek isim isim hariç tutulanların ÖTESİNDE, `public/`
 * klasörüne SONRADAN eklenen HERHANGİ bir statik dosya (ör. `/placeholders/template-fallback.svg`,
 * `/demo-templates/<slug>/preview.svg`) da bu rewrite'a yakalanıp `/tr/placeholders/...` gibi var
 * olmayan bir sanal yola gönderiliyor, statik dosya çözümlenemediği için 404 dönüyordu (dosyanın
 * kendisi `frontend/public/` altında GERÇEKTEN var olsa bile). Kalıcı çözüm: nokta içeren (dosya
 * uzantılı) TÜM yolları genel bir kuralla hariç tut — böylece gelecekte `public/`'a eklenecek her
 * yeni asset için matcher'ı güncellemeye gerek kalmaz. Sitede uzantılı, locale-rewrite'a ihtiyaç
 * duyan başka bir route YOK (app/ altında yalnızca `robots.ts`/`sitemap.ts`/`api/health` var, hepsi
 * zaten ayrıca hariç).
 */
export const config = {
  matcher: [
    "/((?!admin|api|invitations|pricing|dashboard|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};

function maintenanceHtml(message: string, lang: string): string {
  // Tam bir React/SiteHeader render'ı burada MÜMKÜN DEĞİL (proxy React ağacı render edemez) —
  // bu yüzden bağımsız, minimal ve erişilebilir bir statik HTML.
  const safeMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Bakım Çalışması</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; background: #f8fafc; color: #111827; padding: 1.5rem; }
      main { max-width: 28rem; text-align: center; }
      h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
      p { color: #4b5563; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>Bakım Çalışması</h1>
      <p>${safeMessage}</p>
    </main>
  </body>
</html>`;
}

const DEFAULT_MAINTENANCE_MESSAGE = "Sitemizde bakım çalışması yapıyoruz. Kısa süre içinde geri döneceğiz.";
const FALLBACK_LOCALE_CODE = "tr";

/** `lib/api/server-locales.ts`'teki AYNI önbellek politikası (`revalidate: 60`) — proxy Edge
 *  runtime'ında paylaşılan modül state'ine güvenilemez, bu yüzden burada TEKRAR fetch edilir
 *  (Next'in `fetch` önbelleği zaten aynı URL için istekleri tekilleştirir). */
async function fetchEnabledLocales(): Promise<Locale[]> {
  try {
    const res = await fetch(`${SERVER_API_BASE_URL}/locales`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error("locales fetch failed");
    const json = (await res.json()) as { data: Locale[] };
    if (!json.data || json.data.length === 0) throw new Error("empty locales");
    return json.data;
  } catch {
    return [
      { code: FALLBACK_LOCALE_CODE, label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
    ];
  }
}

/**
 * §3.1 [1] — bu yollar ana host'ta proxy'nin GERİ KALANINI (bakım modu, locale, doktor devri) HİÇ
 * görmez. `.claude/architect-scope-guest-account-otp.md` §8.1 — `/verify-email` bu turda eklendi
 * (`app/(auth)/verify-email/page.tsx`, `/register` ile AYNI `(auth)` grubu/kabuk); `/activate-account`
 * BİLEREK BURADA DEĞİLDİR — o rota `[lang]/(site)/activate-account` altındadır (§8.2, e-postadaki
 * bağlantının hedefi public site'tır) ve normal locale rewrite/redirect akışından GEÇMESİ GEREKİR.
 */
const SAAS_AUTH_SURFACE_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"]);

/** `doctor-portal-route-guard.tsx::isDoctorPortalRoute` İLE AYNI genel `[a-z]{2}` locale prefix örüntüsü.
 *
 *  **2026-09-15 (architect, §5.6):** guard'da AYRICA `isDoctorSharedRouteException()` (`/consultation/{id}`)
 *  vardır ve o desen BURAYA TAŞINMAZ/BURADAKİYLE BİRLEŞTİRİLMEZ — bu desen "hangi HOST'ta servis
 *  edilir" sorusunu (oturumdan bağımsız, HASTA istekleri DAHİL) yanıtlar; `/consultation/**` ana
 *  host'ta kalır. Buraya eklenirse hasta magic-link (`?t=`) erişimi de doktor subdomain'ine 307'lenir
 *  (hasta orada authenticated değildir → login döngüsü). Gerekçenin tamamı guard dosyasındadır. */
const DOCTOR_PORTAL_ROUTE_PATTERN = /^\/(?:[a-z]{2}\/)?doctor(?:\/|$)/;
/** Yalnızca locale ÖNEKLİ hâli (`/tr/doctor`, `/en/doctor/earnings`) — §3.1 [8]'in 3. satırı. */
const DOCTOR_PORTAL_PREFIXED_ROUTE_PATTERN = /^\/[a-z]{2}\/doctor(?:\/|$)/;
/** Ana host'ta `/doctor/**` → doktor host'una devrederken locale prefix'ini soymak için (§3.1 [4]). */
const LEADING_LOCALE_SEGMENT_PATTERN = /^\/[a-z]{2}(?=\/|$)/;

/** §3.1 [10] — doktor host'undan dönen HER yanıta (rewrite/next/redirect fark etmez) uygulanır. */
function withDoctorPortalHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("x-doctor-portal", "1");
  return response;
}

/**
 * Farklı bir origin'e (mutlak) yönlendirme hedefi üretir — §3.6: origin YALNIZCA env'den (çağıranın
 * verdiği sabit) türetilir, `Host` header'ından DEĞİL.
 *
 * security-agent denetimi (§7.6, 2026-09-14, CWE-601 open redirect) — `pathname` filtrelenmeden
 * `new URL(`${pathname}${search}`, origin)`'e geçirilirse bu bir basit pathname-setter DEĞİL, TAM bir
 * WHATWG relative-URL çözümlemesidir: `pathname` `"//evil.example"` (protokol-göreli) veya
 * `"/\\evil.example"` (tarayıcı tarafından `//`'a normalize edilen ters slash) olursa, verilen
 * `origin` YOK SAYILIR ve sonuç `https://evil.example/`'a çözülür. `[4]` ve `[7]` çağrıları sabit/
 * doğrulanmış path'ler kullandığı için savunmasız DEĞİLDİR; ancak `[9]` catch-all dalı `pathname`'i
 * hiçbir filtreleme olmadan buraya iletiyordu. `isSafeInternalPath` (`lib/safe-redirect.ts`) TAM
 * OLARAK bu bypass sınıfını reddeder — login/register akışında zaten kullanılan AYNI kontrol burada
 * TEKRAR kullanılır (kod tekrarı YASAK); güvenli değilse path `"/"`'e normalize edilir, `new URL()`'e
 * asla ham/filtrelenmemiş hâliyle geçirilmez.
 */
function crossOriginUrl(origin: string, pathname: string, search: string): URL {
  const safePathname = isSafeInternalPath(pathname) ? pathname : "/";
  return new URL(`${safePathname}${search}`, origin);
}

/** §3.1 ANA HOST dalı — bakım modu, `/doctor/**` devri, locale redirect/rewrite. */
async function handleMainHost(request: NextRequest, pathname: string, defaultLocale: Locale, localeCodes: Set<string>): Promise<NextResponse> {
  // [3] BAKIM MODU (503) — MEVCUT KOD, DEĞİŞMEDİ.
  let maintenanceEnabled = false;
  let maintenanceMessage = DEFAULT_MAINTENANCE_MESSAGE;
  try {
    // `GET /appearance` — `(site)` layout'unun kendi çağrısıyla AYNI önbellek politikası
    // (`revalidate: 60`, §10.12.9) — bakım anahtarı için ikinci bir uç/politika İCAT edilmez.
    const res = await fetch(`${SERVER_API_BASE_URL}/appearance`, { next: { revalidate: 60 } });
    if (res.ok) {
      const json = (await res.json()) as { data: PublicSiteAppearance };
      maintenanceEnabled = Boolean(json.data?.maintenanceModeEnabled);
      maintenanceMessage = json.data?.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE;
    }
  } catch {
    // Ayar servisine erişilemezse siteyi KİLİTLEMEK yerine normal akışa devam et (fail-open) —
    // `fetchSiteAppearanceServer`'daki "asla çökme" ilkesiyle AYNI.
    maintenanceEnabled = false;
  }

  const firstSegment = pathname.split("/")[1] ?? "";

  if (maintenanceEnabled) {
    // Sıra bağlayıcıdır (§4.3) — bakım modundayken locale redirect/rewrite YAPILMAZ, 503 kazanır.
    // `<html lang>` yine de mümkün olduğunca doğru olsun diye URL'deki mevcut locale (varsa) kullanılır.
    const lang = localeCodes.has(firstSegment) ? firstSegment : defaultLocale.code;
    return new NextResponse(maintenanceHtml(maintenanceMessage, lang), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "3600" },
    });
  }

  // [4] DOKTOR ROTASI DEVRİ (§3.4) — yalnızca `DOCTOR_ORIGIN` yapılandırılmışsa. 307 (kalıcı DEĞİL):
  // doktor host'u bir dağıtım yapılandırmasıdır, kapatıldığında kalıcı bir yönlendirme kullanıcı
  // tarayıcısında hapsolmamalı; ayrıca 307 metodu/gövdeyi korur (RSC/POST navigasyonları güvenli).
  if (DOCTOR_ORIGIN && DOCTOR_PORTAL_ROUTE_PATTERN.test(pathname)) {
    const strippedPath = pathname.replace(LEADING_LOCALE_SEGMENT_PATTERN, "") || "/";
    return NextResponse.redirect(crossOriginUrl(DOCTOR_ORIGIN, strippedPath, request.nextUrl.search), 307);
  }

  // [5] LOCALE REDIRECT/REWRITE — MEVCUT KOD, DEĞİŞMEDİ.
  // `/tr/...` (varsayılan dilin KENDİ prefix'i) → 301 ile prefix'siz kanonik URL'e.
  if (firstSegment === defaultLocale.code) {
    const rest = pathname.slice(`/${defaultLocale.code}`.length) || "/";
    const url = request.nextUrl.clone();
    url.pathname = rest;
    return NextResponse.redirect(url, 301);
  }

  // Zaten geçerli, varsayılan-olmayan bir dil prefix'iyle geliyor (`/en/...`) — Next'in `[lang]`
  // dinamik segmenti bunu doğrudan eşleştirir, rewrite GEREKMEZ. `<html lang>` için header set edilir.
  if (localeCodes.has(firstSegment)) {
    const headers = new Headers(request.headers);
    headers.set("x-active-locale", firstSegment);
    return NextResponse.next({ request: { headers } });
  }

  // Prefix'siz istek (varsayılan dil) → dahili `/{defaultLocale}/...`'a REWRITE (redirect DEĞİL) —
  // ziyaretçinin gördüğü URL temiz kalır (§4.3).
  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale.code}${pathname === "/" ? "" : pathname}`;
  const headers = new Headers(request.headers);
  headers.set("x-active-locale", defaultLocale.code);
  return NextResponse.rewrite(url, { request: { headers } });
}

/** §3.1 DOKTOR HOST dalı — bakım modu UYGULANMAZ (§3.3), auth yüzeyi, tek dilli portal rotaları. */
function handleDoctorHost(request: NextRequest, pathname: string, defaultLocale: Locale): NextResponse {
  // [7] AUTH YÜZEYİ.
  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale.code}/doctor/login`;
    const headers = new Headers(request.headers);
    headers.set("x-active-locale", defaultLocale.code);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (pathname === "/forgot-password" || pathname === "/reset-password" || pathname === "/verify-email") {
    // Jenerik ekran — zaten `(auth)` grubunda, SiteHeader/Footer YOK; doktor host'una özgü bir
    // varyant GEREKMEZ. `/verify-email` (`.claude/architect-scope-guest-account-otp.md` §8.1)
    // AYNI gerekçeyle buraya eklendi — doktorlar kendi kendine kayıt olmasa da (§4) `login()`'ün
    // `requiresEmailVerification` dalı teorik olarak bu ekrana yönlendirebilir (§2.3).
    return NextResponse.next();
  }
  if (pathname === "/register") {
    // Hekimler kendi kendine kayıt olmaz (§4) — ana host'a devir.
    return NextResponse.redirect(crossOriginUrl(SITE_ORIGIN, pathname, request.nextUrl.search), 307);
  }

  // [8] PORTAL ROTALARI (tek dilli — §3.5, ziyaretçinin gördüğü URL HER ZAMAN prefix'sizdir).
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale.code}/doctor`;
    const headers = new Headers(request.headers);
    headers.set("x-active-locale", defaultLocale.code);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  // `/{lang}/doctor/...` biçiminde gelen bir istek → aynı host'ta prefix'siz hâline 307 (bu kontrol
  // genel `DOCTOR_PORTAL_ROUTE_PATTERN`'DEN ÖNCE gelir — o da prefix'li hâli eşler).
  if (DOCTOR_PORTAL_PREFIXED_ROUTE_PATTERN.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(LEADING_LOCALE_SEGMENT_PATTERN, "") || "/";
    return NextResponse.redirect(url, 307);
  }
  if (DOCTOR_PORTAL_ROUTE_PATTERN.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${defaultLocale.code}${pathname}`;
    const headers = new Headers(request.headers);
    headers.set("x-active-locale", defaultLocale.code);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // [9] DİĞER HER ŞEY (hasta/e-ticaret/kurumsal sayfalar) — ana host'a devir.
  return NextResponse.redirect(crossOriginUrl(SITE_ORIGIN, pathname, request.nextUrl.search), 307);
}

/** §6 — `Host` header'ı (port HARİÇ, lowercase) tam olarak bunlardan biriyse "eski şema" kabul edilir. */
const LEGACY_LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // [0] Host tespiti — App Router'da `nextUrl` host/hostname ALANI SUNMAZ (§2.3), `Host` header'ı okunur.
  const host = request.headers.get("host") ?? "";
  const normalizedHost = host.split(":")[0]?.trim().toLowerCase() ?? "";

  // [-1] §6 ESKİ `localhost` HOST MİGRASYONU — bkz. dosya başı yorumu. `SITE_HOST !== "localhost"`
  // koşulu, host şeması GERÇEKTEN taşınmışsa (`siteadi.localhost` vb.) anlamlıdır; biri hâlâ eski
  // şemayla (`NEXT_PUBLIC_SITE_URL=http://localhost:3000`) çalışıyorsa (`SITE_HOST === "localhost"`)
  // bu dal devre dışı kalır (geriye dönük uyumluluk) — ayrıca `normalizedHost !== SITE_HOST` kontrolü
  // zaten bu durumda `localhost` isteğini "eski host" saymayacağından sonsuz döngü de OLUŞAMAZ. Bu dal
  // `isSubdomainModeEnabled()`'a BAĞLI DEĞİLDİR — `NEXT_PUBLIC_DOCTOR_URL` tanımsız olsa BİLE (subdomain
  // modu kapalıyken) çalışmalıdır, çünkü bu doktor özelliğinden bağımsız saf bir host migrasyonudur.
  if (
    SITE_HOST !== null &&
    SITE_HOST !== "localhost" &&
    LEGACY_LOCALHOST_HOSTNAMES.has(normalizedHost) &&
    normalizedHost !== SITE_HOST &&
    normalizedHost !== DOCTOR_HOST
  ) {
    return NextResponse.redirect(crossOriginUrl(SITE_ORIGIN, pathname, request.nextUrl.search), 307);
  }

  const isDoctorHost = isDoctorHostname(host);

  // [1] SaaS auth yüzeyi erken çıkışı — YALNIZCA ana host'ta, locale/bakım-modu fetch'lerinden ÖNCE.
  if (!isDoctorHost && SAAS_AUTH_SURFACE_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // [2] Locale listesi — her iki host için de gerekli (rewrite hedefi + `<html lang>`).
  const locales = await fetchEnabledLocales();
  const defaultLocale = locales.find((l) => l.isDefault) ?? locales[0]!;
  const localeCodes = new Set(locales.map((l) => l.code));

  if (isDoctorHost) {
    return withDoctorPortalHeaders(handleDoctorHost(request, pathname, defaultLocale));
  }

  return handleMainHost(request, pathname, defaultLocale, localeCodes);
}
