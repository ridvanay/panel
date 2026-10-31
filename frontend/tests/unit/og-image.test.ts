import { describe, expect, it } from "vitest";
import { ogCompatibleImageUrl } from "@/lib/og-image";
import { buildContentMetadata } from "@/lib/seo";

/** Paket AE-ek — og:image için WebP yerine sunucunun ürettiği .jpg uyumluluk kopyası. */
const UUID = "3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f";

describe("ogCompatibleImageUrl", () => {
  it("/uploads/<uuid>.webp adresini .jpg'ye çevirir (göreli ve mutlak)", () => {
    expect(ogCompatibleImageUrl(`/uploads/${UUID}.webp`)).toBe(`/uploads/${UUID}.jpg`);
    expect(ogCompatibleImageUrl(`https://wmhealth.example/uploads/${UUID}.webp`)).toBe(`https://wmhealth.example/uploads/${UUID}.jpg`);
    expect(ogCompatibleImageUrl(`/uploads/${UUID.toUpperCase()}.WEBP`.replace(".WEBP", ".webp"))).toBe(`/uploads/${UUID.toUpperCase()}.jpg`);
    expect(ogCompatibleImageUrl(`/uploads/${UUID}.webp?v=2`)).toBe(`/uploads/${UUID}.jpg?v=2`);
  });

  it("diğer URL'lere dokunmaz", () => {
    for (const url of [
      `/uploads/${UUID}.png`,
      `/uploads/${UUID}.jpg`,
      "/uploads/logo.webp",
      `/media/${UUID}.webp`,
      `https://cdn.example/images/${UUID}.webp`,
      `/uploads/${UUID}.webp.bak`,
      "https://img.youtube.com/vi/abc/hqdefault.jpg",
    ]) {
      expect(ogCompatibleImageUrl(url)).toBe(url);
    }
  });

  it("boş değerleri aynen döndürür", () => {
    expect(ogCompatibleImageUrl(null)).toBeNull();
    expect(ogCompatibleImageUrl(undefined)).toBeUndefined();
    expect(ogCompatibleImageUrl("")).toBe("");
  });
});

describe("buildContentMetadata — görsel adresi", () => {
  const fields = { title: "T", description: "D", ogTitle: null, ogImageUrl: `/uploads/${UUID}.webp`, canonicalUrl: null, noIndex: false };
  const options = { fallbackCanonicalUrl: "https://wmhealth.example/x", siteName: "WM" };

  it("openGraph ve twitter görselleri .jpg kopyasını kullanır", () => {
    const md = buildContentMetadata(fields, options);
    expect(md.openGraph?.images).toEqual([`/uploads/${UUID}.jpg`]);
    expect(md.twitter?.images).toEqual([`/uploads/${UUID}.jpg`]);
  });

  it("fallbackImageUrl de aynı şekilde çevrilir; WebP olmayan görsel değişmez", () => {
    const md = buildContentMetadata({ ...fields, ogImageUrl: null }, { ...options, fallbackImageUrl: `/uploads/${UUID}.webp` });
    expect(md.openGraph?.images).toEqual([`/uploads/${UUID}.jpg`]);
    const png = buildContentMetadata({ ...fields, ogImageUrl: "https://x.example/a.png" }, options);
    expect(png.openGraph?.images).toEqual(["https://x.example/a.png"]);
  });
});
