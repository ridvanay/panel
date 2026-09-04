import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/**
 * design-notes-appearance-polish.md kapsamındaki YENİ görsel/davranışsal parçaların testleri:
 * - Sol menü grup başlıkları (§2) — interaktif değil, klavye ok-tuşu gezinmesi gruplar arası çalışır.
 * - `FullnessSocket` doluluk göstergesi (§4) — DEFAULTS'tan farklı bölümler dolu görünür.
 * - Canlı önizleme cihaz toggle'ı + yeni sekmede aç (§3) — Base UI Button+render(Link/<a>)
 *   yerine düz `<a>`/`<Link>` + `buttonVariants()` kullanır (bkz. page.tsx'teki gerekçe notu),
 *   bu yüzden erişilebilir rolü YALNIZCA "link" olmalı, "button" DEĞİL.
 * - Banner önizlemesi okunabilirlik pill'i (§1).
 */
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

// `socialShareEnabled: true`/`socialShareNetworks` DEFAULTS'tan (false/[]) farklı → "Sosyal Medya
// Paylaşımı" sekmesi dolu; `pageHeaderStyle`/`overlayOpacity` DEFAULTS'la aynı → "Sayfa Başlığı
// Düzeni" sekmesi boş — iki durumun da testte AYRIŞTIĞINDAN emin olmak için bilinçli seçildi.
const appearance: SiteAppearance = {
  presetKey: "modern",
  pageHeaderStyle: "PLAIN",
  pageHeaderLayout: "CENTERED",
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
  shippingFlatFeeCents: null,
  freeShippingThresholdCents: null,
  shippingEstimatedDaysMin: null,
  shippingEstimatedDaysMax: null,
};

const navConfig: NavigationConfigDto = {
  headerCtaLabel: "Sepete Git",
  headerCtaHref: "/cart",
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

describe("AdminAppearancePage — sol menü grupları (design-notes-appearance-polish.md §2)", () => {
  it("3 grup başlığı ('Marka'/'Tasarım'/'Gelişmiş') görünür ve interaktif DEĞİLDİR (tab rolünde değil)", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    for (const label of ["Marka", "Tasarım", "Gelişmiş"]) {
      const heading = screen.getByText(label);
      expect(heading.tagName).toBe("SPAN");
      expect(heading).toHaveAttribute("aria-hidden", "true");
    }
    // Grup başlıkları klavye/tab rolüne sahip DEĞİL — yalnızca 9 gerçek `tab` rolü olmalı.
    expect(screen.getAllByRole("tab")).toHaveLength(9);
  });

  it("klavye ok-tuşu gezinmesi grup sınırını sorunsuz geçer (brand → social → presets)", async () => {
    mockLoad();
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    const brandTab = screen.getByRole("tab", { name: /Logo & Marka/ });
    await user.click(brandTab);
    expect(brandTab).toHaveFocus();

    // Not: `TabsList` DOM'da `data-orientation="horizontal"` raporluyor (dikey CSS'e RAĞMEN — Base
    // UI'nin roving-tabindex'i bu iç durumu kullanıyor), bu yüzden gezinme tuşu `ArrowRight`'tır;
    // burada test edilen asıl şey grup `<div>` sarmalayıcılarının döngüyü BÖLMEDİĞİ.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Sosyal Medya Paylaşımı/ })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Tasarım Ön Ayarları/ })).toHaveFocus();
  });
});

describe("AdminAppearancePage — bölüm doluluk göstergesi FullnessSocket (design-notes-appearance-polish.md §4)", () => {
  it("DEFAULTS'tan farklı bir bölüm (Sosyal Medya Paylaşımı) dolu soketle işaretlenir", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    const socialTab = screen.getByRole("tab", { name: /Sosyal Medya Paylaşımı/ });
    const filledSocket = within(socialTab).getByText("", { selector: "span.bg-primary" });
    expect(filledSocket).toBeInTheDocument();
  });

  it("DEFAULTS ile aynı bir bölüm (Sayfa Başlığı Düzeni) boş halka gösterir", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    const pageHeaderTab = screen.getByRole("tab", { name: /Sayfa Başlığı Düzeni/ });
    expect(within(pageHeaderTab).queryByText("", { selector: "span.bg-primary" })).not.toBeInTheDocument();
    expect(within(pageHeaderTab).getByText("", { selector: "span.border-foreground\\/25" })).toBeInTheDocument();
  });

  it("'Logo & Marka' salt-okunur özet olduğu için HER ZAMAN boş halka gösterir", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    const brandTab = screen.getByRole("tab", { name: /Logo & Marka/ });
    expect(within(brandTab).queryByText("", { selector: "span.bg-primary" })).not.toBeInTheDocument();
  });
});

describe("AdminAppearancePage — canlı önizleme cihaz toggle'ı (design-notes-appearance-polish.md §3)", () => {
  it("Masaüstü/Tablet/Mobil düğmeleri aria-pressed ile durum bildirir ve tıklanınca aktif değişir", async () => {
    mockLoad();
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    const desktopBtn = screen.getByRole("button", { name: "Masaüstü" });
    const tabletBtn = screen.getByRole("button", { name: "Tablet" });
    expect(desktopBtn).toHaveAttribute("aria-pressed", "true");
    expect(tabletBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(tabletBtn);

    expect(tabletBtn).toHaveAttribute("aria-pressed", "true");
    expect(desktopBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("'Siteyi yeni sekmede aç' erişilebilir rolü 'link'tir (Base UI Button+render(<a>) DEĞİL — role='button' zorlamaz)", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    const openLink = screen.getByRole("link", { name: "Siteyi yeni sekmede aç" });
    expect(openLink).toHaveAttribute("href", "/");
    expect(openLink).toHaveAttribute("target", "_blank");
  });

  it("'Navigasyon'da Düzenle' de erişilebilir rolü 'link'tir", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    expect(screen.getByRole("link", { name: /Navigasyon'da Düzenle/ })).toHaveAttribute(
      "href",
      "/admin/navigation?tab=locations"
    );
  });
});

describe("AdminAppearancePage — banner önizlemesi okunabilirlik pill'i (design-notes-appearance-polish.md §1)", () => {
  it("'Örnek Sayfa Başlığı' metni overlayOpacity 0 olsa bile bg-black/60 backdrop-blur-sm pill içinde render edilir", async () => {
    mockLoad();
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await user.click(screen.getByRole("tab", { name: /Sayfa Başlığı Düzeni/ }));
    await user.click(screen.getByRole("radio", { name: /Banner/ }));

    const overlaySlider = screen.getByLabelText(/Karartma yoğunluğu/);
    // overlayOpacity'i 0'a çek — pill overlay'den BAĞIMSIZ olduğu için metin YİNE okunur olmalı.
    overlaySlider.setAttribute("value", "0");

    const pillText = screen.getByText("Örnek Sayfa Başlığı");
    expect(pillText).toHaveClass("bg-black/60", "backdrop-blur-sm", "rounded-md", "px-3", "py-1");
  });
});
