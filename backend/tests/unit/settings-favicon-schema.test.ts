import { describe, expect, it } from "vitest";
import { UpdateSiteSettingsRequestSchema } from "../../src/modules/settings/settings.schemas";

/** Site simgesi (favicon) / Apple touch icon — yalnızca PNG, güvenli URL, `null` = varsayılan simge. */
describe("UpdateSiteSettingsRequestSchema — faviconUrl / appleTouchIconUrl", () => {
  const parse = (body: Record<string, unknown>) => UpdateSiteSettingsRequestSchema.safeParse(body);

  it.each([
    ["mutlak https PNG", "https://cdn.example.com/uploads/icon.png"],
    ["yerel medya PNG", "http://localhost:4000/uploads/2026/09/abc123.png"],
    ["site içi yol", "/uploads/icon.PNG"],
    ["sorgu parametreli PNG", "https://cdn.example.com/icon.png?v=2"],
  ])("PNG kabul edilir: %s", (_label, url) => {
    expect(parse({ faviconUrl: url }).success).toBe(true);
    expect(parse({ appleTouchIconUrl: url }).success).toBe(true);
  });

  it("null (varsayılan simgeye dön) ve alanın hiç gönderilmemesi kabul edilir", () => {
    expect(parse({ faviconUrl: null, appleTouchIconUrl: null }).success).toBe(true);
    expect(parse({ siteName: "WM Health" }).success).toBe(true);
  });

  it.each([
    ["SVG (bilinçli olarak desteklenmiyor)", "https://cdn.example.com/icon.svg"],
    ["JPEG", "https://cdn.example.com/icon.jpg"],
    ["ICO", "https://cdn.example.com/favicon.ico"],
    ["uzantısız", "https://cdn.example.com/icon"],
    ["javascript: şeması", "javascript:alert(1)//.png"],
    ["data: URI", "data:image/png;base64,AAAA.png"],
  ])("reddedilir: %s", (_label, url) => {
    expect(parse({ faviconUrl: url }).success).toBe(false);
    expect(parse({ appleTouchIconUrl: url }).success).toBe(false);
  });
});
