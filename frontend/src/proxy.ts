import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SERVER_API_BASE_URL } from "@/lib/env";
import type { PublicSiteAppearance, Locale } from "@/lib/api/types";

/**
 * §10.12.5 Bakım Modu — SUNUM anahtarıdır, bir GÜVENLİK kontrolü DEĞİLDİR: API'yi kapatmaz,
 * hiçbir veriyi korumaz. Yalnızca ziyaretçi (`(site)`) sayfalarını etkiler.
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
 * **§10.5 / `.claude/architect-scope-i18n.md` §4.3 — TEK proxy dosyası, İKİ sorumluluk:**
 * Next 16 tek bir proxy dosyasına izin verir; bu yüzden locale rewrite/redirect mantığı bu
 * MEVCUT fonksiyona eklenir, ikinci bir dosya AÇILMAZ. **Sıra bağlayıcıdır:** önce bakım modu
 * (503 kazanır — bakım modundayken dil yönlendirmesi YAPILMAZ), sonra locale çözümlemesi.
 *
 * **`/admin` KESİNLİKLE etkilenmez** — aşağıdaki `matcher` admin/api/auth/SaaS rotalarını
 * (`/login`, `/dashboard` vb. — bu monorepo'nun site-DIŞI SaaS yüzeyi) negatif lookahead ile
 * hariç tutar; yönetici kendini asla kilitleyemez (bağlayıcı kural). Admin panelinin dili
 * URL'de DEĞİL, `localStorage`'dadır (§7) — bu proxy admin rotalarını HİÇ görmez.
 */
export const config = {
  matcher: [
    "/((?!admin|api|login|register|forgot-password|reset-password|invitations|pricing|dashboard|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  const locales = await fetchEnabledLocales();
  const defaultLocale = locales.find((l) => l.isDefault) ?? locales[0]!;
  const localeCodes = new Set(locales.map((l) => l.code));

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

  // `/tr/...` (varsayılan dilin KENDİ prefix'i) → 301 ile prefix'siz kanonik URL'e.
  // §12.2 — varsayılan dildeki kanonik slug ile farklı bir locale prefix'i altında gelen istekler
  // (`/en/gizlilik-politikasi` gibi) BU KURALA girmez, backend slug fallback'i zaten çözer.
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
