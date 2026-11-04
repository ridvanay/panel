import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * Paket AK (K4) — panelden açılıp kapanan iki özellik: `findTreatmentEnabled` ("Find your treatment") ve
 * `bookConsultationCtaEnabled` ("Book a consultation"). Açıkken bugünkü davranış; kapalıyken giriş noktaları gizlenir,
 * ikincil "Request a call back" / "Request" düğmeleri kalır. `serviceBookingEnabled` mantığı ayrı kalır.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => `/en${p}`,
}));
vi.mock("@/components/site/packages/package-inquiry-form", () => ({ PackageInquiryForm: () => null, focusPackageInquiryForm: () => undefined }));

import { SiteHeader } from "@/components/site/site-header";
import { ServicesMegaMenu } from "@/components/site/services-mega-menu";
import { ServiceCard } from "@/components/site/services/service-card";
import { PackageDetailActions } from "@/components/site/packages/package-detail-actions";
import { ContactChannelsProvider } from "@/components/site/contact/contact-channels-context";
import { ServiceBookingProvider } from "@/components/site/service-booking/service-booking-context";
import { SiteFeaturesProvider } from "@/components/site/site-features-context";
import { MatcherCtaCard, MatcherHeroSearch, MatcherLaunchButton, MatcherModalProvider } from "@/components/site/matcher/matcher-modal";
import { VipPageContent } from "@/components/site/vip/vip-page-content";
import { SiteFooter } from "@/components/site/site-footer";
import { computeDesktopNavLayout } from "@/components/site/header/use-desktop-nav-layout";
import { navStrings as enNav } from "@/lib/i18n/site-dictionaries/en/nav";
import { servicesStrings as en } from "@/lib/i18n/site-dictionaries/en/services";
import { vipStrings } from "@/lib/i18n/site-dictionaries/en/vip";
import { intermediaryStrings } from "@/lib/i18n/site-dictionaries/en/intermediary";
import { contactStrings } from "@/lib/i18n/site-dictionaries/en/contact";
import { resolveSiteFeatures } from "@/lib/site-features";

const ON = { findTreatmentEnabled: true, bookConsultationCtaEnabled: true };
const FIND_OFF = { findTreatmentEnabled: false, bookConsultationCtaEnabled: true };
const BOOK_OFF = { findTreatmentEnabled: true, bookConsultationCtaEnabled: false };
const BOTH_OFF = { findTreatmentEnabled: false, bookConsultationCtaEnabled: false };

function features(f: typeof ON, ui: React.ReactElement, bookingEnabled = false) {
  return (
    <ServiceBookingProvider enabled={bookingEnabled} callbackLabel="Request a call back" bookLabel="Book an online consultation">
      <SiteFeaturesProvider {...f}>{ui}</SiteFeaturesProvider>
    </ServiceBookingProvider>
  );
}

describe("resolveSiteFeatures", () => {
  it("alan yoksa / ayar okunamadıysa ikisi de AÇIK; yalnızca açık false kapatır", () => {
    expect(resolveSiteFeatures(undefined)).toEqual(ON);
    expect(resolveSiteFeatures(null)).toEqual(ON);
    expect(resolveSiteFeatures({})).toEqual(ON);
    expect(resolveSiteFeatures({ findTreatmentEnabled: false })).toEqual(FIND_OFF);
    expect(resolveSiteFeatures({ bookConsultationCtaEnabled: false })).toEqual(BOOK_OFF);
  });
});

describe("header (masaüstü ve mobil)", () => {
  const settings = { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings;
  const nav = (id: string, label: string, href: string, order: number): NavigationItemDto => ({ id, label, href, order, parentId: null }) as NavigationItemDto;
  const items = [nav("a", "About", "/about", 0), nav("c", "Contact", "/contact", 1)];
  const header = () => (
    <div className="site-scope">
      <SiteHeader settings={settings} pages={[]} navigationItems={items} ctaLabel="Appointment" ctaHref="/request" dict={enNav} services={en} />
    </div>
  );

  it("provider yokken (eski davranış) iki düğme de var", () => {
    render(header());
    expect(screen.getByTestId("header-find-treatment")).toBeInTheDocument();
    expect(screen.getByTestId("header-book-consultation")).toBeInTheDocument();
  });

  it("ikisi de açık: iki düğme + ölçüm kabında iki ölçüm öğesi", () => {
    render(features(ON, header()));
    const actions = screen.getByTestId("site-header-actions");
    expect(within(actions).getByTestId("header-find-treatment")).toBeInTheDocument();
    expect(within(actions).getByTestId("header-book-consultation")).toBeInTheDocument();
    const measure = screen.getByTestId("site-header-measure");
    expect(measure.querySelector("[data-measure='find-full']")).not.toBeNull();
    expect(measure.querySelector("[data-measure='cta']")).not.toBeNull();
  });

  it("Find kapalı: Find düğmesi ve ölçüm öğeleri yok, Book kalır", () => {
    render(features(FIND_OFF, header()));
    const actions = screen.getByTestId("site-header-actions");
    expect(within(actions).queryByTestId("header-find-treatment")).toBeNull();
    expect(within(actions).getByTestId("header-book-consultation")).toBeInTheDocument();
    const measure = screen.getByTestId("site-header-measure");
    expect(measure.querySelector("[data-measure='find-full']")).toBeNull();
    expect(measure.querySelector("[data-measure='find-icon']")).toBeNull();
  });

  it("Book kapalı: header CTA'sı (ayarı ne olursa olsun) yok, Find kalır", () => {
    render(features(BOOK_OFF, header()));
    expect(screen.getByTestId("header-find-treatment")).toBeInTheDocument();
    expect(screen.queryByTestId("header-book-consultation")).toBeNull();
    expect(screen.getByTestId("site-header-measure").querySelector("[data-measure='cta']")).toBeNull();
  });

  it("ikisi de kapalı: sağ eylem kabı hiç çizilmez (boşluk/taşma yok), menü yerleşir", () => {
    render(features(BOTH_OFF, header()));
    expect(screen.queryByTestId("site-header-actions")).toBeNull();
    expect(screen.getByTestId("site-header-desktop")).toBeInTheDocument();
    const measure = screen.getByTestId("site-header-measure");
    expect(measure.querySelector("[data-measure='find-full'], [data-measure='cta']")).toBeNull();
  });

  it("mobil: Book kapalıyken çubuktaki CTA ve menüdeki Book yok; Find kapalıyken menüdeki Find yok", async () => {
    const user = userEvent.setup();
    const { unmount } = render(features(BOTH_OFF, header()));
    // mobil çubuk CTA'sı yok (masaüstü kabı da yok): hiçbir "Appointment" bağlantısı kalmaz
    expect(screen.queryByRole("link", { name: "Book a consultation" })).toBeNull();
    await user.click(screen.getByRole("button", { name: enNav.openMenu }));
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("mobile-menu-find-treatment")).toBeNull();
    expect(screen.queryByTestId("mobile-menu-book-consultation")).toBeNull();
    unmount();

    render(features(ON, header()));
    await user.click(screen.getByRole("button", { name: enNav.openMenu }));
    expect(await screen.findByTestId("mobile-menu-find-treatment")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-menu-book-consultation")).toBeInTheDocument();
  });

  it("ölçüm: Find yoksa (genişlik 0) yalnızca CTA hesaba katılır; ikisi de yoksa menü tam düzende sığar", () => {
    const base = { available: 1200, itemWidths: [60, 60, 60], findFull: 0, findIcon: 0, more: 40 };
    expect(computeDesktopNavLayout({ ...base, cta: 150 })).toEqual({ mode: "full", overflowCount: 0 });
    expect(computeDesktopNavLayout({ ...base, cta: 0 })).toEqual({ mode: "full", overflowCount: 0 });
  });
});

describe("mega menü sağ paneli", () => {
  function renderMenu(f: typeof ON) {
    render(
      features(
        f,
        <ContactChannelsProvider value={{ whatsapp: null, chatEnabled: false, contactHref: "/contact" }}>
          <ServicesMegaMenu
            link={{ id: "s", href: "/specialties", label: "Health Tourism Services" }}
            localize={(p) => `/en${p}`}
            active={false}
            specialties={[{ slug: "dental", name: "Dental Care", icon: "Smile", imageUrl: null, parentSlug: null, serviceGroup: null, shortDescription: null }]}
            strings={en}
            contactTopic="WM Health"
            triggerClassName="text-foreground"
            activeTriggerClassName="text-primary"
          />
        </ContactChannelsProvider>
      )
    );
  }

  async function open(f: typeof ON) {
    renderMenu(f);
    await userEvent.setup().click(screen.getByRole("button", { name: /^Health Tourism Services/ }));
    return within(await screen.findByTestId("services-mega-panel"));
  }

  it("ikisi de kapalı ve WhatsApp yok: sağ panel hiç çizilmez (boş sütun kalmaz)", async () => {
    renderMenu(BOTH_OFF);
    await userEvent.setup().click(screen.getByRole("button", { name: /^Health Tourism Services/ }));
    await screen.findByRole("menuitem", { name: /Dental Care/ });
    expect(screen.queryByTestId("services-mega-panel")).toBeNull();
  });

  it("ikisi de açık: iki bağlantı", async () => {
    const panel = await open(ON);
    expect(panel.getByRole("menuitem", { name: en.findYourTreatment })).toBeInTheDocument();
    expect(panel.getByRole("menuitem", { name: en.bookOnlineConsultation })).toBeInTheDocument();
  });

  it("Find kapalı", async () => {
    const panel = await open(FIND_OFF);
    expect(panel.queryByRole("menuitem", { name: en.findYourTreatment })).toBeNull();
    expect(panel.getByRole("menuitem", { name: en.bookOnlineConsultation })).toBeInTheDocument();
  });

  it("Book kapalı", async () => {
    const panel = await open(BOOK_OFF);
    expect(panel.getByRole("menuitem", { name: en.findYourTreatment })).toBeInTheDocument();
    expect(panel.queryByRole("menuitem", { name: en.bookOnlineConsultation })).toBeNull();
  });
});

describe("hizmet kartı", () => {
  const props = {
    service: { slug: "gastroenterology", name: "Gastroenterology", icon: "Stethoscope", shortDescription: null },
    subServices: [],
    strings: en,
    activeLocaleCode: "de",
    defaultLocaleCode: "en",
    bookingEnabled: true,
    callbackLabel: "Request a call back",
  };

  it("varsayılan (açık): Book + ikincil talep düğmesi", () => {
    render(<ServiceCard {...props} />);
    expect(screen.getByTestId("service-card-book")).toBeInTheDocument();
    expect(screen.getByTestId("service-card-request")).toBeInTheDocument();
  });

  it("bookCtaEnabled=false: Book yok; 'Request a call back' kalır", () => {
    render(<ServiceCard {...props} bookCtaEnabled={false} />);
    expect(screen.queryByTestId("service-card-book")).toBeNull();
    expect(screen.getByTestId("service-card-request")).toHaveTextContent("Request a call back");
  });
});

describe("paket detayı", () => {
  it("rezervasyon açık + Book anahtarı açık: Book var; anahtar kapalıysa yok, 'Request this package' kalır", () => {
    const on = render(features(ON, <PackageDetailActions slug="smile" title="Smile" />, true));
    expect(screen.getByTestId("package-book-cta")).toBeInTheDocument();
    on.unmount();
    render(features(BOOK_OFF, <PackageDetailActions slug="smile" title="Smile" />, true));
    expect(screen.queryByTestId("package-book-cta")).toBeNull();
    expect(screen.getByTestId("package-request-cta")).toBeInTheDocument();
  });
});

describe("Find your treatment giriş noktaları (matcher)", () => {
  function entries() {
    return (
      <>
        <MatcherLaunchButton />
        <MatcherHeroSearch />
        <MatcherCtaCard />
      </>
    );
  }

  it("açık: sağlayıcı ile üç giriş noktası da çizilir", () => {
    render(features(ON, <MatcherModalProvider enabled>{entries()}</MatcherModalProvider>));
    expect(screen.getAllByTestId("matcher-launch").length).toBeGreaterThan(0);
    expect(screen.getByTestId("matcher-hero-search")).toBeInTheDocument();
    expect(screen.getByTestId("matcher-cta")).toBeInTheDocument();
  });

  it("kapalı: sağlayıcı olsa da olmasa da hiçbiri çizilmez", () => {
    const withProvider = render(features(FIND_OFF, <MatcherModalProvider enabled={false}>{entries()}</MatcherModalProvider>));
    expect(screen.queryByTestId("matcher-launch")).toBeNull();
    expect(screen.queryByTestId("matcher-hero-search")).toBeNull();
    expect(screen.queryByTestId("matcher-cta")).toBeNull();
    withProvider.unmount();
    render(features(FIND_OFF, entries()));
    expect(screen.queryByTestId("matcher-launch")).toBeNull();
    expect(screen.queryByTestId("matcher-cta")).toBeNull();
  });
});

describe("VIP sayfası", () => {
  const hrefs = { request: "/en/request", find: "/en/find-your-treatment" };
  const base = { strings: vipStrings, intermediary: intermediaryStrings, certificateNo: null, images: [] };

  it("açık: Book ve Find bağlantıları", () => {
    render(<VipPageContent {...base} hrefs={hrefs} />);
    expect(screen.getByTestId("vip-hero-book")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: vipStrings.ctaFind }).length).toBeGreaterThan(0);
  });

  it("Find kapalı (find=null) ve Book kapalı: ctaFind ve ctaBook yok", () => {
    render(<VipPageContent {...base} hrefs={{ request: hrefs.request, find: null }} bookCtaEnabled={false} />);
    expect(screen.queryByRole("link", { name: vipStrings.ctaFind })).toBeNull();
    expect(screen.queryByRole("link", { name: vipStrings.ctaBook })).toBeNull();
    expect(screen.queryByTestId("vip-hero-book")).toBeNull();
    expect(screen.queryByTestId("vip-cta-book")).toBeNull();
  });
});

describe("footer iletişim bilgisi (K5)", () => {
  it("telefon + 'Call center 24/7' + adres; boşsa satır yok", () => {
    const address = "Atatürk Mah. Ertuğrul Gazi Sk. Metropol İstanbul C1 Blok No: 2B İç Kapı No: 168, Ataşehir / İstanbul, Türkiye";
    const { unmount } = render(
      <SiteFooter siteName="WM Health" contact={{ phone: "+90 212 000 00 00", callCenterShort: contactStrings.callCenterShort, address }} />
    );
    expect(screen.getByTestId("footer-phone")).toHaveAttribute("href", "tel:+902120000000");
    expect(screen.getByTestId("footer-call-center")).toHaveTextContent("Call center 24/7");
    expect(screen.getByTestId("footer-address")).toHaveTextContent(address);
    unmount();
    render(<SiteFooter siteName="WM Health" contact={{ phone: "", address: null, callCenterShort: "Call center 24/7" }} />);
    expect(screen.queryByTestId("footer-contact")).toBeNull();
  });
});
