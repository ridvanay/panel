import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * §10.12.5 Bakım Modu (ARCHITECTURE.md) + `.claude/architect-scope-i18n.md` §4.3 locale routing —
 * `frontend/src/proxy.ts` doğrulaması. Bağlayıcı kurallar:
 * 1. `maintenanceModeEnabled: true` iken public site 503 + `Retry-After` döner (200 DEĞİL —
 *    arama motorlarının bakım sayfasını indekslememesi için).
 * 2. `config.matcher` negatif lookahead'i `/admin` (ve `/api`) rotalarını HARİÇ tutar — yönetici
 *    kendini asla kilitleyemez; bu, API seviyesinde DEĞİL yalnızca proxy seviyesinde bir sunum
 *    anahtarıdır.
 * 3. Ayar servisine erişilemezse (ağ hatası/5xx) fail-open — siteyi KİLİTLEMEZ.
 * 4. Sıra bağlayıcıdır: bakım modu ÖNCE, locale rewrite/redirect SONRA (bakım modundayken dil
 *    yönlendirmesi YAPILMAZ).
 */

const DEFAULT_LOCALES = [
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** URL'e göre farklı yanıt döndüren fetch mock'u — proxy hem `/appearance` hem `/locales` çağırır. */
function makeFetchMock(appearanceBody: unknown, appearanceStatus = 200) {
  return vi.fn((url: string) => {
    if (url.includes("/locales")) return Promise.resolve(jsonResponse({ data: DEFAULT_LOCALES }));
    const wrapped = appearanceStatus === 200 ? { data: appearanceBody } : appearanceBody;
    return Promise.resolve(jsonResponse(wrapped, appearanceStatus));
  });
}

function makeRequest(path = "/"): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("proxy — bakım modu (§10.12.5) + locale routing (§4.3)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maintenanceModeEnabled: true iken 503 + Retry-After döner, mesaj HTML gövdesinde yer alır", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: true, maintenanceMessage: "Kısa bir bakımdayız." }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest());

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("Kısa bir bakımdayız.");
    expect(body).toContain('name="robots" content="noindex"');
  });

  it("maintenanceMessage null/boşsa sabit Türkçe varsayılan metin kullanılır", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: true, maintenanceMessage: null }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain("Sitemizde bakım çalışması yapıyoruz. Kısa süre içinde geri döneceğiz.");
  });

  it("bakım mesajındaki HTML özel karakterleri kaçırılır (statik sayfa React render ETMEZ, kendi kaçışını yapar)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ maintenanceModeEnabled: true, maintenanceMessage: "<script>alert(1)</script>" })
    );

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest());

    const body = await res.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("maintenanceModeEnabled: false iken 503 DÖNMEZ (normal akışa devam — locale rewrite'a düşer)", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: false, maintenanceMessage: null }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest());

    expect(res.status).not.toBe(503);
  });

  it("ayar servisi ağ hatası verirse fail-open olur (siteyi KİLİTLEMEZ, 503 DÖNMEZ)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/locales")) return Promise.resolve(jsonResponse({ data: DEFAULT_LOCALES }));
        return Promise.reject(new Error("ECONNREFUSED"));
      })
    );

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest());

    expect(res.status).not.toBe(503);
  });

  it("ayar servisi 5xx/olmayan bir yanıt döndürürse fail-open olur (503 DÖNMEZ)", async () => {
    vi.stubGlobal("fetch", makeFetchMock("boom", 500));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest());

    expect(res.status).not.toBe(503);
  });

  it("`GET /appearance` public ucunu revalidate: 60 ile çağırır — `(site)` layout'uyla AYNI önbellek politikası, ikinci bir uç İCAT EDİLMEZ", async () => {
    const fetchMock = makeFetchMock({ maintenanceModeEnabled: false });
    vi.stubGlobal("fetch", fetchMock);

    const { proxy } = await import("@/proxy");
    await proxy(makeRequest());

    const appearanceCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("/appearance"));
    expect(appearanceCall).toBeDefined();
    const [, init] = appearanceCall as unknown as [string, { next?: { revalidate?: number } }];
    expect(init?.next?.revalidate).toBe(60);
  });

  it("`config.matcher` — `/admin` ve `/api` rotalarını negatif lookahead ile HARİÇ tutar (yönetici kendini asla kilitleyemez)", async () => {
    const { config } = await import("@/proxy");
    const pattern = config.matcher[0];

    expect(pattern).toContain("(?!admin|api|");
  });

  it("`/tr/...` (varsayılan dilin kendi prefix'i) 301 ile prefix'siz kanonik URL'e yönlendirilir", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: false }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest("/tr/hakkimizda"));

    expect(res.status).toBe(301);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/hakkimizda");
  });

  it("prefix'siz istek (varsayılan dil) dahili olarak `/tr/...`'a REWRITE edilir — ziyaretçinin gördüğü URL değişmez", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: false }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest("/hakkimizda"));

    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/hakkimizda");
  });

  it("`/en/...` (varsayılan olmayan geçerli dil) doğrudan geçer — rewrite YAPILMAZ", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: false }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest("/en/about-us"));

    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).not.toBe(301);
  });

  it("bakım modu + locale birlikte — bakım açıkken `/en/...` de 503 döner (locale mantığı bakım kontrolünü BYPASS ETMEZ)", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ maintenanceModeEnabled: true, maintenanceMessage: "Bakımdayız." }));

    const { proxy } = await import("@/proxy");
    const res = await proxy(makeRequest("/en/about-us"));

    expect(res.status).toBe(503);
  });
});
