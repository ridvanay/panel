import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { siteFontFamilyFor, siteScriptFontClass, SITE_FONT_FAMILY } from "@/lib/site-settings/site-fonts";
import { buildSiteScopeStyle } from "@/components/site/site-scope";
import type { PublicSiteAppearance } from "@/lib/api/types";

const params = { lang: "ar" as string | undefined };
vi.mock("next/navigation", () => ({ useParams: () => params }));

import { HtmlLangSync } from "@/components/html-lang-sync";

/**
 * Paket L (2026-10-23) — Arapça `dir="rtl"`, diğer diller `ltr`; Kiril/Arapça font yüzleri yalnızca
 * ilgili dilde ana fontun önüne eklenir.
 */
describe("localeDirection", () => {
  it("ar (ve bölgeli ar-sa) rtl, diğer site dilleri ltr", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("ar-sa")).toBe("rtl");
    for (const code of ["tr", "en", "es", "de", "ru", "", undefined, null]) expect(localeDirection(code)).toBe("ltr");
  });
});

describe("HtmlLangSync", () => {
  afterEach(() => {
    document.documentElement.lang = "";
    document.documentElement.dir = "";
  });

  it("dil değişince <html lang/dir> senkron olur (ar → rtl, ru → ltr)", () => {
    params.lang = "ar";
    const { rerender } = render(<HtmlLangSync />);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");

    params.lang = "ru";
    rerender(<HtmlLangSync key="ru" />);
    expect(document.documentElement.lang).toBe("ru");
    expect(document.documentElement.dir).toBe("ltr");
  });
});

describe("site fontları — dile göre yazı sistemi", () => {
  it("ru'da Kiril yüzü, ar'da Arapça yüz ana fontun önüne eklenir; diğer dillerde değişmez", () => {
    expect(siteFontFamilyFor("INTER", "en")).toBe(SITE_FONT_FAMILY.INTER);
    expect(siteFontFamilyFor("INTER", "ru")).toBe(`var(--font-site-inter-cyr), ${SITE_FONT_FAMILY.INTER}`);
    // Kiril alt kümesi olmayan fontlara uyumlu yedek.
    expect(siteFontFamilyFor("POPPINS", "ru")).toMatch(/^var\(--font-site-montserrat-cyr\)/);
    expect(siteFontFamilyFor("SYSTEM", "ru")).toBe(SITE_FONT_FAMILY.SYSTEM);
    expect(siteFontFamilyFor("LORA", "ar")).toBe(`var(--font-site-arabic), ${SITE_FONT_FAMILY.LORA}`);
  });

  it("font değişken sınıfları yalnızca ru/ar sayfalarında uygulanır", () => {
    expect(siteScriptFontClass("en")).toBe("");
    expect(siteScriptFontClass("tr")).toBe("");
    expect(siteScriptFontClass("ru")).not.toBe("");
    expect(siteScriptFontClass("ar")).not.toBe("");
  });

  it("SiteScope stili aktif dile göre font yığını üretir", () => {
    const appearance = { headingFont: "INTER", bodyFont: "INTER", borderRadius: "MD", baseFontSize: 16 } as unknown as PublicSiteAppearance;
    const style = buildSiteScopeStyle(appearance, "ar") as Record<string, string>;
    expect(style["--site-body-font"]).toMatch(/^var\(--font-site-arabic\)/);
    expect((buildSiteScopeStyle(appearance, "es") as Record<string, string>)["--site-body-font"]).toBe(SITE_FONT_FAMILY.INTER);
  });
});
