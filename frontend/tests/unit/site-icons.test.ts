import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSiteIconsMetadata, DEFAULT_APPLE_TOUCH_ICON_PATH, DEFAULT_FAVICON_PATH, withIconVersion } from "@/lib/site-settings/site-icons";

describe("buildSiteIconsMetadata", () => {
  it("ayar boşken varsayılan WM simgeleri (/favicon.ico + /apple-touch-icon.png) kullanılır", () => {
    const expected = {
      icon: [{ url: withIconVersion(DEFAULT_FAVICON_PATH), sizes: "any" }],
      apple: [{ url: withIconVersion(DEFAULT_APPLE_TOUCH_ICON_PATH), type: "image/png" }],
    };
    expect(buildSiteIconsMetadata({ faviconUrl: null, appleTouchIconUrl: null })).toEqual(expected);
    expect(buildSiteIconsMetadata({})).toEqual(expected);
    expect(buildSiteIconsMetadata({ faviconUrl: "   " })).toEqual(expected);
  });

  it("özel PNG simge sürüm parametresiyle kullanılır; apple-touch-icon seçilmemişse favicon kullanılır", () => {
    const icons = buildSiteIconsMetadata({ faviconUrl: "/uploads/icon.png" }) as { icon: { url: string; type: string }[]; apple: { url: string }[] };
    expect(icons.icon).toHaveLength(1);
    expect(icons.icon[0]!.url).toMatch(/^\/uploads\/icon\.png\?v=[0-9a-z]+$/);
    expect(icons.icon[0]!.type).toBe("image/png");
    expect(icons.apple[0]!.url).toBe(icons.icon[0]!.url);
  });

  it("apple-touch-icon ayrıca seçilmişse o kullanılır", () => {
    const icons = buildSiteIconsMetadata({ faviconUrl: "/uploads/a.png", appleTouchIconUrl: "/uploads/apple.png" }) as {
      apple: { url: string }[];
    };
    expect(icons.apple[0]!.url).toMatch(/^\/uploads\/apple\.png\?v=/);
  });
});

describe("withIconVersion — önbellek kırma", () => {
  it("aynı URL için sabit, farklı URL için farklı sürüm üretir", () => {
    expect(withIconVersion("/uploads/a.png")).toBe(withIconVersion("/uploads/a.png"));
    expect(withIconVersion("/uploads/a.png")).not.toBe(withIconVersion("/uploads/b.png"));
  });

  it("URL'de zaten sorgu parametresi varsa & ile ekler", () => {
    expect(withIconVersion("https://cdn.example.com/a.png?x=1")).toMatch(/\?x=1&v=[0-9a-z]+$/);
  });
});

describe("Paket O — tüm route gruplarında aynı site simgesi", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../../src/app", p), "utf8");

  it("simge YALNIZCA kök layout'ta tanımlı; admin, giriş, site ve doktor portalı layout'ları icons tanımlamaz", () => {
    expect(src("layout.tsx")).toContain("icons: buildSiteIconsMetadata(settings)");
    for (const layout of ["admin/layout.tsx", "(auth)/layout.tsx", "[lang]/(site)/layout.tsx", "[lang]/(doctor)/layout.tsx"]) {
      expect(src(layout), layout).not.toMatch(/icons\s*:/);
    }
  });

  it("public/favicon.ico Next.js'in varsayılan simgesi değil (WM simgesi, PNG gömülü ICO); apple-touch-icon 180×180 PNG", () => {
    const ico = readFileSync(resolve(__dirname, "../../public/favicon.ico"));
    expect(ico.length).not.toBe(25931);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(3);
    const firstImageOffset = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(firstImageOffset, firstImageOffset + 4).toString("latin1")).toBe(`${String.fromCharCode(0x89)}PNG`);
    const apple = readFileSync(resolve(__dirname, "../../public/apple-touch-icon.png"));
    expect(apple.readUInt32BE(16)).toBe(180);
    expect(apple.readUInt32BE(20)).toBe(180);
  });
});
