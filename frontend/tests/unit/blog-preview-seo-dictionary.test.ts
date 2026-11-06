import { describe, expect, it } from "vitest";
import { buildIndex, buildSection, SITEMAP_SECTIONS, type SitemapData } from "@/lib/sitemap/build";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { renderSitemapIndex, renderUrlset } from "@/lib/sitemap/xml";
import { CRM_ALWAYS_EXCLUDED_PATHS, isCrmExcludedPath } from "@/lib/crm/excluded-paths";
import { BLOG_DICTIONARIES } from "@/lib/i18n/use-blog-strings";
import { blogStrings as en } from "@/lib/i18n/site-dictionaries/en/blog";
import { absolutePreviewUrl, localizedPreviewPath, previewPath } from "@/lib/blog/preview";
import { LOCALES } from "./blog-z1-fixtures";

const LANGS = ["tr", "en", "de", "ar", "ru", "es", "fr", "ro", "sr-latn"] as const;
const NEW_KEYS = ["previewBannerPending", "previewBannerPublish", "reviewPendingBy", "previewOpen", "previewOpenError", "previewBannerLive"] as const;

const DATA: SitemapData = {
  siteUrl: "https://wm.example",
  locales: LOCALES,
  homePageId: null,
  pages: [],
  doctors: [],
  specialties: [],
  posts: [
    {
      slug: "knee-pain-guide",
      title: "Knee pain guide",
      excerpt: "What to know about knee pain.",
      publishedAt: "2026-10-01T00:00:00.000Z",
      lastReviewedAt: null,
      updatedAt: "2026-10-25T00:00:00.000Z",
      localizations: [{ locale: "en", slug: "knee-pain-guide", translated: true }],
    },
  ],
  products: [],
  portfolio: [],
};

describe("Önizleme — sitemap ve llms.txt", () => {
  it("hiçbir sitemap bölümünde, dizinde ve llms çıktısında /blog/preview geçmez", () => {
    for (const section of SITEMAP_SECTIONS) {
      expect(renderUrlset(buildSection(section, DATA)), section).not.toContain("/blog/preview");
    }
    expect(renderSitemapIndex(buildIndex(DATA))).not.toContain("/blog/preview");
    expect(buildLlmsTxt({ ...DATA, siteName: "WM Health" })).not.toContain("/blog/preview");
    expect(buildLlmsTxt({ ...DATA, siteName: "WM Health" }, { full: true })).not.toContain("/blog/preview");
  });
});

describe("Önizleme — CRM hariç yol", () => {
  it("/blog/preview her dil önekiyle izlenmez; yayındaki /blog yazısı izlenir", () => {
    expect(CRM_ALWAYS_EXCLUDED_PATHS).toContain("/blog/preview");
    expect(isCrmExcludedPath("/blog/preview/p1?t=s_x")).toBe(true);
    expect(isCrmExcludedPath("/en/blog/preview/p1")).toBe(true);
    expect(isCrmExcludedPath("/sr-latn/blog/preview/p1")).toBe(true);
    expect(isCrmExcludedPath("/en/blog/knee-pain-guide")).toBe(false);
    expect(isCrmExcludedPath("/blog")).toBe(false);
  });
});

describe("Önizleme — yol yardımcıları", () => {
  it("belirteç kodlanır; varsayılan dil önek almaz, diğerleri alır; mutlak adres site kökünden", () => {
    expect(previewPath("p 1", "s_a+b")).toBe("/blog/preview/p%201#t=s_a%2Bb");
    expect(localizedPreviewPath("p1", "t", "tr", "tr")).toBe("/blog/preview/p1#t=t");
    expect(localizedPreviewPath("p1", "t", "en", "tr")).toBe("/en/blog/preview/p1#t=t");
    expect(absolutePreviewUrl("p1", "s_x", "tr")).toMatch(/^https?:\/\/[^/]+\/blog\/preview\/p1#t=s_x$/);
  });
});

describe("Önizleme — sözlük paritesi (9 dil)", () => {
  it("yeni anahtarlar 9 dilde dolu; {name} yer tutucusu korunur; İngilizce kopyası yok", () => {
    for (const lang of LANGS) {
      const dict = BLOG_DICTIONARIES[lang]! as Record<string, string>;
      for (const key of NEW_KEYS) {
        expect(dict[key]?.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
        if (lang !== "en") expect(dict[key], `${lang}.${key}`).not.toBe((en as Record<string, string>)[key]);
      }
      expect(dict.reviewPendingBy, lang).toContain("{name}");
    }
    expect(en.previewBannerPending).toBe("Preview — awaiting physician approval");
    expect(en.previewBannerPublish).toBe("Preview — awaiting publication");
    expect(en.reviewPendingBy).toBe("Review pending: {name}");
  });
});

describe("Önizleme — Referrer-Policy", () => {
  it("önizleme yolları (önek-siz ve dil önekli) HTTP başlığıyla no-referrer + noindex gönderir", async () => {
    const { blogPreviewHeaderRules } = await import("@/lib/seo/preview-headers");
    const rules = blogPreviewHeaderRules();
    expect(rules.map((r) => r.source)).toEqual(["/blog/preview/:postId", "/:lang/blog/preview/:postId"]);
    for (const rule of rules) {
      expect(rule.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
      expect(rule.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
    }
  });

  it("next.config.ts bu kuralları headers()'a bağlar", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    expect(readFileSync(resolve(__dirname, "../../next.config.ts"), "utf8")).toContain("...blogPreviewHeaderRules()");
  });
});
