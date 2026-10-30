import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { SiteHeader } from "@/components/site/site-header";
import { SWIPE_CLOSE_THRESHOLD_PX } from "@/components/site/language-sheet";
import { navStrings as enNavStrings } from "@/lib/i18n/site-dictionaries/en/nav";
import { navStrings as arNavStrings } from "@/lib/i18n/site-dictionaries/ar/nav";
import type { Locale, NavigationItemDto, SiteSettings } from "@/lib/api/types";
import type { NavStrings } from "@/lib/i18n/site-dictionaries";

/**
 * Paket V (İş 2) — mobil dil seçici: header'daki bayrak düğmesi ve menüdeki tek satır aynı alt sayfayı
 * açar; 2 sütunlu ızgarada 9 dil, aktif dil işaretli; kapatma düğmesi, ESC, aşağı kaydırma; Arapça ad
 * `dir="rtl"` ile yalıtılır. Görsel düzen 360/390/430 px ekran görüntülerinde doğrulandı.
 */
const settings = { siteName: "WM Health", logoUrl: null, tagline: null, homePageId: null, siteTemplate: "SHOWCASE" } as unknown as SiteSettings;

const NATIVE: [string, string][] = [
  ["en", "English"],
  ["tr", "Türkçe"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["fr", "Français"],
  ["ar", "العربية"],
  ["ru", "Русский"],
  ["ro", "Română"],
  ["sr-latn", "Srpski (latinica)"],
];
const locales: Locale[] = NATIVE.map(([code, nativeLabel], i) => ({ code, label: nativeLabel, nativeLabel, isDefault: code === "tr", enabled: true, sortOrder: i, hreflang: null }));
const navigationItems: NavigationItemDto[] = [
  { id: "p", label: "Doctors", href: "/doctors", order: 0, parentId: null },
  { id: "b", label: "Blog", href: "/blog", order: 1, parentId: null },
];

function renderHeader(active = "en", dict: NavStrings = enNavStrings) {
  return render(
    <SiteHeader settings={settings} pages={[]} navigationItems={navigationItems} locales={locales} activeLocale={locales.find((l) => l.code === active)!} dict={dict} />
  );
}

describe("mobil dil seçici (alt sayfa)", () => {
  it("header bayrak düğmesi: erişilebilir ad aktif dil, aria-haspopup=dialog; alt sayfa 2 sütunlu ızgara, aktif dil işaretli", async () => {
    const user = userEvent.setup();
    renderHeader();
    const button = screen.getByTestId("mobile-language-button");
    expect(button).toHaveAccessibleName("Change language, current: English");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(button);

    const sheet = await screen.findByRole("dialog", { name: "Language" });
    const links = within(sheet).getAllByRole("link");
    expect(links).toHaveLength(9);
    expect(sheet.querySelector("ul")).toHaveClass("grid-cols-2");
    const english = within(sheet).getByRole("link", { name: /English/ });
    expect(english).toHaveAttribute("aria-current", "true");
    expect(within(sheet).getByRole("link", { name: /Türkçe/ })).not.toHaveAttribute("aria-current");
    // Alternates yokken mevcut davranış: o dilin ana sayfası (varsayılan TR öneksiz).
    expect(within(sheet).getByRole("link", { name: /Türkçe/ })).toHaveAttribute("href", "/");
    expect(within(sheet).getByRole("link", { name: /Deutsch/ })).toHaveAttribute("href", "/de");
    expect(within(sheet).getByRole("button", { name: "Close language selection" })).toBeInTheDocument();
  });

  it("Arapça yerel ad kendi dilinde ve yönünde yalıtılır (bdi dir=rtl lang=ar); satır başa hizalı kalır", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByTestId("mobile-language-button"));
    const sheet = await screen.findByRole("dialog");
    const arabic = within(sheet).getByText("العربية");
    expect(arabic.tagName).toBe("BDI");
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(arabic).toHaveAttribute("lang", "ar");
    expect(arabic.parentElement).toHaveClass("text-start");
    expect(arabic.parentElement).not.toHaveAttribute("dir");
  });

  it("menüdeki tek satır alt sayfayı açar; ESC kapatır", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = await screen.findByRole("dialog", { name: "Menu" });
    const row = within(menu).getByTestId("mobile-menu-language-row");
    expect(row).toHaveTextContent("English");
    await user.click(row);
    await screen.findByRole("dialog", { name: "Language" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("kapatma düğmesi kapatır; odak sayfa içinde kalır (Tab ile dışarı çıkmaz)", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByTestId("mobile-language-button"));
    const sheet = await screen.findByRole("dialog");
    for (let i = 0; i < 12; i++) {
      await user.tab();
      const el = document.activeElement;
      // Base UI'nin odak koruma öğesi (`data-type="inside"`) tuzağın parçasıdır; odağı yeniden sayfaya döndürür.
      expect(sheet.contains(el) || el?.getAttribute("data-type") === "inside", el?.outerHTML.slice(0, 80)).toBe(true);
    }
    await user.click(within(sheet).getByRole("button", { name: "Close language selection" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("aşağı kaydırma eşiği aşılınca kapanır; kısa sürükleme kapatmaz", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByTestId("mobile-language-button"));
    const drag = await screen.findByTestId("language-sheet-drag");
    fireEvent.pointerDown(drag, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(drag, { clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(drag, { clientY: 130, pointerId: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerDown(drag, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(drag, { clientY: 100 + SWIPE_CLOSE_THRESHOLD_PX + 20, pointerId: 1 });
    fireEvent.pointerUp(drag, { clientY: 100 + SWIPE_CLOSE_THRESHOLD_PX + 20, pointerId: 1 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Arapça arayüz: başlık ve düğme etiketleri sözlükten; menüdeki hekim bağlantısı yeni yol ve sözlük etiketi", async () => {
    const user = userEvent.setup();
    renderHeader("ar", arNavStrings);
    expect(screen.getByTestId("mobile-language-button")).toHaveAccessibleName(`${arNavStrings.languageButtonAria.replace("{language}", "العربية")}`);
    // Panelde "Doctors" kaydı (/doctors) sözlükteki etiketle ve yeni yolla görünür.
    expect(screen.getAllByRole("link", { name: arNavStrings.consultPhysicians })[0]).toHaveAttribute("href", "/ar/physicians");
    expect(screen.queryByRole("link", { name: "Doctors" })).toBeNull();
    await user.click(screen.getByTestId("mobile-language-button"));
    expect(await screen.findByRole("dialog", { name: arNavStrings.languageSheetTitle })).toBeInTheDocument();
  });

  it("açık alt sayfa erişilebilirlik ihlali içermez", async () => {
    const user = userEvent.setup();
    const { baseElement } = renderHeader();
    await user.click(screen.getByTestId("mobile-language-button"));
    await screen.findByRole("dialog");
    expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
