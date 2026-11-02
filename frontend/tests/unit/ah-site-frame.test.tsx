import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * Paket AH (Faz 1, FE1) — site çerçevesi: header (menü verisi + "Request a consultation" + üst şerit ibaresi),
 * "Health Tourism Services" açılır menüsünün aktif bölümlerle otomatik dolması, footer ibaresi/belge satırı,
 * eski Türkçe footer verisinin değiştirilmesi, kurum JSON-LD'si, meta description, kapalı dil yönlendirmesi.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => p,
}));

import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { isSpecialtiesListHref, specialtiesToNavChildren } from "@/components/site/nav-dropdown";
import { navStrings as en } from "@/lib/i18n/site-dictionaries/en/nav";
import { intermediaryStrings } from "@/lib/i18n/site-dictionaries/en/intermediary";
import { buildOrganizationJsonLd } from "@/lib/page-builder/structured-data";
import { intermediaryMetaDescription } from "@/lib/seo/intermediary-meta";
import { removedLocaleRedirectPath } from "@/lib/i18n/removed-locale-path";
import { legacyFooterTitleKey, looksTurkish } from "@/lib/legacy-turkish-text";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";

const settings = { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings;
const nav = (id: string, label: string, href: string, order: number): NavigationItemDto =>
  ({ id, label, href, order, parentId: null }) as NavigationItemDto;
const items = [
  nav("h", "Home", "/", 0),
  nav("a", "About", "/about", 1),
  nav("s", "Health Tourism Services", "/specialties", 2),
  nav("v", "VIP Accommodation & Transfer", "/vip-accommodation-transfer", 3),
  nav("c", "Contact", "/contact", 4),
];
const SPECIALTIES = [
  { slug: "gastroenterology", name: "Gastroenterology", icon: "Stethoscope", imageUrl: null, parentSlug: null },
  { slug: "obesity-surgery", name: "Obesity Surgery", icon: "Stethoscope", imageUrl: null, parentSlug: "gastroenterology" },
  { slug: "dermatology", name: "Dermatology", icon: "Stethoscope", imageUrl: null, parentSlug: null },
];

function renderHeader(extra: Partial<Parameters<typeof SiteHeader>[0]> = {}) {
  return render(
    <SiteHeader
      settings={settings}
      pages={[]}
      navigationItems={items}
      ctaLabel="Appointment"
      ctaHref="/request"
      dict={en}
      navSpecialties={SPECIALTIES}
      intermediary={{ shortLabel: intermediaryStrings.shortLabel, facilitiesLink: intermediaryStrings.facilitiesLink }}
      {...extra}
    />
  );
}

describe("header — menü ve düğmeler", () => {
  it("5 öğe; 'Find my physician' yok; 'Find your treatment' sihirbaza, 'Appointment' talep formuna gider", () => {
    renderHeader({ telehealthModuleEnabled: true });
    const desktop = screen.getByTestId("site-header-desktop");
    expect(within(desktop).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(desktop).getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(within(desktop).getByRole("button", { name: /Health Tourism Services/ })).toBeInTheDocument();
    expect(within(desktop).getByRole("link", { name: "VIP Accommodation & Transfer" })).toHaveAttribute("href", "/vip-accommodation-transfer");
    expect(within(desktop).getByRole("link", { name: "Contact" })).toBeInTheDocument();
    const actions = screen.getByTestId("site-header-actions");
    expect(within(actions).queryByText(/Find my physician/i)).not.toBeInTheDocument();
    expect(within(actions).getByRole("link", { name: "Find your treatment" })).toHaveAttribute("href", "/find-your-treatment");
    expect(within(actions).getByRole("link", { name: "Appointment" })).toHaveAttribute("href", "/request");
  });

  it("'Find your treatment' telehealth modülü kapalıyken de görünür", () => {
    renderHeader({ telehealthModuleEnabled: false });
    expect(screen.getByTestId("header-find-treatment")).toBeInTheDocument();
  });

  it("üst şerit: kısa ibare + 'Treatments by authorized healthcare facilities' → /about#authorized-facilities", () => {
    renderHeader();
    const bar = screen.getByTestId("site-header-intermediary");
    expect(bar).toHaveTextContent("International Health Tourism Intermediary");
    expect(within(bar).getByRole("link", { name: "Treatments by authorized healthcare facilities" })).toHaveAttribute(
      "href",
      "/about#authorized-facilities"
    );
  });

  it("'Health Tourism Services' açılır menüsü aktif bölümlerle dolar (alt bölüm üst bölümün 'Procedures' satırında) ve 'All services' → /specialties", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: /Health Tourism Services/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Gastroenterology" })).toHaveAttribute("href", "/specialties/gastroenterology");
    expect(within(menu).getByRole("menuitem", { name: "Dermatology" })).toHaveAttribute("href", "/specialties/dermatology");
    // Alt bölüm ayrı kart değil, Gastroenterology altında "Procedures" satırında.
    const procedures = within(menu).getByTestId("nav-procedures");
    expect(within(procedures).getByRole("menuitem", { name: "Obesity Surgery" })).toHaveAttribute("href", "/specialties/obesity-surgery");
    expect(within(menu).getByRole("menuitem", { name: "View all services" })).toHaveAttribute("href", "/specialties");
    expect(within(menu).queryByRole("menuitem", { name: /physician|doctor/i })).not.toBeInTheDocument();
  });

  it("veride zaten alt öğe varsa otomatik doldurma verinin yerine geçmez", async () => {
    const user = userEvent.setup();
    const child = { id: "x", label: "Custom Child", href: "/specialties/custom", order: 0, parentId: "s" } as NavigationItemDto;
    renderHeader({ navigationItems: [...items, child] });
    await user.click(screen.getByRole("button", { name: /Health Tourism Services/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Custom Child" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Dermatology" })).not.toBeInTheDocument();
  });

  it("aktif bölüm yoksa (modül kapalı/boş liste) 'Health Tourism Services' düz bağlantı olarak kalır", () => {
    renderHeader({ navSpecialties: [] });
    expect(within(screen.getByTestId("site-header-desktop")).getByRole("link", { name: "Health Tourism Services" })).toHaveAttribute(
      "href",
      "/specialties"
    );
  });

  it("yardımcılar: /specialties tanıma (dil öneki, sondaki /) ve üst→alt sıralama", () => {
    expect(isSpecialtiesListHref("/specialties")).toBe(true);
    expect(isSpecialtiesListHref("/en/specialties/")).toBe(true);
    expect(isSpecialtiesListHref("/specialties/gastroenterology")).toBe(false);
    expect(isSpecialtiesListHref("https://x.test/specialties")).toBe(false);
    expect(specialtiesToNavChildren(SPECIALTIES).map((c) => c.href)).toEqual([
      "/specialties/gastroenterology",
      "/specialties/dermatology",
      "/specialties/obesity-surgery",
    ]);
  });
});

describe("footer — kimlik ibaresi ve belge satırı", () => {
  const labels = {
    allRightsReserved: en.footerAllRightsReserved,
    servicesHeading: en.footerServicesHeading,
    legalHeading: en.footerLegalHeading,
    navAria: en.footerNavAria,
  };

  it("logo altında kısa ibare + açıklama; belge numarası boşken belge satırı YOK", () => {
    render(<SiteFooter siteName="WM Health" intermediary={intermediaryStrings} certificateNo={null} labels={labels} />);
    const box = screen.getByTestId("footer-intermediary");
    expect(box).toHaveTextContent("International Health Tourism Intermediary");
    expect(box).toHaveTextContent("not a healthcare provider");
    expect(screen.queryByTestId("footer-certificate")).not.toBeInTheDocument();
  });

  it("belge numarası doluyken satır görünür; boşluk dizesi sayılmaz", () => {
    const { unmount } = render(<SiteFooter siteName="WM Health" intermediary={intermediaryStrings} certificateNo="TR-12345" labels={labels} />);
    expect(screen.getByTestId("footer-certificate")).toHaveTextContent("Health Tourism Authorization Certificate No: TR-12345");
    unmount();
    render(<SiteFooter siteName="WM Health" intermediary={intermediaryStrings} certificateNo="   " labels={labels} />);
    expect(screen.queryByTestId("footer-certificate")).not.toBeInTheDocument();
  });

  it("DB'deki eski Türkçe telif satırı, sütun başlıkları ve slogan ziyaretçiye gösterilmez; yerine EN sözlük metni", () => {
    render(
      <SiteFooter
        siteName="WM Health"
        tagline="Tüm hekimler ve uzmanlar için"
        copyrightText="© 2026 WM Health. Tüm hakları saklıdır."
        footerColumns={
          [
            { id: "c1", title: "Branşlar", links: [{ id: "l1", label: "Gastroenterology", href: "/specialties/gastroenterology" }] },
            { id: "c2", title: "Yasal", links: [{ id: "l2", label: "Privacy Notice", href: "/privacy" }] },
          ] as never
        }
        intermediary={intermediaryStrings}
        labels={labels}
      />
    );
    expect(screen.queryByText(/Tüm hakları/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tüm hekimler/)).not.toBeInTheDocument();
    expect(screen.queryByText("Branşlar")).not.toBeInTheDocument();
    expect(screen.queryByText("Yasal")).not.toBeInTheDocument();
    expect(screen.getByText("Health Tourism Services")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(screen.getByText(/All rights reserved\./)).toBeInTheDocument();
  });

  it("Türkçe olmayan (DB'den gelen) telif satırı olduğu gibi korunur", () => {
    render(<SiteFooter siteName="WM Health" copyrightText="© 2026 WM Health GmbH" labels={labels} />);
    expect(screen.getByText("© 2026 WM Health GmbH")).toBeInTheDocument();
  });
});

describe("Türkçe tespit yardımcıları", () => {
  it("Türkçeye özgü harf ve sözcükleri yakalar; Almanca/Romence/Fransızca metni yakalamaz", () => {
    expect(looksTurkish("Tüm hakları saklıdır")).toBe(true);
    expect(looksTurkish("Hekime danışın ve randevu alın")).toBe(true);
    expect(looksTurkish("Datenschutzerklärung für Besucher")).toBe(false);
    expect(looksTurkish("Politica de confidențialitate și cookie-uri")).toBe(false);
    expect(looksTurkish("Mentions légales et conditions générales")).toBe(false);
    expect(looksTurkish(null)).toBe(false);
    expect(legacyFooterTitleKey("Branşlar")).toBe("servicesHeading");
    expect(legacyFooterTitleKey(" YASAL ")).toBe("legalHeading");
    expect(legacyFooterTitleKey("Company")).toBeNull();
  });
});

describe("kurum JSON-LD ve meta description", () => {
  it("kurum tipi Organization/TravelAgency; MedicalOrganization/Physician/reviewedBy yok; açıklama aracı kuruluş metni", () => {
    const raw = buildOrganizationJsonLd(settings, [], "https://wmhealth.test", [], intermediaryStrings.description);
    const json = JSON.parse(raw);
    expect(json["@type"]).toEqual(["Organization", "TravelAgency"]);
    expect(json.description).toContain("not a healthcare provider");
    expect(raw).not.toMatch(/MedicalOrganization|MedicalClinic|Physician|reviewedBy/);
  });

  it("meta description = aracı kuruluş açıklamasının ilk cümlesi (EN) ve diğer dillerde makul uzunlukta", () => {
    expect(intermediaryMetaDescription(intermediaryStrings.description)).toBe(
      "WM Health is an international health tourism intermediary organization, not a healthcare provider."
    );
    for (const dict of [de, ar, ro]) {
      const short = intermediaryMetaDescription(dict.intermediary.description);
      expect(short.length).toBeGreaterThan(20);
      expect(short.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("kapatılan Türkçe — yol yönlendirmesi", () => {
  const enabled = new Set(["en", "de", "ar"]);

  it("/tr ve /tr/* varsayılan dildeki (önek yok) karşılığına gider", () => {
    expect(removedLocaleRedirectPath("/tr", enabled)).toBe("/");
    expect(removedLocaleRedirectPath("/tr/", enabled)).toBe("/");
    expect(removedLocaleRedirectPath("/tr/about", enabled)).toBe("/about");
    expect(removedLocaleRedirectPath("/tr/blog/bir-yazi", enabled)).toBe("/blog/bir-yazi");
    expect(removedLocaleRedirectPath("/tr/specialties/gastroenterology", enabled)).toBe("/specialties/gastroenterology");
  });

  it("tr ile başlayan başka yollara ve açık dillere dokunmaz; Türkçe yeniden açılırsa kural devre dışı", () => {
    expect(removedLocaleRedirectPath("/travel", enabled)).toBeNull();
    expect(removedLocaleRedirectPath("/trust", enabled)).toBeNull();
    expect(removedLocaleRedirectPath("/de/about", enabled)).toBeNull();
    expect(removedLocaleRedirectPath("/about", enabled)).toBeNull();
    expect(removedLocaleRedirectPath("/tr/about", new Set(["tr", "en"]))).toBeNull();
  });

  it("protokol-göreli açık yönlendirme üretmez (/tr//evil.example)", () => {
    expect(removedLocaleRedirectPath("/tr//evil.example", enabled)).toBe("/evil.example");
    expect(removedLocaleRedirectPath("/tr///evil.example/x", enabled)).toBe("/evil.example/x");
  });
});
