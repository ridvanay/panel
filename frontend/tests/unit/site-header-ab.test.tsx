import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * Paket AB — iki katlı header: üst bilgi şeridi (destek dilleri, tercüman, destek bağlantısı, dil, giriş),
 * ana bar (logo · menü · "Find my physician" + "Appointment"), ölçüme dayalı düzen (tam → dar → More),
 * kaydırmada üst şeridin gizlenmesi / ana barın küçülmesi (sticky top + transform; CLS yok), 9 dil sözlük.
 * Gerçek tarayıcı ölçümleri (9 dil × 1024/1280/1440/1920) raporda.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/about", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => p,
}));

import { SiteHeader } from "@/components/site/site-header";
import { computeDesktopNavLayout, NAV_GAP_COMPACT, NAV_GAP_FULL } from "@/components/site/header/use-desktop-nav-layout";
import { navStrings as en } from "@/lib/i18n/site-dictionaries/en/nav";

const settings = { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings;
const nav = (id: string, label: string, href: string, order: number, parentId: string | null = null): NavigationItemDto =>
  ({ id, label, href, order, parentId }) as NavigationItemDto;
const items = [nav("h", "Home", "/", 0), nav("a", "About", "/about", 1), nav("s", "Specialties", "/specialties", 2), nav("s1", "Obesity and Metabolic Surgery", "/specialties/obesity", 0, "s"), nav("c", "Contact", "/contact", 3)];

function renderHeader(extra: Partial<Parameters<typeof SiteHeader>[0]> = {}) {
  return render(
    <SiteHeader
      settings={settings}
      pages={[]}
      navigationItems={items}
      ctaLabel="Appointment"
      ctaHref="/physicians"
      dict={en}
      telehealthModuleEnabled
      support={{ count: 9, interpreterIncluded: true }}
      {...extra}
    />
  );
}

beforeEach(() => {
  window.scrollY = 0;
});

describe("üst bilgi şeridi", () => {
  it("destek dilleri + ücretsiz tercüman (ayara bağlı), destek bağlantısı, giriş", () => {
    renderHeader();
    const topbar = screen.getByTestId("site-header-topbar");
    expect(topbar).toHaveClass("hidden", "lg:block", "h-9");
    expect(within(topbar).getByTestId("site-header-support")).toHaveTextContent("Support in 9 languages · Free interpreter");
    expect(within(topbar).getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/contact");
    expect(within(topbar).getByRole("group", { name: "Support and account" })).toBeInTheDocument();
    expect(within(topbar).getByRole("link", { name: en.loginAriaLabel })).toBeInTheDocument();
  });

  it("ayar kapalıysa destek metni gizlenir; tercüman dahil değilse yalnızca dil sayısı", () => {
    const { unmount } = renderHeader({ support: null });
    expect(screen.queryByTestId("site-header-support")).not.toBeInTheDocument();
    unmount();
    renderHeader({ support: { count: 3, interpreterIncluded: false } });
    expect(screen.getByTestId("site-header-support")).toHaveTextContent(/^Support in 3 languages$/);
  });
});

describe("ana bar", () => {
  it("menü ortada, aria-current; sağda ikincil 'Find my physician' (ikon + ad) ve birincil 'Appointment'", () => {
    renderHeader();
    const desktop = screen.getByTestId("site-header-desktop");
    expect(within(desktop).getByRole("link", { name: "About" })).toHaveAttribute("aria-current", "page");
    const actions = screen.getByTestId("site-header-actions");
    const find = within(actions).getByTestId("matcher-launch");
    expect(find).toHaveAccessibleName("Find my physician");
    // Ölçülmemişken (SSR/jsdom) kırılım: 1280 altında yalnızca ikon.
    expect(find.className).toContain("xl:w-auto");
    expect(within(actions).getByRole("link", { name: "Appointment" })).toHaveAttribute("href", "/physicians");
  });

  it("ölçüm kabı erişilebilirlik ağacı dışında; her menü öğesi, More, iki düğme ölçülür", () => {
    renderHeader();
    const box = screen.getByTestId("site-header-measure");
    expect(box.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(box.querySelectorAll("[data-measure='item']")).toHaveLength(4);
    for (const key of ["more", "find-full", "find-icon", "cta"]) expect(box.querySelector(`[data-measure='${key}']`)).not.toBeNull();
  });

  it("kaydırınca üst şerit gizlenir (sticky top −36 → −52) ve ana bar küçülür; geri gelince eski haline döner", () => {
    const { container } = renderHeader();
    const header = container.querySelector("header")!;
    expect(header.style.getPropertyValue("--site-header-top")).toBe("-36px");
    act(() => {
      window.scrollY = 300;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(header).toHaveAttribute("data-scrolled", "true");
    expect(header.style.getPropertyValue("--site-header-top")).toBe("-52px");
    expect(header.className).toContain("lg:shadow-sm");
    act(() => {
      window.scrollY = 0;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(header).not.toHaveAttribute("data-scrolled");
  });

  it("mobil menünün en üstünde belirgin 'Find my physician' düğmesi", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: en.openMenu }));
    const find = await screen.findByTestId("mobile-menu-find-physician");
    expect(find).toHaveAttribute("href", "/find-a-physician");
    const panel = find.parentElement!;
    expect(panel.firstElementChild).toBe(find);
  });
});

describe("ölçüme dayalı düzen kararı (computeDesktopNavLayout)", () => {
  const base = { itemWidths: [60, 70, 150, 110, 70], findFull: 200, findIcon: 44, cta: 160, more: 60 };
  const menu = (w: number[], gap: number) => w.reduce((a, b) => a + b, 0) + (w.length - 1) * gap;

  it("yeterli genişlikte tam düzen; biraz darda kompakt (ikon düğme); daha darda sondaki öğeler More'a", () => {
    const full = menu(base.itemWidths, NAV_GAP_FULL) + base.findFull + 8 + base.cta + 48;
    expect(computeDesktopNavLayout({ ...base, available: full })).toEqual({ mode: "full", overflowCount: 0 });
    expect(computeDesktopNavLayout({ ...base, available: full - 1 })).toEqual({ mode: "compact", overflowCount: 0 });
    const compact = menu(base.itemWidths, NAV_GAP_COMPACT) + base.findIcon + 8 + base.cta + 48;
    const r = computeDesktopNavLayout({ ...base, available: compact - 1 });
    expect(r).toEqual({ mode: "compact", overflowCount: 1 });
    expect(computeDesktopNavLayout({ ...base, available: 100 }).overflowCount).toBe(base.itemWidths.length - 1);
  });

  it("telehealth kapalıysa (Find yok) ve CTA yoksa düğme payı düşülmez", () => {
    const w = menu(base.itemWidths, NAV_GAP_FULL) + 48;
    expect(computeDesktopNavLayout({ ...base, findFull: 0, findIcon: 0, cta: 0, available: w })).toEqual({ mode: "full", overflowCount: 0 });
  });
});

describe("sözlük (9 dil) ve kaynak kuralları", () => {
  it("yeni nav anahtarları 9 dilde dolu; {count} yer tutucusu korunmuş", async () => {
    for (const lang of ["en", "tr", "de", "fr", "es", "ru", "ar", "ro", "sr-latn"]) {
      const { navStrings } = await import(`@/lib/i18n/site-dictionaries/${lang}/nav`);
      for (const key of ["topbarSupport", "topbarInterpreter", "topbarContact", "moreMenu", "topbarAriaLabel"]) {
        expect((navStrings as Record<string, string>)[key]?.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      }
      expect((navStrings as Record<string, string>).topbarSupport).toContain("{count}");
    }
  });

  it("CLS'siz küçülme: yükseklik değil sticky top + transform; ResizeObserver ile ölçüm; reduced-motion", () => {
    const src = readFileSync(resolve(__dirname, "../../src/components/site/site-header.tsx"), "utf8");
    expect(src).toContain('"--site-header-top": scrolled ? "-52px" : "-36px"');
    expect(src).toContain("lg:group-data-[scrolled=true]/header:translate-y-2");
    expect(src).toContain("motion-reduce:transition-none");
    const hook = readFileSync(resolve(__dirname, "../../src/components/site/header/use-desktop-nav-layout.ts"), "utf8");
    expect(hook).toContain("new ResizeObserver(measure)");
  });
});
