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

/**
 * `lib/env.ts::toPublicMediaUrl` — `toInternalMediaUrl`'ün TERSİ. `generateMetadata`
 * (`openGraph.images`) VE JSON-LD (`doctor-json-ld.ts`/`product-json-ld.ts`) gibi dış
 * crawler'ların DOĞRUDAN erişmesi gereken alanlar, `toInternalMediaUrl` tarafından (Docker'da)
 * zaten `INTERNAL_MEDIA_ORIGIN`'e çevrilmiş bir değer alabilir — bu fonksiyon bunu GERİ ÇEVİRİR.
 */
describe("toPublicMediaUrl (lib/env.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("null/undefined için null döner", async () => {
    const { toPublicMediaUrl } = await import("@/lib/env");
    expect(toPublicMediaUrl(null)).toBeNull();
    expect(toPublicMediaUrl(undefined)).toBeNull();
  });

  // NOT: `NEXT_PUBLIC_API_URL` BİLİNÇLİ OLARAK gerçek bir prod domain'i — `http://localhost:4000`
  // KULLANILMAZ, çünkü bu fonksiyonun KENDİ savunma-derinliği dalı (aşağıdaki test) ÇIPLAK
  // `localhost`'u da loopback sayıp `SITE_URL`'e çevirir; bu iki test "geri çevirme SONUCU zaten
  // GERÇEK genel bir host'a ulaştıysa DOKUNMA" davranışını izole doğrular.
  it("INTERNAL_MEDIA_ORIGIN'e çevrilmiş bir URL'yi GERÇEK genel origin'e geri çevirir", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://wmhealthistanbul.com/api/v1");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "http://backend:4000");
    const { toPublicMediaUrl } = await import("@/lib/env");

    expect(toPublicMediaUrl("http://backend:4000/uploads/avatar.png")).toBe("https://wmhealthistanbul.com/uploads/avatar.png");
  });

  it("NEXT_PUBLIC_INTERNAL_MEDIA_URL tanımsızken (Docker dışı) zaten genel URL'i OLDUĞU GİBİ bırakır", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://wmhealthistanbul.com/api/v1");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "");
    const { toPublicMediaUrl } = await import("@/lib/env");

    expect(toPublicMediaUrl("https://wmhealthistanbul.com/uploads/avatar.png")).toBe("https://wmhealthistanbul.com/uploads/avatar.png");
  });

  it("savunma derinliği — dönüşten SONRA hâlâ bir loopback host kalırsa (PUBLIC_URL henüz yanlış yapılandırılmışsa) SITE_URL ile mutlaklaştırır", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api/v1");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://wmhealthistanbul.com");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "");
    const { toPublicMediaUrl } = await import("@/lib/env");

    expect(toPublicMediaUrl("http://siteadi.localhost:4000/uploads/x.png")).toBe("https://wmhealthistanbul.com/uploads/x.png");
  });

  it("gerçek prod domain'ine (S3/CDN dahil) DOKUNMAZ", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000/api/v1");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "http://backend:4000");
    const { toPublicMediaUrl } = await import("@/lib/env");

    expect(toPublicMediaUrl("https://cdn.example.com/uploads/x.png")).toBe("https://cdn.example.com/uploads/x.png");
  });
});
