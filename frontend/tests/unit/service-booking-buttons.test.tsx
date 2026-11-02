import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";

/**
 * AI İş 3 — "Book a consultation" / "Book an online consultation" düğmelerinin hedefi: rezervasyon açıkken
 * `/book-consultation[?service|package]`, kapalıyken mevcut `/request` hâli; ikincil seçenek "Request a call back".
 * (Sunucu sayfaları — bölüm detayı, hizmet listesi, /request — `aj-visitor-doctor-scan.test.tsx` içinde sınanır;
 * Find your treatment sonucu `matcher-wizard.test.tsx` içinde.)
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => `/en${p}`,
}));

import { SiteHeader } from "@/components/site/site-header";
import { ServicesMegaMenu } from "@/components/site/services-mega-menu";
import { ServiceCard } from "@/components/site/services/service-card";
import { PackageDetailActions } from "@/components/site/packages/package-detail-actions";
import { ContactChannelsProvider } from "@/components/site/contact/contact-channels-context";
import { ServiceBookingProvider } from "@/components/site/service-booking/service-booking-context";
import { bookingPath, callbackPath, primaryBookPath } from "@/lib/service-booking-links";
import { navStrings as enNav } from "@/lib/i18n/site-dictionaries/en/nav";
import { servicesStrings as en } from "@/lib/i18n/site-dictionaries/en/services";

vi.mock("@/components/site/packages/package-inquiry-form", () => ({ PackageInquiryForm: () => null, focusPackageInquiryForm: () => undefined }));

function withBooking(enabled: boolean, ui: React.ReactElement) {
  return (
    <ServiceBookingProvider enabled={enabled} callbackLabel="Request a call back" bookLabel="Book an online consultation">
      {ui}
    </ServiceBookingProvider>
  );
}

describe("yol yardımcıları", () => {
  it("açıkken rezervasyon, kapalıyken talep formu; service/package parametreleri kodlanır", () => {
    expect(primaryBookPath(true)).toBe("/book-consultation");
    expect(primaryBookPath(false)).toBe("/request");
    expect(primaryBookPath(true, { service: "gastro enterology" })).toBe("/book-consultation?service=gastro+enterology");
    expect(primaryBookPath(false, { service: "esd" })).toBe("/request?service=esd");
    expect(bookingPath({ pkg: "smile" })).toBe("/book-consultation?package=smile");
    expect(callbackPath({ service: "esd" })).toBe("/request?service=esd");
  });
});

describe("header CTA", () => {
  const settings = { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings;
  const nav = (id: string, label: string, href: string, order: number): NavigationItemDto => ({ id, label, href, order, parentId: null }) as NavigationItemDto;
  const items = [nav("a", "About", "/about", 0), nav("c", "Contact", "/contact", 1)];
  const header = (extra: Partial<Parameters<typeof SiteHeader>[0]> = {}) => (
    <div className="site-scope">
      <SiteHeader settings={settings} pages={[]} navigationItems={items} ctaLabel="Appointment" ctaHref="/request" dict={enNav} services={en} {...extra} />
    </div>
  );

  it("rezervasyon açıkken /book-consultation (masaüstü ve mobil)", async () => {
    render(withBooking(true, header()));
    expect(screen.getByTestId("header-book-consultation")).toHaveAttribute("href", "/book-consultation");
    await userEvent.setup().click(screen.getByRole("button", { name: enNav.openMenu }));
    expect(await screen.findByTestId("mobile-menu-book-consultation")).toHaveAttribute("href", "/book-consultation");
  });

  it("rezervasyon kapalıyken mevcut /request hâli; provider yoksa da kapalı sayılır", () => {
    const closed = render(withBooking(false, header()));
    expect(screen.getByTestId("header-book-consultation")).toHaveAttribute("href", "/request");
    closed.unmount();
    render(header());
    expect(screen.getByTestId("header-book-consultation")).toHaveAttribute("href", "/request");
  });

  it("yöneticinin verdiği özel CTA bağlantısı rezervasyon açıkken de değişmez", () => {
    render(withBooking(true, header({ ctaLabel: "Plan my trip", ctaHref: "/plan" })));
    expect(screen.getByTestId("header-book-consultation")).toHaveAttribute("href", "/plan");
  });
});

describe("mega menü sağ paneli", () => {
  async function open(enabled: boolean) {
    render(
      withBooking(
        enabled,
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
    await userEvent.setup().click(screen.getByRole("button", { name: /^Health Tourism Services/ }));
    return within(await screen.findByTestId("services-mega-panel"));
  }

  it("açıkken 'Book an online consultation' → /book-consultation", async () => {
    const panel = await open(true);
    expect(panel.getByRole("menuitem", { name: "Book an online consultation" })).toHaveAttribute("href", "/en/book-consultation");
  });

  it("kapalıyken → /request", async () => {
    const panel = await open(false);
    expect(panel.getByRole("menuitem", { name: "Book an online consultation" })).toHaveAttribute("href", "/en/request");
  });
});

describe("hizmet kartı", () => {
  const props = {
    service: { slug: "gastroenterology", name: "Gastroenterology", icon: "Stethoscope", shortDescription: null },
    subServices: [],
    strings: en,
    activeLocaleCode: "de",
    defaultLocaleCode: "en",
  };

  it("açıkken Book → /book-consultation?service=, ikincil 'Request a call back' → /request?service=", () => {
    render(<ServiceCard {...props} bookingEnabled callbackLabel="Request a call back" />);
    expect(screen.getByTestId("service-card-book")).toHaveAttribute("href", "/de/book-consultation?service=gastroenterology");
    const request = screen.getByTestId("service-card-request");
    expect(request).toHaveAttribute("href", "/de/request?service=gastroenterology");
    expect(request).toHaveTextContent("Request a call back");
    expect(request).toHaveAccessibleName("Request a call back: Gastroenterology");
  });

  it("kapalıyken ikisi de /request?service= ve eski etiketler", () => {
    render(<ServiceCard {...props} />);
    expect(screen.getByTestId("service-card-book")).toHaveAttribute("href", "/de/request?service=gastroenterology");
    expect(screen.getByTestId("service-card-request")).toHaveTextContent("Request");
    expect(screen.getByTestId("service-card-request")).not.toHaveTextContent("call back");
  });
});

describe("paket detayı", () => {
  it("açıkken 'Book an online consultation' → ?package=; 'Request this package' kalır", () => {
    render(withBooking(true, <PackageDetailActions slug="smile-makeover" title="Smile Makeover" />));
    expect(screen.getByTestId("package-book-cta")).toHaveAttribute("href", "/en/book-consultation?package=smile-makeover");
    expect(screen.getByTestId("package-request-cta")).toHaveAttribute("href", "/en/request?package=smile-makeover");
  });

  it("kapalıyken rezervasyon düğmesi yok", () => {
    render(withBooking(false, <PackageDetailActions slug="smile-makeover" title="Smile Makeover" />));
    expect(screen.queryByTestId("package-book-cta")).toBeNull();
    expect(screen.getByTestId("package-request-cta")).toBeInTheDocument();
  });
});
