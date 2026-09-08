import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SiteHeader } from "@/components/site/site-header";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * GÖREV A (akıllı yapışkan menü) + GÖREV B (aktif sayfa tespiti) unit kapsamı — kapsamlı e2e
 * qa-agent'ın işi, burada makul bir birim testi bırakılıyor.
 */
const usePathnameMock = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

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

const navigationItems: NavigationItemDto[] = [
  { id: "root-1", label: "Ürünler", href: "/products", order: 0, parentId: null },
  { id: "child-1", label: "Ahşap Dolaplar", href: "/products/ahsap-dolaplar", order: 0, parentId: "root-1" },
  { id: "root-2", label: "İletişim", href: "/iletisim", order: 1, parentId: null },
];

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, writable: true, configurable: true });
}

beforeEach(() => {
  usePathnameMock.mockReset();
  setScrollY(0);
});

describe("SiteHeader — aktif sayfa tespiti (design-notes-header-colors.md §3)", () => {
  it("pathname bir düz nav linkiyle TAM eşleştiğinde aria-current='page' ve aktif renk sınıfı uygular", () => {
    usePathnameMock.mockReturnValue("/iletisim");
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    const activeLink = screen.getByRole("link", { name: "İletişim" });
    expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(activeLink.className).toContain("--site-header-link-active");

    const inactiveLink = screen.getByRole("button", { name: /Ürünler/ });
    expect(inactiveLink).not.toHaveAttribute("aria-current");
  });

  it("eşleşmeyen bir pathname'de hiçbir link aktif işaretlenmez", () => {
    usePathnameMock.mockReturnValue("/hakkimizda");
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    expect(screen.getByRole("link", { name: "İletişim" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: /Ürünler/ })).not.toHaveAttribute("aria-current");
  });

  it("alt öğesi (child) eşleşen bir dropdown tetikleyicisi de aktif sayılır (aria-current='page')", () => {
    usePathnameMock.mockReturnValue("/products/ahsap-dolaplar");
    render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);

    const trigger = screen.getByRole("button", { name: /Ürünler/ });
    expect(trigger).toHaveAttribute("aria-current", "page");
  });
});

describe("SiteHeader — akıllı yapışkan (smart sticky) davranışı (GÖREV A)", () => {
  it("stickyHeaderEnabled verilmezse (varsayılan false) header statik kalır — sticky/transform sınıfları YOK", () => {
    usePathnameMock.mockReturnValue("/products");
    const { container } = render(<SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} />);
    const header = container.querySelector("header")!;
    expect(header.className).not.toContain("sticky");
    expect(header.className).not.toContain("-translate-y-full");
  });

  it("stickyHeaderEnabled=true iken header 'sticky top-0' olur", () => {
    usePathnameMock.mockReturnValue("/products");
    const { container } = render(
      <SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} stickyHeaderEnabled />
    );
    const header = container.querySelector("header")!;
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
  });

  it("aşağı kaydırma (>120px) sonrası header gizlenir (-translate-y-full)", async () => {
    usePathnameMock.mockReturnValue("/products");
    const { container } = render(
      <SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} stickyHeaderEnabled />
    );
    const header = container.querySelector("header")!;

    setScrollY(50);
    fireEvent.scroll(window);
    setScrollY(200);
    fireEvent.scroll(window);

    await waitFor(() => expect(header.className).toContain("-translate-y-full"));
  });

  it("sayfanın ortasında yukarı kaydırma header'ı HEMEN geri getirir (scrollY===0'a dönmeden)", async () => {
    usePathnameMock.mockReturnValue("/products");
    const { container } = render(
      <SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} stickyHeaderEnabled />
    );
    const header = container.querySelector("header")!;

    setScrollY(50);
    fireEvent.scroll(window);
    setScrollY(400);
    fireEvent.scroll(window);
    await waitFor(() => expect(header.className).toContain("-translate-y-full"));

    // Sayfanın ortasındayken (400 → 300, hâlâ scrollY 0'dan ÇOK uzak) yukarı kaydırma.
    setScrollY(300);
    fireEvent.scroll(window);

    await waitFor(() => expect(header.className).toContain("translate-y-0"));
    expect(header.className).not.toContain("-translate-y-full");
  });

  it("scrollY > 20 iken (sticky durum) hafif gölge (shadow-sm) eklenir", async () => {
    usePathnameMock.mockReturnValue("/products");
    const { container } = render(
      <SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} stickyHeaderEnabled />
    );
    const header = container.querySelector("header")!;

    setScrollY(40);
    fireEvent.scroll(window);

    await waitFor(() => expect(header.className).toContain("shadow-sm"));
  });
});
