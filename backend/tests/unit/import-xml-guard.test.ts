import { describe, expect, it } from "vitest";
import { assertNoDoctypeOrEntity, looksLikeXml } from "../../src/modules/import/lib/xml-guard";

describe("assertNoDoctypeOrEntity", () => {
  it("rejects a DOCTYPE declaration", () => {
    const xml = Buffer.from('<?xml version="1.0"?><!DOCTYPE foo><foo/>');
    expect(() => assertNoDoctypeOrEntity(xml)).toThrow(/DTD\/varlık/);
  });

  it("rejects an ENTITY declaration (billion laughs / XXE style payload)", () => {
    const xml = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>'
    );
    expect(() => assertNoDoctypeOrEntity(xml)).toThrow(/DTD\/varlık/);
  });

  it("accepts a clean WXR-style document", () => {
    const xml = Buffer.from('<?xml version="1.0"?><rss><channel><item><title>Hello</title></item></channel></rss>');
    expect(() => assertNoDoctypeOrEntity(xml)).not.toThrow();
  });

  it("only scans the first 64 KB (DOCTYPE appearing after is not caught by this layer)", () => {
    const padding = "x".repeat(70 * 1024);
    const xml = Buffer.from(`<root>${padding}<!DOCTYPE foo></root>`);
    // Bilinçli davranış — defense-in-depth katman 2; katman 1 (saxes yapısal olarak DTD
    // çözümlemez) yine de bu durumu güvenli kılar.
    expect(() => assertNoDoctypeOrEntity(xml)).not.toThrow();
  });
});

describe("looksLikeXml", () => {
  it("detects a plain XML prolog", () => {
    expect(looksLikeXml(Buffer.from('<?xml version="1.0"?><rss></rss>'))).toBe(true);
  });

  it("detects XML after a BOM", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<rss></rss>")]);
    expect(looksLikeXml(withBom)).toBe(true);
  });

  it("returns false for CSV content", () => {
    expect(looksLikeXml(Buffer.from("title,slug\nHello,hello\n"))).toBe(false);
  });

  it("returns false for JSON content", () => {
    expect(looksLikeXml(Buffer.from('[{"title":"Hello"}]'))).toBe(false);
  });
});
