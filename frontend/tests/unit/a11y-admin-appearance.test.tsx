import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminAppearancePage from "@/app/admin/appearance/page";
import type {
  AppearancePreset,
  NavigationConfigDto,
  Page,
  SiteAppearance,
  SiteCustomCode,
  SitePage,
  SiteSettings,
} from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/appearance",
}));
vi.mock("@/lib/api/appearance", () => ({
  getAdminAppearance: vi.fn(),
  updateAppearance: vi.fn(),
  getPresets: vi.fn(),
  resetAppearance: vi.fn(),
  getCustomCode: vi.fn(),
  updateCustomCss: vi.fn(),
  updateCustomJs: vi.fn(),
}));
vi.mock("@/lib/api/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/navigation", () => ({ getNavigationConfig: vi.fn() }));

const appearanceApi = await import("@/lib/api/appearance");
const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");
const navigationApi = await import("@/lib/api/navigation");

const axeOptions = { rules: { region: { enabled: false } } };

const appearance: SiteAppearance = {
  presetKey: "modern",
  pageHeaderStyle: "PLAIN",
  pageHeaderBackgroundColor: null,
  pageHeaderBackgroundMediaId: null,
  pageHeaderBackgroundUrl: null,
  pageHeaderOverlayOpacity: 40,
  primaryColor: "#4f46e5",
  secondaryColor: "#111827",
  buttonColor: "#4f46e5",
  buttonTextColor: "#ffffff",
  linkColor: "#4f46e5",
  accentColor: "#f59e0b",
  backgroundColor: "#ffffff",
  surfaceColor: "#f9fafb",
  textColor: "#111827",
  mutedTextColor: "#6b7280",
  headingFont: "INTER",
  bodyFont: "INTER",
  baseFontSize: 16,
  borderRadius: "MD",
  buttonStyle: "SOLID",
  socialShareEnabled: true,
  socialShareNetworks: ["TWITTER", "COPY_LINK"],
  backToTopEnabled: true,
  stickyHeaderEnabled: true,
  cookieBannerEnabled: false,
  cookieBannerText: null,
  cookieBannerPolicyHref: null,
  maintenanceModeEnabled: false,
  maintenanceMessage: null,
  notFoundTitle: null,
  notFoundMessage: null,
  notFoundButtonLabel: null,
  notFoundButtonHref: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const presets: AppearancePreset[] = [
  {
    key: "modern",
    label: "Modern",
    description: "Yüksek kontrastlı, geniş boşluklu, sans-serif.",
    values: {
      primaryColor: "#4f46e5",
      secondaryColor: "#111827",
      buttonColor: "#4f46e5",
      buttonTextColor: "#ffffff",
      linkColor: "#4f46e5",
      headingFont: "INTER",
      bodyFont: "INTER",
      baseFontSize: 16,
    },
  },
  {
    key: "minimal",
    label: "Minimal",
    description: "Yumuşak nötr tonlar, sade tipografi.",
    values: {
      primaryColor: "#0f172a",
      secondaryColor: "#475569",
      buttonColor: "#0f172a",
      buttonTextColor: "#ffffff",
      linkColor: "#0f172a",
      headingFont: "SYSTEM",
      bodyFont: "SYSTEM",
      baseFontSize: 16,
    },
  },
];

const customCode: SiteCustomCode = {
  css: null,
  js: null,
  cssUpdatedAt: null,
  cssUpdatedBy: null,
  jsUpdatedAt: null,
  jsUpdatedBy: null,
  customCodeEnabled: true,
};

const settings: SiteSettings = {
  siteName: "Örnek Site",
  logoUrl: null,
  tagline: "Kaliteli ürünler",
  homePageId: null,
  siteTemplate: "SHOWCASE",
  headerLogoHeight: null,
  headerLogoMaxWidth: null,
};

const navConfig: NavigationConfigDto = {
  headerCtaLabel: null,
  headerCtaHref: null,
  footerCopyrightText: null,
  navigationItems: [{ id: "nav-1", label: "Anasayfa", href: "/", order: 0, parentId: null }],
  socialLinks: [],
  footerColumns: [],
};

const pagesPage: Page<SitePage> = { items: [], meta: { nextCursor: null } };

function mockLoad() {
  vi.mocked(appearanceApi.getAdminAppearance).mockResolvedValue(appearance);
  vi.mocked(appearanceApi.getPresets).mockResolvedValue(presets);
  vi.mocked(appearanceApi.getCustomCode).mockResolvedValue(customCode);
  vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
  vi.mocked(pagesApi.listPages).mockResolvedValue(pagesPage);
  vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);
}

describe("AdminAppearancePage — a11y", () => {
  it("'Logo & Marka' (varsayılan) sekmesi kritik/ciddi a11y ihlali içermez", async () => {
    mockLoad();
    const { container } = render(<AdminAppearancePage />);

    expect((await screen.findAllByText("Örnek Site")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /Logo & Marka/ })).toHaveAttribute("aria-selected", "true");

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("'Stil / Renk' sekmesi (ColorField + ContrastBadge) kritik/ciddi a11y ihlali içermez", async () => {
    mockLoad();
    const user = userEvent.setup();
    const { container } = render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await user.click(screen.getByRole("tab", { name: /Stil \/ Renk/ }));

    expect(await screen.findByLabelText("Birincil Renk — hex kod")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("'Özel CSS / JS' sekmesi kritik/ciddi a11y ihlali içermez", async () => {
    mockLoad();
    const user = userEvent.setup();
    const { container } = render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await user.click(screen.getByRole("tab", { name: /Özel CSS \/ JS/ }));

    expect(await screen.findByLabelText("Özel CSS")).toBeInTheDocument();
    expect(screen.getByText(/Özel kod önizlemede uygulanmaz/)).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("preset seçildiğinde 'presetKey' state'i güncellenir ve seçili kart işaretlenir", async () => {
    mockLoad();
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await user.click(screen.getByRole("tab", { name: /Tasarım Ön Ayarları/ }));

    const minimalCard = await screen.findByRole("radio", { name: /Minimal/ });
    await user.click(minimalCard);

    expect(minimalCard).toHaveAttribute("aria-checked", "true");
  });
});

describe("AdminAppearancePage — hata durumu", () => {
  it("yükleme başarısız olursa yeniden dene seçenekli hata mesajı gösterir", async () => {
    vi.mocked(appearanceApi.getAdminAppearance).mockRejectedValue(new Error("network"));
    vi.mocked(appearanceApi.getPresets).mockResolvedValue(presets);
    vi.mocked(appearanceApi.getCustomCode).mockResolvedValue(customCode);
    vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
    vi.mocked(pagesApi.listPages).mockResolvedValue(pagesPage);
    vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);

    const { container } = render(<AdminAppearancePage />);

    expect(await screen.findByRole("button", { name: "Tekrar Dene" })).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
