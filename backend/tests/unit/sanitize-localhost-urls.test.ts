import { describe, expect, it } from "vitest";
import { stripLoopbackUrlPrefixes } from "../../src/lib/sanitize-localhost-urls";

/**
 * 2026-09-19 (kullanıcı talebi) — `plugins/sanitize-localhost-media-urls.ts` (yanıt gövdesi
 * savunma katmanı) VE `scripts/fix-hardcoded-localhost-media-urls.ts` (tek seferlik DB düzeltmesi)
 * TARAFINDAN paylaşılan çekirdek fonksiyon. `config/env.ts::isLoopbackHostname` İLE AYNI üç host
 * sınıfını (çıplak `localhost`/`127.0.0.1`/RFC 6761 `*.localhost`) hedefler.
 */
describe("lib/sanitize-localhost-urls — stripLoopbackUrlPrefixes", () => {
  it("çıplak localhost + port içeren mutlak URL'yi kök-göreceli yola çevirir", () => {
    expect(stripLoopbackUrlPrefixes('{"url":"http://localhost:4000/uploads/x.png"}')).toBe('{"url":"/uploads/x.png"}');
  });

  it("127.0.0.1 + port içeren mutlak URL'yi kök-göreceli yola çevirir", () => {
    expect(stripLoopbackUrlPrefixes('{"url":"http://127.0.0.1:4000/uploads/x.png"}')).toBe('{"url":"/uploads/x.png"}');
  });

  it("RFC 6761 *.localhost alt-alan-adını (repo'nun kendi dev placeholder'ı, ör. siteadi.localhost) çevirir", () => {
    expect(stripLoopbackUrlPrefixes('{"value":"http://siteadi.localhost:4000/uploads/bg.png"}')).toBe('{"value":"/uploads/bg.png"}');
  });

  it("https + portsuz (varsayılan 443) mutlak URL'yi de çevirir", () => {
    expect(stripLoopbackUrlPrefixes('{"url":"https://localhost/uploads/x.png"}')).toBe('{"url":"/uploads/x.png"}');
  });

  it("aynı metindeki BİRDEN FAZLA eşleşmeyi TÜMÜNÜ çevirir (global)", () => {
    const input = '{"a":"http://localhost:4000/1.png","b":"http://siteadi.localhost:4000/2.png"}';
    expect(stripLoopbackUrlPrefixes(input)).toBe('{"a":"/1.png","b":"/2.png"}');
  });

  it("gerçek prod domain'ine DOKUNMAZ", () => {
    const input = '{"url":"https://wmhealthistanbul.com/uploads/x.png"}';
    expect(stripLoopbackUrlPrefixes(input)).toBe(input);
  });

  it("localhost/127.0.0.1 İÇERMEYEN düz metne DOKUNMAZ (hızlı substring kısayolu doğrulanır)", () => {
    const input = '{"title":"Ana Sayfa","ogImageUrl":"https://wmhealthistanbul.com/og.png"}';
    expect(stripLoopbackUrlPrefixes(input)).toBe(input);
  });

  it("yalnızca 'localhost' KELİMESİNİ içeren ama URL ÖNEKİ OLMAYAN metne DOKUNMAZ", () => {
    const input = '{"note":"lütfen localhost üzerinde test edin"}';
    expect(stripLoopbackUrlPrefixes(input)).toBe(input);
  });
});
