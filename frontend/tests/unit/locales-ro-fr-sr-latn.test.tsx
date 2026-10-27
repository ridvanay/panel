import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locale } from "@/lib/api/types";
import { localeFromAcceptLanguage, localeFromPath, localizeDestination, resolveAuthLocale } from "@/lib/i18n/auth-locale";
import { LEADING_LOCALE_SEGMENT, hasLocalePrefix, matchLocaleTag } from "@/lib/i18n/locale-code";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { countryName, formatLongDate } from "@/lib/country-display";
import { resolveQaListenerNoticeCopy } from "@/components/site/telehealth/qa-listener-notice";
import { SITEMAP_SECTIONS, buildSection, type SitemapData } from "@/lib/sitemap/build";
import { buildRobotsTxt } from "@/lib/seo/robots";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { noindexHeaderSources } from "@/lib/seo/private-paths";
import { siteDictionary as srLatn } from "@/lib/i18n/site-dictionaries/sr-latn";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as fr } from "@/lib/i18n/site-dictionaries/fr";

/**
 * Paket T — Romence, Fransızca ve Sırpça (Latin, `sr-latn`): tireli dil kodu uçtan uca (rota öneki,
 * çerez, Accept-Language, giriş `next` öneki, hreflang `sr-Latn`), Intl çıktılarında Kiril yok, kapalı
 * diller hiçbir yerde görünmez, font `latin-ext`, dinleyici uyarısı çevirisi.
 */
const CYRILLIC = /[Ѐ-ӿ]/;
const ENABLED = ["en", "tr", "ro", "fr", "sr-latn"];
const loc = (code: string, sortOrder: number, extra: Partial<Locale> = {}): Locale => ({
  code,
  label: code,
  nativeLabel: code,
  isDefault: code === "en",
  enabled: true,
  sortOrder,
  hreflang: code === "sr-latn" ? "sr-Latn" : code,
  ...extra,
});

describe("sr-latn — tireli kod uçtan uca", () => {
  it("rota öneki: yol başındaki /sr-latn tanınır; benzer ama geçersiz önekler tanınmaz", () => {
    expect("/sr-latn/doctors/x".replace(LEADING_LOCALE_SEGMENT, "")).toBe("/doctors/x");
    expect("/sr-latn".replace(LEADING_LOCALE_SEGMENT, "")).toBe("");
    expect("/sr-latin/x".replace(LEADING_LOCALE_SEGMENT, "")).toBe("/sr-latin/x");
    expect(hasLocalePrefix("/sr-latn/patient")).toBe(true);
    expect(hasLocalePrefix("/doctors/x")).toBe(false);
  });

  it("giriş ekranı dili: next öneki, çerez, Accept-Language (sr-Latn-RS, sr-RS, sr → sr-latn)", () => {
    expect(localeFromPath("/sr-latn/doctors/vahit-mutlu", ENABLED)).toBe("sr-latn");
    expect(resolveAuthLocale({ next: null, cookie: "sr-latn", acceptLanguage: null, enabledCodes: ENABLED, defaultCode: "en" })).toBe("sr-latn");
    expect(localeFromAcceptLanguage("sr-Latn-RS,sr;q=0.9,en;q=0.5", ENABLED)).toBe("sr-latn");
    expect(localeFromAcceptLanguage("sr-RS", ENABLED)).toBe("sr-latn");
    expect(localeFromAcceptLanguage("ro-RO,ro;q=0.9", ENABLED)).toBe("ro");
    expect(localeFromAcceptLanguage("fr-CA", ENABLED)).toBe("fr");
    // Kapalı dil eşleşmez.
    expect(localeFromAcceptLanguage("sr-Latn-RS", ["en", "tr"])).toBeNull();
    expect(matchLocaleTag("de-AT", ["de"])).toBe("de");
  });

  it("giriş sonrası hedef: dil öneki korunur (/sr-latn/...), zaten önekliyse dokunulmaz", () => {
    expect(localizeDestination("/patient/appointments", "sr-latn", "en")).toBe("/sr-latn/patient/appointments");
    expect(localizeDestination("/sr-latn/patient", "sr-latn", "en")).toBe("/sr-latn/patient");
    expect(localizeDestination("/admin", "sr-latn", "en")).toBe("/admin");
  });

  it("Intl: sr-latn → sr-Latn-RS; tarih, ülke ve dil adları Latin (Kiril yok); yazı yönü ltr", () => {
    const intl = contentLocaleToIntl("sr-latn");
    expect(intl).toBe("sr-Latn-RS");
    const samples = [
      formatLongDate("2026-10-28T14:00:00Z", "Europe/Belgrade", intl),
      countryName("DE", intl),
      countryName("TR", intl),
      new Intl.DisplayNames([intl], { type: "language" }).of("tr")!,
      new Intl.NumberFormat(intl, { style: "unit", unit: "hour", unitDisplay: "long" }).format(2),
    ];
    for (const s of samples) expect(s, s).not.toMatch(CYRILLIC);
    expect(samples[0]).toContain("oktobar");
    expect(localeDirection("sr-latn")).toBe("ltr");
    expect(contentLocaleToIntl("ro")).toBe("ro-RO");
    expect(contentLocaleToIntl("fr")).toBe("fr-FR");
  });

  it("noindex başlığı ve robots: /sr-latn/patient özel; /sr-latn/doctors açık", () => {
    const { pathToRegexp } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp") as { pathToRegexp: (p: string) => RegExp };
    const regexes = noindexHeaderSources().map((s) => pathToRegexp(s));
    expect(regexes.some((r) => r.test("/sr-latn/patient/bookings"))).toBe(true);
    expect(regexes.some((r) => r.test("/sr-latn/doctors/vahit-mutlu"))).toBe(false);
    const robots = buildRobotsTxt("https://example.com", [loc("en", 0), loc("sr-latn", 8)]);
    expect(robots).toContain("/sr-latn/patient/");
    expect(robots).toContain("Disallow: /*/patient/");
  });
});

describe("kapalı diller hiçbir yerde görünmez; açılınca hreflang sr-Latn", () => {
  const data = (srEnabled: boolean): SitemapData & { siteName: string } => ({
    siteUrl: "https://example.com",
    siteName: "WM Health Istanbul",
    locales: [loc("en", 0), loc("tr", 1), loc("ro", 6, { enabled: false }), loc("fr", 7, { enabled: false }), loc("sr-latn", 8, { enabled: srEnabled })],
    homePageId: null,
    pages: [],
    doctors: [{ slug: "vahit-mutlu", title: "Dr.", fullName: "Vahit Mutlu", isActive: true, archivedAt: null, specialty: null, bio: "", updatedAt: "2026-10-01T00:00:00Z" } as never],
    specialties: [],
    posts: [],
    products: [],
    portfolio: [],
  });

  it("kapalıyken: sitemap, hreflang, robots, llms.txt'de ro/fr/sr-latn yok", () => {
    const d = data(false);
    const all = JSON.stringify(SITEMAP_SECTIONS.flatMap((s) => buildSection(s, d)));
    expect(all).not.toMatch(/\/ro\/|\/fr\/|\/sr-latn|"hreflang":"(ro|fr|sr-Latn)"/);
    expect(buildRobotsTxt(d.siteUrl, d.locales)).not.toMatch(/\/ro\/|\/fr\/|sr-latn/);
    expect(buildLlmsTxt(d)).not.toMatch(/Romanian|French|Serbian|\/sr-latn/);
  });

  it("sr-latn açıkken: /sr-latn/... URL'leri ve hreflang=\"sr-Latn\"; llms.txt'de Latin dil adı", () => {
    const d = data(true);
    const entries = buildSection("doctors", d);
    expect(entries.map((e) => e.loc)).toContain("https://example.com/sr-latn/doctors/vahit-mutlu");
    expect(entries[0]!.alternates).toEqual(expect.arrayContaining([{ hreflang: "sr-Latn", href: "https://example.com/sr-latn/doctors" }]));
    expect(buildLlmsTxt(d)).toContain("(sr-latn): https://example.com/sr-latn");
    expect(buildLlmsTxt(d)).not.toMatch(CYRILLIC);
  });
});

describe("sözlükler ve metinler", () => {
  it("sr-latn sözlüğünde Kiril yok; Romence virgüllü ș/ț (çengelli ş/ţ yok); Fransızca karakterler doğru", () => {
    const sr = JSON.stringify(srLatn);
    expect(sr).not.toMatch(CYRILLIC);
    expect(sr).toMatch(/[čćđšž]/);
    const roText = JSON.stringify(ro);
    expect(roText).not.toMatch(/[ŞşŢţ]/);
    expect(roText).toMatch(/[șț]/);
    expect(JSON.stringify(fr)).toMatch(/[éèêàç]/);
  });

  it("yasal sayfa notu (bağlayıcı sürüm TR/EN) üç dilde de var", () => {
    const notes = [ro, fr, srLatn].map((dict) => dict.legal.bindingVersionsNote);
    for (const note of notes) expect(note.length).toBeGreaterThan(20);
    expect(new Set(notes).size).toBe(3);
  });

  it("dinleyici uyarısı: ro/fr/sr-latn çevirileri; bilinmeyen dil TR, en-* EN", () => {
    expect(resolveQaListenerNoticeCopy("ro").notice).toContain("controlului calității");
    expect(resolveQaListenerNoticeCopy("fr").notice).toContain("contrôle qualité");
    expect(resolveQaListenerNoticeCopy("sr-latn").notice).toContain("kontrole kvaliteta");
    expect(resolveQaListenerNoticeCopy("sr-latn").notice).not.toMatch(CYRILLIC);
    expect(resolveQaListenerNoticeCopy("en-GB").notice).toContain("quality control");
    expect(resolveQaListenerNoticeCopy("xx").notice).toContain("Kalite kontrol");
  });

  it("font: site fontları ve kök Geist fontları latin-ext alt kümesini yükler (ș ț ă č ć đ œ)", () => {
    const fonts = readFileSync(resolve(__dirname, "../../src/lib/site-settings/site-fonts.ts"), "utf8");
    const siteFontLines = fonts.split("\n").filter((l) => /^export const site\w+ = \w+\(\{ subsets: \["latin"/.test(l));
    expect(siteFontLines.length).toBe(10);
    expect(siteFontLines.every((l) => l.includes('"latin-ext"'))).toBe(true);
    const layout = readFileSync(resolve(__dirname, "../../src/app/layout.tsx"), "utf8");
    expect((layout.match(/subsets: \["latin", "latin-ext"\]/g) ?? []).length).toBe(2);
  });
});
