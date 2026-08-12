import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/env";
import type { PublicSiteAppearance } from "@/lib/api/types";

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
 * **`/admin` KESİNLİKLE etkilenmez** — aşağıdaki `matcher` admin/api/auth/SaaS rotalarını
 * (`/login`, `/dashboard` vb. — bu monorepo'nun site-DIŞI SaaS yüzeyi) negatif lookahead ile
 * hariç tutar; yönetici kendini asla kilitleyemez (bağlayıcı kural).
 */
export const config = {
  matcher: [
    "/((?!admin|api|login|register|forgot-password|reset-password|invitations|pricing|dashboard|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};

function maintenanceHtml(message: string): string {
  // Tam bir React/SiteHeader render'ı burada MÜMKÜN DEĞİL (proxy React ağacı render edemez) —
  // bu yüzden bağımsız, minimal ve erişilebilir bir statik HTML.
  const safeMessage = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="tr">
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

export async function proxy() {
  try {
    // `GET /appearance` — `(site)` layout'unun kendi çağrısıyla AYNI önbellek politikası
    // (`revalidate: 60`, §10.12.9) — bakım anahtarı için ikinci bir uç/politika İCAT edilmez.
    const res = await fetch(`${API_BASE_URL}/appearance`, { next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.next();

    const json = (await res.json()) as { data: PublicSiteAppearance };
    if (!json.data?.maintenanceModeEnabled) return NextResponse.next();

    const message = json.data.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE;
    return new NextResponse(maintenanceHtml(message), {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "3600" },
    });
  } catch {
    // Ayar servisine erişilemezse siteyi KİLİTLEMEK yerine normal akışa devam et (fail-open) —
    // `fetchSiteAppearanceServer`'daki "asla çökme" ilkesiyle AYNI.
    return NextResponse.next();
  }
}
