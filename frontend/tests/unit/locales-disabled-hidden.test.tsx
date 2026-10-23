import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Locale } from "@/lib/api/types";

/**
 * Paket L (2026-10-23) — kapalı (`enabled: false`) diller dil seçicide, hreflang alternatiflerinde
 * ve sitemap'te GÖRÜNMEZ; açık yeni diller (ör. ar) görünür.
 */
const LOCALES: Locale[] = [
  { code: "en", label: "İngilizce", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ar", label: "Arapça", nativeLabel: "العربية", isDefault: false, enabled: true, sortOrder: 4, hreflang: "ar" },
  { code: "es", label: "İspanyolca", nativeLabel: "Español", isDefault: false, enabled: false, sortOrder: 2, hreflang: "es" },
];

vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: async () => LOCALES, FALLBACK_LOCALES: [] }));
vi.mock("@/lib/api/server-pages", () => ({
  fetchPublishedPagesServer: async () => [
    {
      id: "p1",
      slug: "about-wm",
      updatedAt: "2026-10-01T00:00:00.000Z",
      localizations: [
        { locale: "en", slug: "about-wm", translated: true },
        { locale: "ar", slug: "about-wm", translated: true },
        { locale: "es", slug: "sobre-wm", translated: true },
      ],
    },
  ],
}));
vi.mock("@/lib/api/server-blog", () => ({ fetchBlogPostsServer: async () => [] }));
vi.mock("@/lib/api/server-products", () => ({ fetchProductsServer: async () => [] }));
vi.mock("@/lib/api/server-portfolio", () => ({ fetchPortfolioItemsServer: async () => [] }));
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchDoctorsServer: async () => [{ slug: "vahit-mutlu", updatedAt: "2026-10-01T00:00:00.000Z" }],
  fetchSpecialtiesServer: async () => [{ slug: "obesity", updatedAt: "2026-10-01T00:00:00.000Z" }],
}));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: async () => ({ homePageId: null }), DEFAULT_SETTINGS: { homePageId: null } }));
vi.mock("@/context/locale-alternates-context", () => ({ useLocaleAlternates: () => null, contentKindBasePath: () => "" }));

import sitemap from "@/app/sitemap";
import { LanguageSwitcher } from "@/components/site/language-switcher";

describe("kapalı diller görünmez", () => {
  it("sitemap: kapalı es hiçbir URL/hreflang'de yok, açık ar var", async () => {
    const entries = await sitemap();
    const all = JSON.stringify(entries);
    expect(all).not.toMatch(/\/es\/|sobre-wm|"es":/);
    expect(all).toMatch(/\/ar\/about-wm/);
    expect(all).toMatch(/\/ar\/doctors\/vahit-mutlu|\/ar\/specialties\/obesity/);
  });

  it("dil seçici: yalnızca açık diller listelenir", () => {
    render(<LanguageSwitcher locales={LOCALES} activeLocale={LOCALES[0]!} variant="list" />);
    expect(screen.getByText("العربية")).toBeInTheDocument();
    expect(screen.getByText("Türkçe")).toBeInTheDocument();
    expect(screen.queryByText("Español")).not.toBeInTheDocument();
  });
});
