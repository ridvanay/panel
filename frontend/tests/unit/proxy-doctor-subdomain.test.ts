import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §3.1/§7.3 madde 12 — `proxy.ts`'in hekim portalı
 * host-izolasyon karar tablosu. `tests/unit/proxy-maintenance-mode.test.ts`'teki AYNI desen
 * (`vi.resetModules()` + dinamik `import("@/proxy")` + URL'e göre dallanan `fetch` mock'u); BU
 * dosya `proxy.ts`'in bakım modu + locale davranışını YENİDEN test ETMEZ (o dosyada zaten var),
 * yalnızca `.claude/architect-scope-doctor-subdomain.md` ile eklenen ÜÇÜNCÜ sorumluluğu (host
 * bazlı devir) kapsar.
 *
 * `NEXT_PUBLIC_DOCTOR_URL`/`NEXT_PUBLIC_SITE_URL` build-time env'leri `lib/doctor-host.ts`'te
 * modül-seviyesinde okunur — `vi.resetModules()` + dinamik `import()` OLMADAN env değişikliği
 * proxy'ye YANSIMAZ (aynı gerekçe `tests/unit/doctor-host.test.ts`'te de yazılıdır).
 */

const SITE_ORIGIN = "http://siteadi.localhost:3100";
const DOCTOR_ORIGIN = "http://doktor.siteadi.localhost:3100";

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_DOCTOR_URL = process.env.NEXT_PUBLIC_DOCTOR_URL;

const DEFAULT_LOCALES = [
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Bakım modu KAPALI sabit bir `/appearance` + `/locales` fetch mock'u — çağrı sayısı/URL'i izlenebilir. */
function makeFetchMock() {
  return vi.fn((url: string) => {
    if (url.includes("/locales")) return Promise.resolve(jsonResponse({ data: DEFAULT_LOCALES }));
    if (url.includes("/appearance")) return Promise.resolve(jsonResponse({ data: { maintenanceModeEnabled: false } }));
    return Promise.reject(new Error(`beklenmeyen fetch: ${url}`));
  });
}

function makeRequest(path: string, host: string): NextRequest {
  const origin = host.startsWith("doktor.") ? DOCTOR_ORIGIN : SITE_ORIGIN;
  return new NextRequest(new URL(path, origin), { headers: { host } });
}

/**
 * security-agent denetimi (§7.6, CWE-601) regresyon testi — `makeRequest`'in AKSİNE `new URL(path,
 * origin)` KULLANMAZ. `path` `"//evil.example"` gibi protokol-göreli bir değer olduğunda
 * `new URL(path, origin)` (relative-URL resolution) origin'i YOK SAYIP path'i doğrudan
 * `https://evil.example/`'a çözer — yani test isteğinin KENDİSİ, test etmek istediğimiz saldırıyı
 * yanlışlıkla simüle eder (host asla `doktor.*` olarak set edilemez). Gerçek bir HTTP isteğinde
 * `pathname`, host'un PARSE EDİLMESİNDEN SONRA gelir; bunu doğru simüle etmek için origin + path'i
 * TEK bir MUTLAK URL DİZESİ olarak (base'SİZ) parse ediyoruz — `new URL("http://host//evil.example")`
 * host'u KORUR, `pathname`'i `"//evil.example"` olarak saklar (doğrulanmıştır).
 */
function makeRawRequest(pathAndSearch: string, host: string): NextRequest {
  const origin = host.startsWith("doktor.") ? DOCTOR_ORIGIN : SITE_ORIGIN;
  return new NextRequest(new URL(`${origin}${pathAndSearch}`), { headers: { host } });
}

describe("proxy — hekim portalı host-izolasyonu (.claude/architect-scope-doctor-subdomain.md §3.1)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SITE_URL = SITE_ORIGIN;
    process.env.NEXT_PUBLIC_DOCTOR_URL = DOCTOR_ORIGIN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
    if (ORIGINAL_DOCTOR_URL === undefined) delete process.env.NEXT_PUBLIC_DOCTOR_URL;
    else process.env.NEXT_PUBLIC_DOCTOR_URL = ORIGINAL_DOCTOR_URL;
    vi.resetModules();
  });

  it("doktor host `/` → `/{defaultLocale}/doctor`'a REWRITE edilir (ziyaretçinin gördüğü URL `/` kalır)", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/", "doktor.siteadi.localhost:3100"));

    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/doctor");
  });

  it("doktor host yanıtı `X-Robots-Tag: noindex, nofollow` + `x-doctor-portal: 1` taşır (§3.1 [10])", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/", "doktor.siteadi.localhost:3100"));

    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("x-doctor-portal")).toBe("1");
  });

  it("doktor host `/login` → hekim girişine REWRITE edilir (`/{defaultLocale}/doctor/login`)", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/login", "doktor.siteadi.localhost:3100"));

    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/doctor/login");
  });

  it("doktor host `/register` → ana host'a 307 devredilir (hekimler kendi kendine kayıt olmaz)", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/register?ref=x", "doktor.siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(SITE_ORIGIN);
    expect(location.pathname).toBe("/register");
    expect(location.search).toBe("?ref=x");
  });

  it("doktor host `/urunler` (hasta/e-ticaret sayfası) → ana host'a 307 devredilir, query korunur", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/urunler?kategori=a", "doktor.siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(SITE_ORIGIN);
    expect(location.pathname).toBe("/urunler");
    expect(location.search).toBe("?kategori=a");
  });

  it("doktor host `/tr/doctor` (locale önekli) → AYNI host'ta prefix'siz `/doctor`'a 307 (§3.5 — tek dilli host)", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/tr/doctor", "doktor.siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(DOCTOR_ORIGIN);
    expect(location.pathname).toBe("/doctor");
  });

  it("doktor host `/doctor/earnings` (prefix'siz) → `/{defaultLocale}/doctor/earnings`'e REWRITE edilir", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/doctor/earnings", "doktor.siteadi.localhost:3100"));

    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/doctor/earnings");
  });

  it("doktor host'unda BAKIM MODU uygulanmaz — `/appearance` HİÇ fetch edilmez (§3.3)", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { proxy } = await import("@/proxy");

    await proxy(makeRequest("/", "doktor.siteadi.localhost:3100"));

    const appearanceCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("/appearance"));
    expect(appearanceCall).toBeUndefined();
  });

  it("ana host `/doctor` → `DOCTOR_ORIGIN` yapılandırılmışsa doktor host'una 307 devredilir (§3.4)", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/doctor", "siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(DOCTOR_ORIGIN);
    expect(location.pathname).toBe("/doctor");
  });

  it("ana host `/tr/doctor` → locale prefix'i SOYULARAK doktor host'una 307 devredilir", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/tr/doctor/earnings", "siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(DOCTOR_ORIGIN);
    expect(location.pathname).toBe("/doctor/earnings");
  });

  it("ana host `/login`/`/register`/`/forgot-password`/`/reset-password` — DOCTOR_ORIGIN yapılandırılmışken de REGRESYON YOK (§3.2)", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { proxy } = await import("@/proxy");

    for (const path of ["/login", "/register", "/forgot-password", "/reset-password"]) {
      const res = await proxy(makeRequest(path, "siteadi.localhost:3100"));
      expect(res.status).not.toBe(307);
      expect(res.status).not.toBe(301);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    }
    // Bu dört yol locale/bakım-modu fetch'lerinden ÖNCE `next()` ile döner — hiç fetch atılmaz.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bakım modu AÇIK: ana host 503 döner, doktor host `/doctor` 200'e denk REWRITE ile devam eder (§3.3/§7.4 senaryo 9)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/locales")) return Promise.resolve(jsonResponse({ data: DEFAULT_LOCALES }));
      if (url.includes("/appearance")) return Promise.resolve(jsonResponse({ data: { maintenanceModeEnabled: true, maintenanceMessage: "Bakımdayız." } }));
      return Promise.reject(new Error(`beklenmeyen fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { proxy } = await import("@/proxy");

    const mainRes = await proxy(makeRequest("/", "siteadi.localhost:3100"));
    expect(mainRes.status).toBe(503);

    const doctorRes = await proxy(makeRequest("/", "doktor.siteadi.localhost:3100"));
    expect(doctorRes.status).not.toBe(503);
    expect(doctorRes.headers.get("x-middleware-rewrite")).toContain("/tr/doctor");
  });

  it("doktor host `//evil.example` (protokol-göreli path, [9] catch-all) → ana host'a 307 devredilir, DIŞ DOMAİNE DEĞİL (security-agent §7.6, CWE-601)", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRawRequest("//evil.example", "doktor.siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    // KRİTİK doğrulama: hedef GÜVENİLEN ana site origin'idir, `pathname`'in çözdüğü keyfi
    // `evil.example` origin'i DEĞİL.
    expect(location.origin).toBe(SITE_ORIGIN);
    expect(location.hostname).not.toBe("evil.example");
    expect(location.pathname).toBe("/");
  });

  it("doktor host `//evil.example` sorgu dizesiyle birlikte de güvenli hedefe normalize edilir", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRawRequest("//evil.example?next=/account", "doktor.siteadi.localhost:3100"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(SITE_ORIGIN);
    expect(location.hostname).not.toBe("evil.example");
    expect(location.pathname).toBe("/");
  });

  it("`NEXT_PUBLIC_DOCTOR_URL` tanımsızken ana host `/doctor` ESKİSİ GİBİ çalışır (307 devri YOK, geriye dönük uyumluluk §3.4)", async () => {
    delete process.env.NEXT_PUBLIC_DOCTOR_URL;
    vi.resetModules();
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/doctor", "siteadi.localhost:3100"));

    expect(res.status).not.toBe(307);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/doctor");
  });
});

describe("proxy — §6 ESKİ `localhost` HOST MİGRASYONU (backend CORS allow-list yalnızca yeni host'u tanır)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SITE_URL = SITE_ORIGIN;
    process.env.NEXT_PUBLIC_DOCTOR_URL = DOCTOR_ORIGIN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
    if (ORIGINAL_DOCTOR_URL === undefined) delete process.env.NEXT_PUBLIC_DOCTOR_URL;
    else process.env.NEXT_PUBLIC_DOCTOR_URL = ORIGINAL_DOCTOR_URL;
    vi.resetModules();
  });

  it("`Host: localhost` isteği, [1]/[2]'den (SaaS auth erken çıkışı, locale fetch'i) ÖNCE, `SITE_ORIGIN + pathname`'e 307 YÖNLENDİRİLİR — hiç fetch atılmaz", async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const { proxy } = await import("@/proxy");

    const res = await proxy(new NextRequest(new URL("/login", SITE_ORIGIN), { headers: { host: "localhost:3100" } }));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(SITE_ORIGIN);
    expect(location.pathname).toBe("/login");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("`Host: 127.0.0.1` isteği de AYNI şekilde `SITE_ORIGIN`'e 307 yönlendirilir, query korunur", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(new NextRequest(new URL("/urunler?kategori=a", SITE_ORIGIN), { headers: { host: "127.0.0.1:3100" } }));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(SITE_ORIGIN);
    expect(location.pathname).toBe("/urunler");
    expect(location.search).toBe("?kategori=a");
  });

  it("`Host: siteadi.localhost` (zaten doğru host) bu yeni dala HİÇ GİRMEZ, normal locale rewrite akışına devam eder", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/urunler", "siteadi.localhost:3100"));

    expect(res.status).not.toBe(307);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/urunler");
  });

  it("`Host: doktor.siteadi.localhost` (doktor host'u) bu yeni dala HİÇ GİRMEZ, doktor host akışı korunur", async () => {
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(makeRequest("/", "doktor.siteadi.localhost:3100"));

    expect(res.status).not.toBe(307);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr/doctor");
  });

  it("`SITE_HOST === \"localhost\"` (biri hâlâ eski şemayla çalışıyorsa) bu yeni dal DEVRE DIŞI kalır — `Host: 127.0.0.1` bile 307 ÜRETMEZ", async () => {
    delete process.env.NEXT_PUBLIC_DOCTOR_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3100";
    vi.resetModules();
    vi.stubGlobal("fetch", makeFetchMock());
    const { proxy } = await import("@/proxy");

    const res = await proxy(new NextRequest(new URL("/", "http://localhost:3100"), { headers: { host: "127.0.0.1:3100" } }));

    expect(res.status).not.toBe(307);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/tr");
  });
});
