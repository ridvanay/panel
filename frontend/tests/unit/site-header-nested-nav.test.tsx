import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SiteHeader } from "@/components/site/site-header";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

const settings: SiteSettings = { siteName: "Örnek Site", logoUrl: null, homePageId: null, siteTemplate: "SHOWCASE" };

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
});
