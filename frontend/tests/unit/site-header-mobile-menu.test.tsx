import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SiteHeader } from "@/components/site/site-header";
import { navStrings as enNavStrings } from "@/lib/i18n/site-dictionaries/en/nav";
import type { Locale, NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * lg altı (mobil/tablet) hamburger + sağdan açılan panel ve masaüstü açılır menü genişliği.
 * jsdom CSS uygulamadığı için görünürlük (`hidden lg:flex`) burada değil, Playwright ekran
 * görüntüsü kontrollerinde doğrulanır; burada davranış ve erişilebilirlik öznitelikleri test edilir.
 */
const settings: SiteSettings = {
  siteName: "WM Health",
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
  demoPaymentsEnabled: false,
  demoPaymentsSupported: false,
};

const LONG_LABEL = "Plastic, Reconstructive and Aesthetic Surgery";
const navigationItems: NavigationItemDto[] = [
  { id: "home", label: "Home", href: "/", order: 0, parentId: null },
  { id: "spec", label: "Specialties", href: "/specialties", order: 1, parentId: null },
  { id: "c1", label: "Obesity and Metabolic Surgery", href: "/specialties/obesity", order: 0, parentId: "spec" },
  { id: "c2", label: LONG_LABEL, href: "/specialties/plastic", order: 1, parentId: "spec" },
  { id: "about", label: "About Us", href: "/about", order: 2, parentId: null },
];

const locales: Locale[] = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
];

function renderHeader() {
  return render(
    <SiteHeader
      settings={settings}
      pages={[]}
      navigationItems={navigationItems}
      ctaLabel="Appointment"
      ctaHref="/doctors"
      locales={locales}
      activeLocale={locales[0]}
      dict={enNavStrings}
    />
  );
}

describe("SiteHeader — mobil menü (lg altı)", () => {
  it("hamburger düğmesi aria-label, aria-expanded ve aria-controls taşır; panel kapalıyken DOM'da yok", () => {
    renderHeader();
    const burger = screen.getByRole("button", { name: "Open menu" });
    expect(burger).toHaveAttribute("aria-expanded", "false");
    expect(burger).toHaveAttribute("aria-controls", "site-mobile-menu");
    expect(document.getElementById("site-mobile-menu")).toBeNull();
  });

  it("mobil CTA gizlenmez — başlıkta hamburger'ın yanında gerçek bir link olarak durur", () => {
    renderHeader();
    const ctas = screen.getAllByRole("link", { name: "Appointment" });
    // Masaüstü (lg:flex) ve mobil (lg:hidden) kopyaları — CSS ile yalnızca biri görünür.
    expect(ctas).toHaveLength(2);
    ctas.forEach((cta) => expect(cta).toHaveAttribute("href", "/doctors"));
  });

  it("panel açılınca menü öğeleri, akordeon, dil listesi ve giriş linki görünür; Esc kapatır ve odak düğmeye döner", async () => {
    const user = userEvent.setup();
    renderHeader();
    const burger = screen.getByRole("button", { name: "Open menu" });
    await user.click(burger);

    const panel = await screen.findByRole("dialog", { name: "Menu" });
    expect(panel).toHaveAttribute("id", "site-mobile-menu");
    expect(burger).toHaveAttribute("aria-expanded", "true");
    expect(burger).toHaveAccessibleName("Close menu");

    const p = within(panel);
    expect(p.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(p.getByRole("link", { name: "About Us" })).toHaveAttribute("href", "/about");
    // Dil seçici panel içinde düz liste; giriş linki hesap bölümünde.
    expect(p.getByRole("link", { name: /Türkçe/ })).toHaveAttribute("href", "/tr");
    expect(p.getByRole("link", { name: "Sign In" })).toBeInTheDocument();

    // Alt menülü öğe akordeon: kapalı başlar, tıklayınca alt öğeler görünür.
    const accordion = p.getByRole("button", { name: /Specialties/ });
    expect(accordion).toHaveAttribute("aria-expanded", "false");
    await user.click(accordion);
    expect(accordion).toHaveAttribute("aria-expanded", "true");
    expect(p.getByRole("link", { name: LONG_LABEL })).toHaveAttribute("href", "/specialties/plastic");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(burger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(burger).toHaveFocus());
  });

  it("paneldeki kapat düğmesi paneli kapatır", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = await screen.findByRole("dialog", { name: "Menu" });
    await user.click(within(panel).getByRole("button", { name: "Close menu" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("açık panel erişilebilirlik ihlali içermez", async () => {
    const user = userEvent.setup();
    const { baseElement } = renderHeader();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog", { name: "Menu" });
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe("SiteHeader — masaüstü açılır menü", () => {
  it("menü genişliği tetikleyiciye bağlı değil; öğeler 2 satırla sınırlı ve tam metin title'da", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: /^Specialties/ }));
    const item = await screen.findByRole("menuitem", { name: LONG_LABEL });
    expect(item).toHaveAttribute("title", LONG_LABEL);
    expect(item.querySelector("span.line-clamp-2")).toHaveTextContent(LONG_LABEL);
    // Yeni açılır panel (nav-dropdown.tsx): genişlik içerik/kolon sayısına göre sabit, tetikleyiciye bağlı değil.
    const content = item.closest("[data-slot=nav-dropdown]");
    expect(content).not.toBeNull();
    expect(content?.className).not.toContain("--anchor-width");
  });
});
