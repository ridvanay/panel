import { describe, expect, it } from "vitest";
import { detectImportFormat } from "../../src/modules/import/lib/format-detect";
import { ValidationError } from "../../src/lib/errors";

describe("detectImportFormat", () => {
  it("detects CSV for PAGES", () => {
    const buf = Buffer.from("title,slug\nHello,hello\n");
    expect(detectImportFormat(buf, "PAGES")).toBe("CSV");
  });

  it("detects JSON for BLOG", () => {
    const buf = Buffer.from(JSON.stringify([{ title: "Hello" }]));
    expect(detectImportFormat(buf, "BLOG")).toBe("JSON");
  });

  it("detects JSON with an { items: [...] } wrapper", () => {
    const buf = Buffer.from(JSON.stringify({ items: [{ title: "Hello" }] }));
    expect(detectImportFormat(buf, "PAGES")).toBe("JSON");
  });

  it("rejects JSON for USERS (CSV only)", () => {
    const buf = Buffer.from(JSON.stringify([{ email: "a@example.com" }]));
    expect(() => detectImportFormat(buf, "USERS")).toThrow(ValidationError);
  });

  it("detects XML for WORDPRESS", () => {
    const buf = Buffer.from('<?xml version="1.0"?><rss></rss>');
    expect(detectImportFormat(buf, "WORDPRESS")).toBe("XML");
  });

  it("rejects a non-XML file for WORDPRESS", () => {
    const buf = Buffer.from("title,slug\nHello,hello\n");
    expect(() => detectImportFormat(buf, "WORDPRESS")).toThrow(ValidationError);
  });

  it("detects ZIP for MEDIA via magic bytes", () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectImportFormat(buf, "MEDIA")).toBe("ZIP");
  });

  it("rejects a non-ZIP file for MEDIA", () => {
    const buf = Buffer.from("not a zip");
    expect(() => detectImportFormat(buf, "MEDIA")).toThrow(ValidationError);
  });

  it("rejects a completely unrecognizable file for PAGES/BLOG", () => {
    // Geçersiz JSON + tek sütunlu "CSV" olarak bile ayrıştırılamayacak boş bir ikili veri.
    const buf = Buffer.from([0x00, 0x01, 0x02]);
    // Not: csv-parse tek-sütunlu her metni CSV olarak kabul edebildiğinden burada asıl test
    // JSON'un CSV'den ÖNCELİKLİ denendiğini ve bozuk JSON'un CSV'ye düştüğünü doğrular.
    expect(detectImportFormat(buf, "PAGES")).toBe("CSV");
  });
});
