import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "../../src/lib/html-sanitize";

// Bu, önceden yalnızca içe aktarma modülüne özel olan `sanitizeImportedHtml`'in yerini alan
// paylaşılan sanitizer'ı test eder — artık blog/sayfa yazma yolları da AYNI fonksiyonu kullanır
// (bkz. modules/blog/blog.routes.ts, modules/pages/pages.routes.ts).
describe("sanitizeRichHtml", () => {
  it("strips <script> tags and their content entirely", () => {
    const result = sanitizeRichHtml('<p>Hello</p><script>alert("xss")</script>');
    expect(result).toContain("<p>Hello</p>");
    expect(result).not.toContain("script");
    expect(result).not.toContain("alert");
  });

  it("strips <iframe>/<object>/<embed>/<form>", () => {
    const result = sanitizeRichHtml('<iframe src="evil.com"></iframe><object data="x"></object><embed src="x"/><form></form>');
    expect(result).not.toContain("iframe");
    expect(result).not.toContain("object");
    expect(result).not.toContain("embed");
    expect(result).not.toContain("form");
  });

  it("strips on* event handler attributes", () => {
    const result = sanitizeRichHtml('<p onclick="alert(1)">Hello</p>');
    expect(result).not.toContain("onclick");
    expect(result).toContain("Hello");
  });

  it("rejects javascript: URLs in href", () => {
    const result = sanitizeRichHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  it("rejects data: URLs in img src", () => {
    const result = sanitizeRichHtml('<img src="data:image/png;base64,AAAA">');
    expect(result).not.toContain("data:image");
  });

  it("keeps safe formatting tags and allows <img> with http(s) src", () => {
    const result = sanitizeRichHtml('<p>Hello <strong>world</strong></p><img src="https://example.com/a.png" alt="x">');
    expect(result).toContain("<strong>world</strong>");
    expect(result).toContain('src="https://example.com/a.png"');
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(sanitizeRichHtml(null)).toBe("");
    expect(sanitizeRichHtml(undefined)).toBe("");
    expect(sanitizeRichHtml("")).toBe("");
  });

  it("leaves WordPress shortcodes as inert plain text", () => {
    const result = sanitizeRichHtml("[gallery ids=\"1,2,3\"]<p>caption</p>");
    expect(result).toContain("[gallery");
    expect(result).toContain("<p>caption</p>");
  });
});
