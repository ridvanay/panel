import { describe, expect, it } from "vitest";
import { buildSiteIconsMetadata, DEFAULT_FAVICON_PATH, withIconVersion } from "@/lib/site-settings/site-icons";

describe("buildSiteIconsMetadata", () => {
  it("ayar boşken varsayılan /favicon.ico kullanılır, apple-touch-icon üretilmez", () => {
    expect(buildSiteIconsMetadata({ faviconUrl: null, appleTouchIconUrl: null })).toEqual({
      icon: [{ url: DEFAULT_FAVICON_PATH, sizes: "any" }],
    });
    expect(buildSiteIconsMetadata({})).toEqual({ icon: [{ url: DEFAULT_FAVICON_PATH, sizes: "any" }] });
    expect(buildSiteIconsMetadata({ faviconUrl: "   " })).toEqual({ icon: [{ url: DEFAULT_FAVICON_PATH, sizes: "any" }] });
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
