import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchServerJson, ServerFetchError, withBuildTimeFallback } from "@/lib/api/server-fetch";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPageBySlugServer } from "@/lib/api/server-pages";
import { fetchPublicModulesServer } from "@/lib/api/server-modules";

/**
 * Sunucu tarafı fetch'ler YALNIZCA gerçek 404'te "bulunamadı" döner; 429/5xx/ağ hatası fırlatır ki
 * Next.js hatalı render'ı (404 sayfası, logosuz varsayılan ayarlar) önbelleğe almasın.
 */
function stubFetch(response: Response | Error) {
  const mock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchServerJson", () => {
  it("200 → gövde; etiketler ve 60 sn yedek yenileme fetch'e iletilir", async () => {
    const mock = stubFetch(Response.json({ data: { ok: true } }));
    await expect(fetchServerJson("/settings", { tags: ["settings"] })).resolves.toEqual({ data: { ok: true } });
    expect(mock).toHaveBeenCalledWith(expect.stringMatching(/\/settings$/), { next: { revalidate: 60, tags: ["settings"] } });
  });

  it("404 → null", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(fetchServerJson("/pages/yok")).resolves.toBeNull();
  });

  it.each([429, 500, 503])("%i → ServerFetchError fırlatır (bulunamadı DEĞİL)", async (status) => {
    stubFetch(new Response(null, { status }));
    await expect(fetchServerJson("/settings")).rejects.toMatchObject({ name: "ServerFetchError", status });
  });

  it("ağ hatası → fırlatır", async () => {
    stubFetch(new TypeError("fetch failed"));
    await expect(fetchServerJson("/settings")).rejects.toThrow("fetch failed");
  });

  it("noStore → cache: no-store", async () => {
    const mock = stubFetch(Response.json({ data: 1 }));
    await fetchServerJson("/contact/form", { noStore: true });
    expect(mock).toHaveBeenCalledWith(expect.any(String), { cache: "no-store" });
  });
});

describe("veri çeken fonksiyonlar 429'da boş/varsayılan DÖNMEZ", () => {
  it("fetchSiteSettingsServer 429 → fırlatır (eskiden logoUrl:null varsayılanı dönüp önbelleğe giriyordu)", async () => {
    stubFetch(new Response(null, { status: 429 }));
    await expect(fetchSiteSettingsServer()).rejects.toBeInstanceOf(ServerFetchError);
  });

  it("fetchPageBySlugServer: 404 → null (gerçek bulunamadı), 429 → fırlatır", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(fetchPageBySlugServer("yok", "tr")).resolves.toBeNull();
    stubFetch(new Response(null, { status: 429 }));
    await expect(fetchPageBySlugServer("hakkimizda", "tr")).rejects.toBeInstanceOf(ServerFetchError);
  });

  it("fetchPublicModulesServer 503 → fırlatır (eskiden [] dönüp modül sayfalarını 404'e düşürüyordu)", async () => {
    stubFetch(new Response(null, { status: 503 }));
    await expect(fetchPublicModulesServer()).rejects.toBeInstanceOf(ServerFetchError);
  });
});

describe("withBuildTimeFallback", () => {
  it("next build aşamasında hata → fallback (backend'siz Docker build kırılmaz)", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await expect(withBuildTimeFallback(() => Promise.reject(new Error("ECONNREFUSED")), [])).resolves.toEqual([]);
  });

  it("çalışma zamanında hata fırlatılır", async () => {
    vi.stubEnv("NEXT_PHASE", "");
    await expect(withBuildTimeFallback(() => Promise.reject(new Error("429")), [])).rejects.toThrow("429");
  });
});
