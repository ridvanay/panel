import { describe, expect, it } from "vitest";
import { renderEmailBlocksToHtml, type EmailRenderContext } from "../../src/lib/email-renderer";

const CONTEXT: EmailRenderContext = {
  siteName: "Örnek Site",
  siteUrl: "https://example.com",
  logoUrl: "https://example.com/logo.png",
  legalPages: [{ title: "Gizlilik Politikası", url: "https://example.com/tr/gizlilik" }],
};

const STYLE = { align: "left" as const, backgroundColor: null, textColor: null, paddingY: "md" as const, paddingX: "md" as const };

describe("renderEmailBlocksToHtml", () => {
  it("renders a heading block, HTML-escaping user text (defense against injection via a plain-text field)", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "heading", style: STYLE, data: { text: "<img src=x onerror=alert(1)>", level: 1 } }],
      CONTEXT
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });

  it("leaves {{key}} variable placeholders untouched (variable rendering happens in a later pass)", () => {
    const html = renderEmailBlocksToHtml([{ id: "1", type: "heading", style: STYLE, data: { text: "Merhaba {{user_name}}", level: 2 } }], CONTEXT);
    expect(html).toContain("{{user_name}}");
  });

  it("skips the logo-header block entirely when useSiteLogo=true but no site logo is configured", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "logo-header", style: STYLE, data: { useSiteLogo: true, logoUrl: null, height: 48 } }],
      { ...CONTEXT, logoUrl: null }
    );
    expect(html).not.toContain("<img");
  });

  it("renders the logo-header block when useSiteLogo=false and a block-level logoUrl is provided", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "logo-header", style: STYLE, data: { useSiteLogo: false, logoUrl: "https://cdn.example.com/x.png", height: 40 } }],
      { ...CONTEXT, logoUrl: null }
    );
    expect(html).toContain("https://cdn.example.com/x.png");
  });

  // Güvenlik düzeltmesi (security-agent denetimi) — `EmailLogoHeaderDataSchema.logoUrl` şema
  // seviyesinde bir şema kısıtı taşımadığı için (serbest string), savunma derinliği bu
  // fonksiyonun (renderImage ile AYNI) http(s) kontrolüne dayanır.
  it("skips a block-level logoUrl that is not http(s) (defense in depth against javascript:/data: URIs)", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "logo-header", style: STYLE, data: { useSiteLogo: false, logoUrl: "javascript:alert(1)", height: 40 } }],
      { ...CONTEXT, logoUrl: null }
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("re-sanitizes a text block's html (defense in depth) — script tags never reach the output", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "text", style: STYLE, data: { html: '<p>hi</p><script>alert(1)</script>' } }],
      CONTEXT
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("<p>hi</p>");
  });

  it("strips style/class/id attributes from text block rich text (narrower allow-list than sanitizeRichHtml)", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "text", style: STYLE, data: { html: '<p style="color:red" class="x" id="y">hi</p>' } }],
      CONTEXT
    );
    // Bloğun KONTEYNERİ (sunucu tarafından üretilen) meşru `style=` öznitelikleri taşır — burada
    // asıl doğrulanan, KULLANICININ `<p>` etiketine yazdığı style/class/id'nin HAYATTA KALMAMASI.
    expect(html).not.toContain('style="color:red"');
    expect(html).not.toContain('class="x"');
    expect(html).not.toContain('id="y"');
    expect(html).toContain("hi");
  });

  it("renders a button with a valid http(s) href", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "button", style: STYLE, data: { label: "Tıkla", href: "https://example.com/x", backgroundColor: null, textColor: null, radius: "sm" } }],
      CONTEXT
    );
    expect(html).toContain('href="https://example.com/x"');
  });

  it("falls back to href='#' for an invalid/dangerous button href (javascript:) instead of rendering it", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "button", style: STYLE, data: { label: "Tıkla", href: "javascript:alert(1)", backgroundColor: null, textColor: null, radius: "sm" } }],
      CONTEXT
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("allows a button href that is entirely a single variable placeholder", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "button", style: STYLE, data: { label: "Kabul Et", href: "{{accept_url}}", backgroundColor: null, textColor: null, radius: "none" } }],
      CONTEXT
    );
    expect(html).toContain('href="{{accept_url}}"');
  });

  it("skips the image block for a non-http(s) url (data:/javascript: schemes rejected)", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "image", style: STYLE, data: { mediaId: null, url: "data:image/png;base64,AAAA", alt: "x", width: null } }],
      CONTEXT
    );
    expect(html).not.toContain("data:image");
  });

  it("always appends the mandatory KVKK/compliance footer, independent of any user footer block", () => {
    const html = renderEmailBlocksToHtml([], CONTEXT);
    expect(html).toContain("Örnek Site");
    expect(html).toContain("Gizlilik Politikası");
    expect(html).toContain("https://example.com/tr/gizlilik");
  });

  it("renders only the site name in the compliance footer when there are no legal pages", () => {
    const html = renderEmailBlocksToHtml([], { ...CONTEXT, legalPages: [] });
    expect(html).toContain("Örnek Site");
  });

  it("produces inline styles derived only from validated tokens (no raw CSS from user input)", () => {
    const html = renderEmailBlocksToHtml(
      [{ id: "1", type: "heading", style: { align: "center", backgroundColor: "#ff0000", textColor: "#00ff00", paddingY: "lg", paddingX: "sm" }, data: { text: "x", level: 2 } }],
      CONTEXT
    );
    expect(html).toContain("text-align:center");
    expect(html).toContain("background-color:#ff0000");
    expect(html).toContain("color:#00ff00");
    expect(html).toContain("padding:32px 8px");
  });

  it("ignores unknown block types without throwing", () => {
    expect(() => renderEmailBlocksToHtml([{ id: "1", type: "not-a-real-type", style: STYLE, data: {} }], CONTEXT)).not.toThrow();
  });
});
