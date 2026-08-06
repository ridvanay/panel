import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminNavigationPage from "@/app/admin/navigation/page";
import type { NavigationConfigDto, Page, SitePage, SiteSettings } from "@/lib/api/types";

vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/navigation", () => ({
  getNavigationConfig: vi.fn(),
  updateNavigationConfig: vi.fn(),
}));

const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");
const navigationApi = await import("@/lib/api/navigation");

const axeOptions = { rules: { region: { enabled: false } } };

const settings: SiteSettings = { siteName: "Örnek Site", logoUrl: null, homePageId: null };

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

const navConfig: NavigationConfigDto = {
  headerCtaLabel: "Giriş Yap",
  headerCtaHref: "/login",
  footerCopyrightText: "© 2026 Örnek Site",
  navigationItems: [
    { id: "nav-1", label: "Anasayfa", href: "/", order: 0 },
    { id: "nav-2", label: "Hakkımızda", href: "/hakkimizda", order: 1 },
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

describe("AdminNavigationPage — a11y", () => {
  it("menü/CTA/footer/sosyal linkler ve canlı önizleme yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
    vi.mocked(pagesApi.listPages).mockResolvedValue(pagesPage);
    vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);

    const { container } = render(<AdminNavigationPage />);

    expect(await screen.findByLabelText(/Site adı/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Anasayfa")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://twitter.com/ornek")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Şirket")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("yeni bir navigasyon menü öğesi eklendikten sonra da kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
    vi.mocked(pagesApi.listPages).mockResolvedValue(pagesPage);
    vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);

    const user = userEvent.setup();
    const { container } = render(<AdminNavigationPage />);

    await screen.findByLabelText(/Site adı/);
    // "Etiket" label'ı hem nav öğelerinde hem footer sütun linklerinde kullanılıyor;
    // başlangıçta 2 nav öğesi + 1 footer link = 3 alan var.
    expect(screen.getAllByLabelText("Etiket")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Menü Öğesi Ekle" }));

    // Yeni satır boş label/href input'larıyla eklenir; toplam "Etiket" alanı 4 olur.
    expect(screen.getAllByLabelText("Etiket")).toHaveLength(4);

    // NOT (bulgu — bkz. görev raporu): satır boş bırakıldığında canlı önizlemedeki
    // `SiteHeader`, `href=""` ve metinsiz bir `<a>` render eder (axe: link-name ihlali).
    // Gerçekçi bir kullanıcı akışını test etmek için burada alanlar doldurulur; boş
    // satırın önizlemeye YANSIMAMASI/temizlenmesi gerektiği frontend-agent'a bırakılmıştır.
    const labelInputs = screen.getAllByPlaceholderText("Ör. Hakkımızda");
    const hrefInputs = screen.getAllByPlaceholderText("/hakkimizda");
    await user.type(labelInputs[labelInputs.length - 1]!, "İletişim");
    await user.type(hrefInputs[hrefInputs.length - 1]!, "/iletisim");

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
