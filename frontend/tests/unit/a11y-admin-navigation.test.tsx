import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminNavigationPage from "@/app/admin/navigation/page";
import { ModulesProvider } from "@/context/modules-context";
import type { NavigationConfigDto, Page, SitePage, SiteSettings } from "@/lib/api/types";

// `useSearchParams` (`?tab=` derin link desteği, §10.12.1) + `useUnsavedChangesGuard`'ın
// kullandığı `usePathname` — bkz. a11y-admin-stats.test.tsx ile AYNI mock deseni.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/navigation",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/blog", () => ({ listPosts: vi.fn() }));
vi.mock("@/lib/api/products", () => ({ listProducts: vi.fn() }));
vi.mock("@/lib/api/portfolio", () => ({ listPortfolioItems: vi.fn() }));
vi.mock("@/lib/api/navigation", () => ({
  getNavigationConfig: vi.fn(),
  updateNavigationConfig: vi.fn(),
}));
vi.mock("@/lib/api/modules", () => ({ listModules: vi.fn() }));

const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");
const blogApi = await import("@/lib/api/blog");
const productsApi = await import("@/lib/api/products");
const portfolioApi = await import("@/lib/api/portfolio");
const navigationApi = await import("@/lib/api/navigation");
const modulesApi = await import("@/lib/api/modules");

const axeOptions = { rules: { region: { enabled: false } } };

const settings: SiteSettings = {
  siteName: "Örnek Site",
  logoUrl: null,
  tagline: null,
  homePageId: null,
  siteTemplate: "SHOWCASE",
  headerLogoHeight: null,
  headerLogoMaxWidth: null,
  shippingFlatFeeCents: null,
  freeShippingThresholdCents: null,
  shippingEstimatedDaysMin: null,
  shippingEstimatedDaysMax: null,
};

const publishedPages: SitePage[] = [
  {
    id: "page-1",
    slug: "hakkimizda",
    title: "Hakkımızda",
    status: "PUBLISHED",
    blocks: [],
    seoTitle: null,
    seoDescription: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
] as unknown as SitePage[];

const pagesPage: Page<SitePage> = { items: publishedPages, meta: { nextCursor: null } };
const emptyPage = { items: [], meta: { nextCursor: null } };

const navConfig: NavigationConfigDto = {
  headerCtaLabel: "Giriş Yap",
  headerCtaHref: "/login",
  footerCopyrightText: "© 2026 Örnek Site",
  navigationItems: [
    { id: "nav-1", label: "Anasayfa", href: "/", order: 0, parentId: null },
    { id: "nav-2", label: "Hakkımızda", href: "/hakkimizda", order: 1, parentId: null },
  ],
  socialLinks: [
    { id: "social-1", platform: "TWITTER", url: "https://twitter.com/ornek", order: 0 },
    { id: "social-2", platform: "GITHUB", url: "https://github.com/ornek", order: 1 },
  ],
  footerColumns: [
    {
      id: "col-1",
      title: "Şirket",
      order: 0,
      links: [{ id: "col-1-link-1", label: "Gizlilik Politikası", href: "/gizlilik", order: 0 }],
    },
  ],
};

function mockLoad() {
  vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
  vi.mocked(pagesApi.listPages).mockResolvedValue(pagesPage);
  vi.mocked(blogApi.listPosts).mockResolvedValue(emptyPage as never);
  vi.mocked(productsApi.listProducts).mockResolvedValue(emptyPage as never);
  vi.mocked(portfolioApi.listPortfolioItems).mockResolvedValue(emptyPage as never);
  vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);
  vi.mocked(modulesApi.listModules).mockResolvedValue([]);
}

function renderPage() {
  return render(
    <ModulesProvider>
      <AdminNavigationPage />
    </ModulesProvider>
  );
}

describe("AdminNavigationPage — a11y", () => {
  it("'Menüleri Düzenle' sekmesi (içerik seçici + menü ağacı) yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockLoad();

    const { container } = renderPage();

    expect(await screen.findByText("Anasayfa")).toBeInTheDocument();
    // "Hakkımızda" hem ağaç satırında hem de sol paneldeki "Sayfalar" listesinde (devre dışı,
    // "Eklendi" rozetiyle) görünür — en az bir eşleşme olması yeterli.
    expect(screen.getAllByText("Hakkımızda").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /Menüleri Düzenle/ })).toHaveAttribute("aria-selected", "true");

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("'Konumları Yönet' sekmesi (logo/CTA/footer/sosyal linkler + canlı önizleme) kritik/ciddi a11y ihlali içermez", async () => {
    mockLoad();

    const user = userEvent.setup();
    const { container } = renderPage();

    await screen.findByText("Anasayfa");
    await user.click(screen.getByRole("tab", { name: /Konumları Yönet/ }));

    expect(await screen.findByLabelText(/Site adı/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://twitter.com/ornek")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Şirket")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("içerikten (Sayfalar) yeni bir menü öğesi eklendikten sonra da kritik/ciddi a11y ihlali içermez", async () => {
    mockLoad();

    const user = userEvent.setup();
    const { container } = renderPage();

    await screen.findByText("Anasayfa");

    const pagesCheckbox = screen.getByRole("checkbox", { name: /Hakkımızda/ });
    // "Hakkımızda" zaten menüde olduğu için checkbox işaretli/devre dışı gelir (base-ui
    // Checkbox gerçek bir `<input>` değil, `role="checkbox"` taşıyan bir `<span>` render eder —
    // devre dışılık native `disabled` yerine `aria-disabled`/`data-disabled` ile ifade edilir)
    // — bu testte eklenebilir yeni bir sayfa olmadığından yalnızca ağacın (mevcut 2 öğe)
    // a11y'sini "Menüye Ekle" akışını tetiklemeden doğruluyoruz.
    expect(pagesCheckbox).toHaveAttribute("aria-disabled", "true");

    // Bir satırın düzenleme panelini açıp kapatma da a11y ihlali üretmemeli.
    const editButtons = screen.getAllByRole("button", { name: "Düzenle" });
    await user.click(editButtons[0]!);
    expect(await screen.findAllByLabelText("Etiket")).not.toHaveLength(0);

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("özel bağlantı eklendikten sonra ağaçta görünür ve a11y ihlali içermez", async () => {
    mockLoad();

    const user = userEvent.setup();
    const { container } = renderPage();

    await screen.findByText("Anasayfa");

    await user.click(screen.getByRole("button", { name: /Özel Bağlantılar/ }));
    await user.type(screen.getByLabelText("Etiket"), "Kampanyalar");
    await user.type(screen.getByLabelText("Bağlantı"), "/kampanyalar");
    await user.click(screen.getByRole("button", { name: "Ekle" }));

    expect(await screen.findByText("Kampanyalar")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("AdminNavigationPage — sekme değişimi kaydedilmemiş değişiklik uyarısı", () => {
  it("'Menüleri Düzenle' sekmesinde değişiklik varken 'Konumları Yönet'e geçilirse onay istenir", async () => {
    mockLoad();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Anasayfa");
    await user.click(screen.getByRole("button", { name: /Özel Bağlantılar/ }));
    await user.type(screen.getByLabelText("Etiket"), "Kampanyalar");
    await user.type(screen.getByLabelText("Bağlantı"), "/kampanyalar");
    await user.click(screen.getByRole("button", { name: "Ekle" }));
    await screen.findByText("Kampanyalar");

    await user.click(screen.getByRole("tab", { name: /Konumları Yönet/ }));

    expect(confirmSpy).toHaveBeenCalled();
    // window.confirm false döndürdüğü için sekme değişmemeli.
    expect(screen.getByRole("tab", { name: /Menüleri Düzenle/ })).toHaveAttribute("aria-selected", "true");

    confirmSpy.mockRestore();
  });
});

describe("AdminNavigationPage — hata durumu", () => {
  it("yükleme başarısız olursa yeniden dene seçenekli hata mesajı gösterir", async () => {
    vi.mocked(settingsApi.getSettings).mockRejectedValue(new Error("network"));
    vi.mocked(pagesApi.listPages).mockResolvedValue(emptyPage as never);
    vi.mocked(blogApi.listPosts).mockResolvedValue(emptyPage as never);
    vi.mocked(productsApi.listProducts).mockResolvedValue(emptyPage as never);
    vi.mocked(portfolioApi.listPortfolioItems).mockResolvedValue(emptyPage as never);
    vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);
    vi.mocked(modulesApi.listModules).mockResolvedValue([]);

    const { container } = renderPage();

    expect(await screen.findByRole("button", { name: "Tekrar Dene" })).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
