import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §10.12.5 Bakım Modu (ARCHITECTURE.md) — `frontend/src/proxy.ts` doğrulaması. Bu dosya için
 * projede daha önce HİÇ test yoktu (qa-agent boşluğu). Bağlayıcı kurallar:
 * 1. `maintenanceModeEnabled: true` iken public site 503 + `Retry-After` döner (200 DEĞİL —
 *    arama motorlarının bakım sayfasını indekslememesi için).
 * 2. `(config.matcher` negatif lookahead'i `/admin` (ve `/api`) rotalarını HARİÇ tutar — yönetici
 *    kendini asla kilitleyemez; bu, API seviyesinde DEĞİL yalnızca proxy seviyesinde bir sunum
 *    anahtarıdır.
 * 3. Ayar servisine erişilemezse (ağ hatası/5xx) fail-open — siteyi KİLİTLEMEZ.
 */
describe("proxy — bakım modu (§10.12.5)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("maintenanceModeEnabled: true iken 503 + Retry-After döner, mesaj HTML gövdesinde yer alır", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { maintenanceModeEnabled: true, maintenanceMessage: "Kısa bir bakımdayız." } }),
        { status: 200 }
      )
    );

    const { proxy } = await import("@/proxy");
    const res = await proxy();

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const body = await res.text();
    expect(body).toContain("Kısa bir bakımdayız.");
    expect(body).toContain('name="robots" content="noindex"');
  });

  it("maintenanceMessage null/boşsa sabit Türkçe varsayılan metin kullanılır", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { maintenanceModeEnabled: true, maintenanceMessage: null } }), {
        status: 200,
      })
    );

    const { proxy } = await import("@/proxy");
    const res = await proxy();

    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain("Sitemizde bakım çalışması yapıyoruz. Kısa süre içinde geri döneceğiz.");
  });

  it("bakım mesajındaki HTML özel karakterleri kaçırılır (statik sayfa React render ETMEZ, kendi kaçışını yapar)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { maintenanceModeEnabled: true, maintenanceMessage: "<script>alert(1)</script>" } }),
        { status: 200 }
      )
    );

    const { proxy } = await import("@/proxy");
    const res = await proxy();

    const body = await res.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("maintenanceModeEnabled: false iken 503 DÖNMEZ (normal akışa devam)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { maintenanceModeEnabled: false, maintenanceMessage: null } }), {
        status: 200,
      })
    );

    const { proxy } = await import("@/proxy");
    const res = await proxy();

    expect(res.status).not.toBe(503);
  });

  it("ayar servisi ağ hatası verirse fail-open olur (siteyi KİLİTLEMEZ, 503 DÖNMEZ)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const { proxy } = await import("@/proxy");
    const res = await proxy();

    expect(res.status).not.toBe(503);
  });

  it("ayar servisi 5xx/olmayan bir yanıt döndürürse fail-open olur (503 DÖNMEZ)", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));

    const { proxy } = await import("@/proxy");
    const res = await proxy();

    expect(res.status).not.toBe(503);
  });

  it("`GET /appearance` public ucunu revalidate: 60 ile çağırır — `(site)` layout'uyla AYNI önbellek politikası, ikinci bir uç İCAT EDİLMEZ", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { maintenanceModeEnabled: false } }), { status: 200 })
    );

    const { proxy } = await import("@/proxy");
    await proxy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { next?: { revalidate?: number } }];
    expect(url).toContain("/appearance");
    expect(init?.next?.revalidate).toBe(60);
  });

  it("`config.matcher` — `/admin` ve `/api` rotalarını negatif lookahead ile HARİÇ tutar (yönetici kendini asla kilitleyemez)", async () => {
    const { config } = await import("@/proxy");
    const pattern = config.matcher[0];

    expect(pattern).toContain("(?!admin|api|");
  });
});
