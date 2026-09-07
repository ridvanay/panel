import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `lib/env.ts::toInternalMediaUrl` — Docker'da next/image'in KENDİ sunucu-taraflı optimize
 * fetch'i (frontend container'ının İÇİNDE çalışır) backend'in tarayıcıya göre mutlaklaştırdığı
 * medya URL'lerine (`http://localhost:4000/uploads/...`) ULAŞAMAZ (`ECONNREFUSED` — o container'ın
 * KENDİ localhost'u, backend DEĞİL). Bu fonksiyon, server component'lerin fetch ettiği ham API
 * JSON metnindeki bu host'u (varsa `NEXT_PUBLIC_INTERNAL_MEDIA_URL`, ör. `http://backend:4000`)
 * ile değiştirir — bkz. o değişkenin `env.ts`'teki tam gerekçe yorumu.
 *
 * `NEXT_PUBLIC_*` modül-seviyesi sabitler `process.env`'den İMPORT ANINDA okunur — bu yüzden her
 * senaryo `vi.resetModules()` + dinamik `import()` ile TAZE bir modül örneği gerektirir (aksi
 * halde önceki testin env'i önbelleğe alınmış sabitlerde kalır).
 */
describe("toInternalMediaUrl (lib/env.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NEXT_PUBLIC_INTERNAL_MEDIA_URL tanımsızken (Docker dışı/lokal geliştirme) no-op'tur", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api/v1");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "");
    const { toInternalMediaUrl } = await import("@/lib/env");

    const raw = JSON.stringify({ data: { coverMedia: { url: "http://localhost:4000/uploads/x.png" } } });
    expect(toInternalMediaUrl(raw)).toBe(raw);
  });

  it("tanımlıyken ham JSON metnindeki HER public medya host geçişini Docker-içi host'a çevirir", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api/v1");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "http://backend:4000");
    const { toInternalMediaUrl } = await import("@/lib/env");

    const raw = JSON.stringify({
      data: {
        coverMedia: { url: "http://localhost:4000/uploads/cover.png" },
        images: [{ media: { url: "http://localhost:4000/uploads/gallery-1.png" } }],
      },
    });

    const rewritten = JSON.parse(toInternalMediaUrl(raw));
    expect(rewritten.data.coverMedia.url).toBe("http://backend:4000/uploads/cover.png");
    expect(rewritten.data.images[0].media.url).toBe("http://backend:4000/uploads/gallery-1.png");
  });

  it("public origin'den FARKLI (ör. gerçek S3/CDN) host'lara dokunmaz", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api/v1");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "http://backend:4000");
    const { toInternalMediaUrl } = await import("@/lib/env");

    const raw = JSON.stringify({ data: { coverMedia: { url: "https://cdn.example.com/uploads/cover.png" } } });
    expect(toInternalMediaUrl(raw)).toBe(raw);
  });
});
