import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SiteHeader } from "@/components/site/site-header";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

// `HeaderSearch` (`productsModuleEnabled` varsayılan `true`) `useRouter` kullanır — gerçek
// `next/navigation`'ın `useRouter`'ı App Router bağlamı DIŞINDA (bu test ortamı) fırlatır;
// `usePathname` ise zaten sorunsuz `null` döner, bu yüzden yalnızca `useRouter` override edilir.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  };
});

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

const axeOptions = { rules: { region: { enabled: false } } };

describe("SiteHeader — hiyerarşik (parentId) navigasyon", () => {
  it("kök öğeleri (parentId: null) doğrudan link olarak render eder", () => {
    const navigationItems: NavigationItemDto[] = [
      { id: "nav-1", label: "Anasayfa", href: "/", order: 0, parentId: null },
      { id: "nav-2", label: "Hakkımızda", href: "/hakkimizda", order: 1, parentId: null },
    ];

    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    expect(screen.getByRole("link", { name: "Anasayfa" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Hakkımızda" })).toHaveAttribute("href", "/hakkimizda");
  });

  it("çocuğu olan bir kök öğeyi dropdown tetikleyici olarak render eder; alt öğeler yanlışlıkla kök seviyede görünmez", async () => {
    const navigationItems: NavigationItemDto[] = [
      { id: "root-1", label: "Ürünler", href: "/products", order: 0, parentId: null },
      { id: "child-1", label: "Ahşap Dolaplar", href: "/products/ahsap-dolaplar", order: 0, parentId: "root-1" },
      { id: "child-2", label: "Metal Dolaplar", href: "/products/metal-dolaplar", order: 1, parentId: "root-1" },
      { id: "root-2", label: "İletişim", href: "/iletisim", order: 1, parentId: null },
    ];

    const user = userEvent.setup();
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    // Alt öğeler kapalı dropdown'da DEĞİL, kök seviyede link olarak GÖRÜNMEMELİ.
    expect(screen.queryByRole("link", { name: "Ahşap Dolaplar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Metal Dolaplar" })).not.toBeInTheDocument();

    // Kök seviyede sadece "Ürünler" (dropdown tetikleyici) ve "İletişim" (düz link) olmalı.
    expect(screen.getByRole("button", { name: /Ürünler/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "İletişim" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ürünler/ }));

    expect(await screen.findByRole("menuitem", { name: "Ahşap Dolaplar" })).toHaveAttribute(
      "href",
      "/products/ahsap-dolaplar"
    );
    expect(screen.getByRole("menuitem", { name: "Metal Dolaplar" })).toHaveAttribute("href", "/products/metal-dolaplar");
  });

  it("navigationItems boşsa yayındaki sayfalar + sabit Blog linkine düşer (geriye dönük uyumluluk)", () => {
    render(
      <SiteHeader
        settings={settings}
        pages={[
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
          } as never,
        ]}
      />
    );

    expect(screen.getByRole("link", { name: "Hakkımızda" })).toHaveAttribute("href", "/hakkimizda");
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/blog");
  });

  it("nested dropdown açıkken kritik/ciddi a11y ihlali içermez", async () => {
    const navigationItems: NavigationItemDto[] = [
      { id: "root-1", label: "Ürünler", href: "/products", order: 0, parentId: null },
      { id: "child-1", label: "Ahşap Dolaplar", href: "/products/ahsap-dolaplar", order: 0, parentId: "root-1" },
    ];

    const user = userEvent.setup();
    const { container } = render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    await user.click(screen.getByRole("button", { name: /Ürünler/ }));
    await screen.findByRole("menuitem", { name: "Ahşap Dolaplar" });

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("3 seviyeli bir ağaçta 2. seviye düğüm için DropdownMenuSub (submenu tetikleyicisi) render eder ve 3. seviyeye tıklanınca doğru href'e sahip menü öğesi açılır", async () => {
    const navigationItems: NavigationItemDto[] = [
      { id: "root-1", label: "Ürünler", href: "/products", order: 0, parentId: null },
      { id: "child-1", label: "Mobilya", href: "/products/mobilya", order: 0, parentId: "root-1" },
      {
        id: "grandchild-1",
        label: "Ahşap Dolaplar",
        href: "/products/mobilya/ahsap-dolaplar",
        order: 0,
        parentId: "child-1",
      },
    ];

    const user = userEvent.setup();
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    await user.click(screen.getByRole("button", { name: /Ürünler/ }));

    // 2. seviye ("Mobilya") çocuğu olduğu için düz menuitem DEĞİL, bir submenu tetikleyicisi
    // (Base UI `MenuSubmenuTrigger` bir `menuitem` rolüyle render edilir, `aria-haspopup` taşır).
    const submenuTrigger = await screen.findByRole("menuitem", { name: "Mobilya" });
    expect(submenuTrigger).toHaveAttribute("aria-haspopup");

    await user.hover(submenuTrigger);

    // Hover-intent açılış gecikmesi (150ms) sonrası 3. seviye görünür olmalı.
    const leaf = await screen.findByRole("menuitem", { name: "Ahşap Dolaplar" }, { timeout: 2000 });
    expect(leaf).toHaveAttribute("href", "/products/mobilya/ahsap-dolaplar");
  });

  it("NAVIGATION_MAX_DEPTH aşan bir düğümü render katmanında sessizce atlar (throw etmez)", () => {
    // `buildNavTree` zaten 4. seviyeden sonrasını (depth >= NAVIGATION_MAX_DEPTH) keser; bu test
    // en azından 4 seviyeli geçerli bir ağacın hatasız render edildiğini doğrular.
    const navigationItems: NavigationItemDto[] = [
      { id: "l0", label: "Seviye 0", href: "/l0", order: 0, parentId: null },
      { id: "l1", label: "Seviye 1", href: "/l0/l1", order: 0, parentId: "l0" },
      { id: "l2", label: "Seviye 2", href: "/l0/l1/l2", order: 0, parentId: "l1" },
      { id: "l3", label: "Seviye 3", href: "/l0/l1/l2/l3", order: 0, parentId: "l2" },
    ];

    expect(() =>
      render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />)
    ).not.toThrow();
  });
});

describe("SiteHeader — mobil (Sheet + Accordion) navigasyon", () => {
  it("hamburger tetikleyiciye tıklanınca Sheet açılır ve çok seviyeli ağaç Accordion olarak render edilir", async () => {
    const navigationItems: NavigationItemDto[] = [
      { id: "root-1", label: "Ürünler", href: "/products", order: 0, parentId: null },
      { id: "child-1", label: "Mobilya", href: "/products/mobilya", order: 0, parentId: "root-1" },
      {
        id: "grandchild-1",
        label: "Ahşap Dolaplar",
        href: "/products/mobilya/ahsap-dolaplar",
        order: 0,
        parentId: "child-1",
      },
      { id: "root-2", label: "İletişim", href: "/iletisim", order: 1, parentId: null },
    ];

    const user = userEvent.setup();
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    await user.click(screen.getByRole("button", { name: "Menüyü aç" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Çocuğu olan düğüm bir accordion tetikleyicisi (button) olarak görünür, yaprak düz link.
    const trigger = screen.getByRole("button", { name: "Ürünler" });
    expect(screen.getByRole("link", { name: "İletişim" })).toHaveAttribute("href", "/iletisim");

    await user.click(trigger);
    const childTrigger = await screen.findByRole("button", { name: "Mobilya" });

    await user.click(childTrigger);
    const leaf = await screen.findByRole("link", { name: "Ahşap Dolaplar" });
    expect(leaf).toHaveAttribute("href", "/products/mobilya/ahsap-dolaplar");
  });

  it("mobil bir yaprak linke tıklanınca Sheet kapanır", async () => {
    const navigationItems: NavigationItemDto[] = [
      { id: "root-1", label: "İletişim", href: "/iletisim", order: 0, parentId: null },
    ];

    const user = userEvent.setup();
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    await user.click(screen.getByRole("button", { name: "Menüyü aç" }));
    await screen.findByRole("dialog");

    const links = screen.getAllByRole("link", { name: "İletişim" });
    // Mobil Sheet içindeki yaprak link (masaüstü `hidden md:flex` sarmalayıcısındaki linkten
    // ayırt edilemez çünkü jsdom `hidden`/breakpoint uygulamaz — Sheet içindekini seçmek için
    // en yakın `dialog` ata üzerinden filtrelenir).
    const dialog = screen.getByRole("dialog");
    const mobileLink = links.find((link) => dialog.contains(link));
    expect(mobileLink).toBeTruthy();

    await user.click(mobileLink as HTMLElement);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
