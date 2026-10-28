import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminNavigationPage from "@/app/admin/navigation/page";
import { ModulesProvider } from "@/context/modules-context";
import type { Locale, NavigationConfigDto, SiteSettings } from "@/lib/api/types";

/**
 * Paket U (B2) — admin "Konumları Yönet": slogan, başlık CTA etiketi ve footer metni dil sekmeleriyle
 * düzenlenir; EN sekmesi kanonik alanı, diğer diller `siteTranslations.<dil>`'i yazar; kayıt
 * yalnızca bu alanların çevirilerini gönderir (URL/renk/anahtar yok).
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/navigation",
  useSearchParams: () => new URLSearchParams("tab=locations"),
}));
vi.mock("@/lib/api/settings", () => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/blog", () => ({ listPosts: vi.fn() }));
vi.mock("@/lib/api/products", () => ({ listProducts: vi.fn() }));
vi.mock("@/lib/api/portfolio", () => ({ listPortfolioItems: vi.fn() }));
vi.mock("@/lib/api/navigation", () => ({ getNavigationConfig: vi.fn(), updateNavigationConfig: vi.fn() }));
vi.mock("@/lib/api/modules", () => ({ listModules: vi.fn() }));
vi.mock("@/lib/api/locales", () => ({ listAdminLocales: vi.fn() }));

const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");
const blogApi = await import("@/lib/api/blog");
const productsApi = await import("@/lib/api/products");
const portfolioApi = await import("@/lib/api/portfolio");
const navigationApi = await import("@/lib/api/navigation");
const modulesApi = await import("@/lib/api/modules");
const localesApi = await import("@/lib/api/locales");

const empty = { items: [], meta: { nextCursor: null } };
const settings = { siteName: "WM Health", logoUrl: null, tagline: "Expert care online", homePageId: null, headerLogoHeight: null, headerLogoMaxWidth: null } as unknown as SiteSettings;
const navConfig: NavigationConfigDto = {
  headerCtaLabel: "Appointment",
  headerCtaHref: "/doctors",
  footerCopyrightText: "© WM Health",
  siteTranslations: { tr: { headerCtaLabel: "Randevu" } },
  navigationItems: [],
  socialLinks: [],
  footerColumns: [],
};
const locales = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ro", label: "Romence", nativeLabel: "Română", isDefault: false, enabled: false, sortOrder: 6, hreflang: "ro" },
] as Locale[];

describe("admin — site metinleri dil sekmeleri (Paket U, B2)", () => {
  it("RO sekmesinde CTA etiketi çeviri olarak yazılır; kanonik EN değişmez; kayıt siteTranslations gönderir", async () => {
    vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
    vi.mocked(settingsApi.updateSettings).mockResolvedValue(settings);
    vi.mocked(pagesApi.listPages).mockResolvedValue(empty as never);
    vi.mocked(blogApi.listPosts).mockResolvedValue(empty as never);
    vi.mocked(productsApi.listProducts).mockResolvedValue(empty as never);
    vi.mocked(portfolioApi.listPortfolioItems).mockResolvedValue(empty as never);
    vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);
    vi.mocked(navigationApi.updateNavigationConfig).mockResolvedValue(navConfig);
    vi.mocked(modulesApi.listModules).mockResolvedValue([]);
    vi.mocked(localesApi.listAdminLocales).mockResolvedValue(locales);

    const user = userEvent.setup();
    render(
      <ModulesProvider>
        <AdminNavigationPage />
      </ModulesProvider>
    );
    const ctaInput = (await screen.findByLabelText("Buton metni")) as HTMLInputElement;
    expect(ctaInput.value).toBe("Appointment");

    const ctaCard = ctaInput.closest("section, div[class*='rounded']") as HTMLElement;
    const roTab = await waitFor(() => within(ctaCard.parentElement ?? document.body).getAllByRole("tab", { name: /ro/i })[0]!);
    await user.click(roTab);
    await waitFor(() => expect((screen.getByLabelText("Buton metni") as HTMLInputElement).value).toBe(""));
    expect(screen.getByLabelText("Buton metni")).toHaveAttribute("placeholder", "Appointment");
    await user.type(screen.getByLabelText("Buton metni"), "Programare");

    await user.click(screen.getAllByRole("button", { name: /Kaydet/ })[0]!);
    await waitFor(() => expect(navigationApi.updateNavigationConfig).toHaveBeenCalled());
    const payload = vi.mocked(navigationApi.updateNavigationConfig).mock.calls[0]![0];
    expect(payload.headerCtaLabel).toBe("Appointment");
    expect(payload.siteTranslations).toEqual({ tr: { headerCtaLabel: "Randevu" }, ro: { headerCtaLabel: "Programare" } });
  });
});
