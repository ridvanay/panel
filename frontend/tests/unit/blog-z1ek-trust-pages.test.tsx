import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Locale, PublicBlogReviewerItem } from "@/lib/api/types";

const mocks = vi.hoisted(() => ({ reviewers: vi.fn(), locales: vi.fn() }));

vi.mock("@/lib/api/server-blog", () => ({ fetchBlogReviewersServer: (...a: unknown[]) => mocks.reviewers(...a) }));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: () => mocks.locales() }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: async () => ({ siteName: "WM Health" }) }));
vi.mock("@/components/site/matcher/matcher-modal", () => ({
  MatcherLaunchButton: () => <button type="button">Find my physician</button>,
}));

import { ContentStandardsPage } from "@/components/site/trust/content-standards-page";
import { MedicalReviewersPage, reviewerTitleLine } from "@/components/site/trust/medical-reviewers-page";
import { buildTrustMetadata, buildTrustWebPageJsonLd, TRUST_PAGES_UPDATED_ISO } from "@/lib/blog/trust-pages";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { trustPagesStrings as en } from "@/lib/i18n/site-dictionaries/en/trust-pages";

const LANGS = ["en", "tr", "es", "de", "ar", "ru", "ro", "fr", "sr-latn"] as const;
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

const NINE_LOCALES: Locale[] = LANGS.map((code, index) => ({
  code,
  label: code,
  nativeLabel: code,
  isDefault: code === "en",
  enabled: true,
  sortOrder: index,
  hreflang: null,
}));

const REVIEWER: PublicBlogReviewerItem = {
  slug: "hakan-sofu",
  name: "Prof. Dr. H. Sofu",
  title: "Prof. Dr.",
  avatarUrl: null,
  specialty: { slug: "orthopaedics", name: "Orthopaedics" },
  approvedCount: 3,
};

beforeEach(() => {
  mocks.reviewers.mockReset().mockResolvedValue([REVIEWER]);
  mocks.locales.mockReset().mockResolvedValue(NINE_LOCALES);
});

function jsonLd(container: HTMLElement) {
  return [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
}

describe("Paket Z1-ek — güven sayfaları sözlüğü (9 dil)", () => {
  it("9 dil de aynı anahtar kümesine, dolu değerlere ve aynı yer tutuculara sahip", async () => {
    const keys = Object.keys(en).sort();
    for (const lang of LANGS) {
      const dict = (await getSiteDictionary(lang)).trustPages;
      expect(Object.keys(dict).sort(), lang).toEqual(keys);
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
        expect(placeholders(value), `${lang}.${key}`).toBe(placeholders((en as Record<string, string>)[key]!));
      }
    }
  });

  it("çevrilmiş diller İngilizce metni birebir kopyalamaz", async () => {
    for (const lang of LANGS.filter((l) => l !== "en")) {
      const dict = (await getSiteDictionary(lang)).trustPages;
      const same = Object.entries(dict).filter(([key, value]) => value === (en as Record<string, string>)[key]);
      expect(same.length, `${lang}: ${same.map(([k]) => k).join(",")}`).toBeLessThanOrEqual(4); // ortak sözcükler (fr: Sources, Publication, Important)
    }
  });

  it("onaylı EN metni aynen korunur (içerik standartları ve inceleyici cümleleri)", () => {
    expect(en.csIntro).toBe(
      "Our guides help you understand a health topic before you decide on next steps. They offer general information in plain language. They are not medical advice and do not replace a consultation with a physician."
    );
    expect(en.csAlertText).toContain("If you have urgent symptoms, contact your local emergency services.");
    expect(en.mrReviewersEmpty).toBe("Our physicians review each guide before publication.");
  });
});

describe("Paket Z1-ek — route önceliği", () => {
  it("özel route'lar statik klasördür ve dinamik [slug] CMS rotasının kardeşidir (statik segment önceliklidir)", () => {
    const site = resolve(__dirname, "../../src/app/[lang]/(site)");
    expect(existsSync(resolve(site, "content-standards/page.tsx"))).toBe(true);
    expect(existsSync(resolve(site, "medical-reviewers/page.tsx"))).toBe(true);
    expect(existsSync(resolve(site, "[slug]/page.tsx"))).toBe(true);
  });
});

describe("Paket Z1-ek — Content standards", () => {
  it.each(LANGS)("%s: tek H1, 5 ilke kartı, 5 adımlı süreç, uyarı kutusu, 2 CTA; paylaşım yok", async (lang) => {
    const dict = (await getSiteDictionary(lang)).trustPages;
    const { container } = render(await ContentStandardsPage({ lang }));
    const h1 = screen.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(dict.csTitle);
    // Başlık tekrarı yok: sayfa başlığı H1 dışında ikinci bir başlık olarak geçmez.
    expect(screen.getAllByRole("heading").filter((h) => h.textContent === dict.csTitle)).toHaveLength(1);
    expect(screen.getAllByTestId("trust-card")).toHaveLength(5);
    expect(screen.getAllByTestId("trust-step")).toHaveLength(5);
    expect(screen.getByTestId("trust-alert")).toHaveTextContent(dict.csAlertText);
    const ctas = screen.getByTestId("trust-ctas");
    expect(within(ctas).getByRole("link", { name: dict.ctaGuides })).toBeInTheDocument();
    expect(within(ctas).getByRole("button", { name: "Find my physician" })).toBeInTheDocument();
    expect(screen.getByTestId("trust-updated")).toHaveTextContent(dict.lastUpdated);
    expect(container.querySelector("[data-testid='blog-share']")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  });

  it("varsayılan dil önekisiz, diğer diller önekli bağlantılar", async () => {
    const { unmount } = render(await ContentStandardsPage({ lang: "en" }));
    expect(within(screen.getByTestId("trust-ctas")).getByRole("link", { name: "Read our health guides" })).toHaveAttribute("href", "/blog");
    unmount();
    render(await ContentStandardsPage({ lang: "tr" }));
    expect(within(screen.getByTestId("trust-ctas")).getByRole("link", { name: "Sağlık rehberlerimizi okuyun" })).toHaveAttribute("href", "/tr/blog");
  });

  it("WebPage JSON-LD tek nesne ve onay tarihini taşır", async () => {
    const { container } = render(await ContentStandardsPage({ lang: "en" }));
    const [ld, ...rest] = jsonLd(container);
    expect(rest).toHaveLength(0);
    expect(ld).toMatchObject({ "@type": "WebPage", name: "Content standards", inLanguage: "en", dateModified: TRUST_PAGES_UPDATED_ISO });
    expect(ld.url).toMatch(/\/content-standards$/);
  });
});

describe("Paket Z1-ek — Authors & medical reviewers", () => {
  it.each(LANGS)("%s: tek H1, Editorial Team kartı, 3 inceleme maddesi ve hekim ızgarası", async (lang) => {
    const dict = (await getSiteDictionary(lang)).trustPages;
    render(await MedicalReviewersPage({ lang }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading").filter((h) => h.textContent === dict.mrTitle)).toHaveLength(1);
    expect(screen.getByTestId("trust-editorial")).toHaveTextContent(dict.mrEditorialTitle);
    expect(within(screen.getByTestId("trust-covers")).getAllByRole("listitem")).toHaveLength(3);
    expect(within(screen.getByTestId("trust-reviewer-grid")).getAllByTestId("trust-reviewer-card")).toHaveLength(1);
    expect(mocks.reviewers).toHaveBeenCalledWith(lang);
  });

  it("ızgara yalnızca API'nin döndürdüğü (onaylı yazısı olan) hekimleri gösterir; profil bağlantısı ve sayı gerçektir", async () => {
    mocks.reviewers.mockResolvedValue([REVIEWER, { ...REVIEWER, slug: "ayse-demir", name: "Dr. A. Demir", title: "Dr.", approvedCount: 1 }]);
    render(await MedicalReviewersPage({ lang: "en" }));
    const cards = screen.getAllByTestId("trust-reviewer-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole("link", { name: "View the profile of Prof. Dr. H. Sofu" })).toHaveAttribute("href", "/physicians/hakan-sofu");
    expect(cards[0]).toHaveTextContent("Guides reviewed: 3");
    expect(screen.queryByText("Dr. B. Yok")).toBeNull();
  });

  it("onaylı yazısı olan hekim yoksa ızgara yerine nötr cümle çıkar", async () => {
    mocks.reviewers.mockResolvedValue([]);
    render(await MedicalReviewersPage({ lang: "en" }));
    expect(screen.queryByTestId("trust-reviewer-grid")).toBeNull();
    expect(screen.getByTestId("trust-reviewers-empty")).toHaveTextContent("Our physicians review each guide before publication.");
  });

  it("unvan addan ayrı yalnızca ad unvanı içermiyorsa yazılır", () => {
    expect(reviewerTitleLine(REVIEWER)).toBeNull();
    expect(reviewerTitleLine({ name: "H. Sofu", title: "Prof. Dr." })).toBe("Prof. Dr.");
    expect(reviewerTitleLine({ name: "H. Sofu", title: null })).toBeNull();
  });

  it("WebPage JSON-LD", async () => {
    const { container } = render(await MedicalReviewersPage({ lang: "ar" }));
    expect(jsonLd(container)[0]).toMatchObject({ "@type": "WebPage", name: "الكتّاب والمراجعون الطبيون", inLanguage: "ar" });
    expect(jsonLd(container)[0].url).toMatch(/\/ar\/medical-reviewers$/);
  });
});

describe("Paket Z1-ek — güven sayfası SEO", () => {
  it("canonical dile özgüdür; hreflang 9 dilin hepsini ve x-default'u içerir", async () => {
    const meta = await buildTrustMetadata("tr", "content-standards");
    expect(String(meta.alternates?.canonical)).toMatch(/\/tr\/content-standards$/);
    const languages = meta.alternates?.languages as Record<string, string>;
    expect(Object.keys(languages).sort()).toEqual([...LANGS, "x-default"].sort());
    expect(languages.en).toMatch(/\/content-standards$/);
    expect(languages.en).not.toMatch(/\/en\//);
    expect(languages["sr-latn"]).toMatch(/\/sr-latn\/content-standards$/);
    expect(languages["x-default"]).toBe(languages.en);
    expect(meta.title).toBe("İçerik standartları");
  });

  it("devre dışı diller hreflang'a girmez", async () => {
    mocks.locales.mockResolvedValue(NINE_LOCALES.map((l) => (l.code === "ro" ? { ...l, enabled: false } : l)));
    const meta = await buildTrustMetadata("en", "medical-reviewers");
    expect(Object.keys(meta.alternates?.languages as object)).not.toContain("ro");
  });

  it("JSON-LD üretici </ karakterlerini kaçışlar", () => {
    const json = buildTrustWebPageJsonLd({ url: "https://x.test/a", name: "</script>", description: "d", lang: "en", siteName: "S" });
    expect(json).not.toContain("</script>");
  });
});
