import { describe, expect, it } from "vitest";
import { extractGoogleMapEmbedUrlFromInput, getMapEmbedUrl } from "@/lib/page-builder/map-embed";
import type { GoogleMapBlock } from "@/lib/page-builder/types";

/**
 * qa-agent — `extractGoogleMapEmbedUrlFromInput`/`getMapEmbedUrl` (`map-embed.ts` ~L79-89/L99-114)
 * için önceden hiç test dosyası yoktu. Backend `pages-google-map-corporate-blocks-schema.test.ts`
 * ile AYNI senaryo matrisi — bu iki dosya karakter karakter senkron tutulan tek bir davranışı
 * (iframe snippet → çıplak URL çıkarımı) doğrular, TEK kaynak `GOOGLE_MAP_EMBED_URL_RE`dir.
 */

function baseData(patch: Partial<GoogleMapBlock["data"]> = {}): GoogleMapBlock["data"] {
  return { ...patch };
}

describe("extractGoogleMapEmbedUrlFromInput", () => {
  it("tam Google 'Haritayı yerleştir' iframe snippet'inden çıplak src URL'i çıkarır", () => {
    const iframeSnippet =
      '<iframe src="https://www.google.com/maps/embed?pb=!1m18!2m0" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';
    expect(extractGoogleMapEmbedUrlFromInput(iframeSnippet)).toBe("https://www.google.com/maps/embed?pb=!1m18!2m0");
  });

  it("tek tırnaklı src='...' varyantını da doğru çıkarır", () => {
    const iframeSnippet = "<iframe src='https://www.google.com/maps/embed?pb=!1m18!2m0' width=\"600\" height=\"450\"></iframe>";
    expect(extractGoogleMapEmbedUrlFromInput(iframeSnippet)).toBe("https://www.google.com/maps/embed?pb=!1m18!2m0");
  });

  it("&amp; ile kaçırılmış çoklu query param'ı gerçek & karakterine çözer", () => {
    const iframeSnippet =
      '<iframe src="https://www.google.com/maps/embed/v1/place?key=x&amp;q=Istanbul&amp;zoom=12" width="600" height="450"></iframe>';
    expect(extractGoogleMapEmbedUrlFromInput(iframeSnippet)).toBe(
      "https://www.google.com/maps/embed/v1/place?key=x&q=Istanbul&zoom=12"
    );
  });

  it("beyaz liste DIŞI bir URL'i sarmalayan iframe'den de aynen çıkarır — DOĞRULAMA yapmaz, yalnızca çıkarım yapar", () => {
    const iframeSnippet = '<iframe src="https://evil.com/maps/embed?x=1"></iframe>';
    expect(extractGoogleMapEmbedUrlFromInput(iframeSnippet)).toBe("https://evil.com/maps/embed?x=1");
  });

  it("src niteliği olmayan bir <iframe> için orijinal (trim edilmiş) metni aynen döner", () => {
    const iframeSnippet = '<iframe width="600" height="450" allowfullscreen=""></iframe>';
    expect(extractGoogleMapEmbedUrlFromInput(iframeSnippet)).toBe(iframeSnippet);
  });

  it("yalnızca '<iframe' alt dizisini içeren ama geçerli src= taşımayan bozuk metni aynen döner", () => {
    const brokenSnippet = "<iframe this is not real html no src attribute at all";
    expect(extractGoogleMapEmbedUrlFromInput(brokenSnippet)).toBe(brokenSnippet);
  });

  it("regresyon: iframe sarmalayıcısı OLMADAN çıplak URL değişmeden (yalnızca trim edilerek) döner", () => {
    expect(extractGoogleMapEmbedUrlFromInput("  https://www.google.com/maps/embed?pb=!1m18!2m0  ")).toBe(
      "https://www.google.com/maps/embed?pb=!1m18!2m0"
    );
  });
});

describe("getMapEmbedUrl — extractGoogleMapEmbedUrlFromInput ile birlikte uçtan uca davranış", () => {
  it("iframe snippet'inden çıkarılıp beyaz listeyi geçen bir embedUrl önizleme URL'i olarak aynen kullanılır", () => {
    const iframeSnippet =
      '<iframe src="https://www.google.com/maps/embed?pb=!1m18!2m0" width="600" height="450"></iframe>';
    const extracted = extractGoogleMapEmbedUrlFromInput(iframeSnippet);
    const url = getMapEmbedUrl(baseData({ embedUrl: extracted }));
    expect(url).toBe("https://www.google.com/maps/embed?pb=!1m18!2m0");
  });

  it("iframe snippet'inden çıkarılıp beyaz listeyi GEÇEMEYEN (evil.com) bir embedUrl için `address` de yoksa null döner", () => {
    const iframeSnippet = '<iframe src="https://evil.com/maps/embed?x=1"></iframe>';
    const extracted = extractGoogleMapEmbedUrlFromInput(iframeSnippet);
    const url = getMapEmbedUrl(baseData({ embedUrl: extracted }));
    expect(url).toBeNull();
  });

  it("beyaz listeyi GEÇEMEYEN embedUrl + geçerli `address` birlikte gönderilirse adres tabanlı şablona düşer (embedUrl sessizce yok sayılır)", () => {
    const iframeSnippet = '<iframe src="https://evil.com/maps/embed?x=1"></iframe>';
    const extracted = extractGoogleMapEmbedUrlFromInput(iframeSnippet);
    const url = getMapEmbedUrl(baseData({ embedUrl: extracted, address: "İstanbul" }), "tr");
    expect(url).toContain("https://maps.google.com/maps?q=");
    expect(url).not.toContain("evil.com");
  });

  it("adres modunda güvenilir kırmızı pin için 'classic embed' şablonunu (maps.google.com) kullanır", () => {
    const url = getMapEmbedUrl(baseData({ address: "İstanbul", zoom: 12 }), "tr");
    expect(url).toBe(
      `https://maps.google.com/maps?q=${encodeURIComponent("İstanbul")}&t=&z=12&ie=UTF8&iwloc=&hl=tr&output=embed`
    );
  });
});
