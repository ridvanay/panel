import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NavigationItemDto, SiteSettings } from "@/lib/api/types";
import type { ServicesStrings } from "@/lib/i18n/site-dictionaries/types";

/**
 * Paket AI (FE1) — "Health Tourism Services" mega menüsü (masaüstü + mobil akordeon), header düğmeleri,
 * hizmet grupları, Hizmetler sayfası kartları/süreç şeridi ve 9 dil sözlük eşliği.
 * 520 px sınırı: birim testte stil kontrolü; gerçek görsel ölçüm orkestratör ekran görüntüsünde.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/context/locale-alternates-context", () => ({
  useLocaleAlternates: () => null,
  contentKindBasePath: () => "",
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (p: string) => p,
}));

import { SiteHeader } from "@/components/site/site-header";
import { ServicesMegaMenu, MEGA_MENU_MAX_HEIGHT_PX } from "@/components/site/services-mega-menu";
import { ContactChannelsProvider } from "@/components/site/contact/contact-channels-context";
import { ServiceCard, ServicesProcessStrip } from "@/components/site/services/service-card";
import type { NavSpecialty } from "@/components/site/nav-dropdown";
import { groupServices, resolveServiceGroup, SERVICE_GROUP_ORDER } from "@/lib/service-groups";
import { navStrings as enNav } from "@/lib/i18n/site-dictionaries/en/nav";
import { servicesStrings as en } from "@/lib/i18n/site-dictionaries/en/services";
import { siteDictionary as enDict } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as trDict } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as arDict } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as esDict } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as deDict } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as ruDict } from "@/lib/i18n/site-dictionaries/ru";
import { siteDictionary as roDict } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as frDict } from "@/lib/i18n/site-dictionaries/fr";
import { siteDictionary as srDict } from "@/lib/i18n/site-dictionaries/sr-latn";

const sp = (slug: string, name: string, serviceGroup: string | null, extra: Partial<NavSpecialty> = {}): NavSpecialty => ({
  slug,
  name,
  icon: "Stethoscope",
  imageUrl: null,
  parentSlug: null,
  serviceGroup,
  shortDescription: null,
  ...extra,
});

// Bilerek karışık sırada: grup sırası girişten değil sabit listeden gelmeli.
const SPECIALTIES: NavSpecialty[] = [
  sp("ivf-and-reproductive-health", "IVF & Reproductive Health", "fertility", { shortDescription: "Fertility care at authorized facilities" }),
  sp("dentalcare", "Dental Care", "aesthetic-dental-hair"),
  sp("orthodontist", "Orthodontics", "aesthetic-dental-hair"),
  sp("gastroenterology", "Gastroenterology", "digestive-interventional", { shortDescription: "Digestive health procedures" }),
  sp("ercp", "ERCP", null, { parentSlug: "gastroenterology" }),
  sp("esd", "ESD", null, { parentSlug: "gastroenterology" }),
  sp("poem", "POEM", null, { parentSlug: "gastroenterology" }),
  sp("interventional-radiology-specialist", "Interventional Radiology", "digestive-interventional"),
  sp("obesity-and-metabolic-surgery", "Obesity & Metabolic Surgery", "surgery-oncology", { shortDescription: "Weight-loss and metabolic surgery at authorized facilities" }),
  sp("surgical-oncology", "Surgical Oncology", "surgery-oncology"),
  sp("dermatology", "Dermatology", null),
];

const localize = (href: string) => `/en${href}`;
const LINK = { id: "s", href: "/specialties", label: "Health Tourism Services" };

function renderMega(opts: { specialties?: NavSpecialty[]; whatsapp?: { number: string; message: string } | null; dir?: "ltr" | "rtl"; strings?: ServicesStrings } = {}) {
  return render(
    <div dir={opts.dir ?? "ltr"}>
      <ContactChannelsProvider value={{ whatsapp: opts.whatsapp ?? null, chatEnabled: false, contactHref: "/contact" }}>
        <ServicesMegaMenu
          link={LINK}
          localize={localize}
          active={false}
          specialties={opts.specialties ?? SPECIALTIES}
          strings={opts.strings ?? en}
          contactTopic="WM Health"
          triggerClassName="text-foreground"
          activeTriggerClassName="text-primary"
        />
      </ContactChannelsProvider>
    </div>
  );
}

async function openMega() {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: /^Health Tourism Services/ });
  await user.click(trigger);
  const menu = await screen.findByRole("menu");
  return { user, trigger, menu };
}

describe("groupServices", () => {
  it("sabit grup sırası, boş grup yok, grubu olmayan 'other' sonda; alt uzmanlık üst öğenin çipi", () => {
    const groups = groupServices(SPECIALTIES);
    expect(groups.map((g) => g.id)).toEqual(["surgery-oncology", "digestive-interventional", "aesthetic-dental-hair", "fertility", "other"]);
    expect(groups[0]!.items.map((i) => i.slug)).toEqual(["obesity-and-metabolic-surgery", "surgical-oncology"]);
    const gastro = groups[1]!.items.find((i) => i.slug === "gastroenterology")!;
    expect(gastro.children.map((c) => c.slug)).toEqual(["ercp", "esd", "poem"]);
    // Alt uzmanlıklar ayrı öğe olmaz.
    expect(groups.flatMap((g) => g.items).some((i) => i.slug === "ercp")).toBe(false);
    expect(groups[4]!.items.map((i) => i.slug)).toEqual(["dermatology"]);
    expect(SERVICE_GROUP_ORDER).toEqual(["surgery-oncology", "digestive-interventional", "aesthetic-dental-hair", "fertility", "other"]);
  });

  it("boş grup gösterilmez; üst uzmanlığı listede olmayan alt uzmanlık kendi başına kalır; bilinmeyen/eksik grup → other", () => {
    expect(groupServices([sp("a", "A", "fertility")]).map((g) => g.id)).toEqual(["fertility"]);
    const orphan = groupServices([sp("esd", "ESD", null, { parentSlug: "missing" })]);
    expect(orphan[0]!.items[0]!.slug).toBe("esd");
    expect(resolveServiceGroup("nonsense")).toBe("other");
    expect(resolveServiceGroup(undefined)).toBe("other");
    expect(groupServices([])).toEqual([]);
  });
});

describe("mega menü — masaüstü", () => {
  it("gruplar sabit sırada, başlıklar sözlükten; öğeler hizmet sayfasına; kısa açıklama yalnızca varsa", async () => {
    renderMega();
    const { menu } = await openMega();
    const groups = within(menu).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("data-testid"))).toEqual([
      "services-group-surgery-oncology",
      "services-group-digestive-interventional",
      "services-group-aesthetic-dental-hair",
      "services-group-fertility",
      "services-group-other",
    ]);
    for (const title of ["Surgery & Oncology", "Digestive & Interventional", "Aesthetic, Dental & Hair", "Fertility", "Other"]) {
      expect(within(menu).getByText(title)).toBeInTheDocument();
    }
    const obesity = within(menu).getByRole("menuitem", { name: /^Obesity & Metabolic Surgery/ });
    expect(obesity).toHaveAttribute("href", "/en/specialties/obesity-and-metabolic-surgery");
    expect(obesity).toHaveTextContent("Weight-loss and metabolic surgery at authorized facilities");
    const dental = within(menu).getByRole("menuitem", { name: "Dental Care" });
    expect(dental.textContent).toBe("Dental Care"); // açıklama yok → ikinci satır çizilmez
    // Ziyaretçiye "Specialist"/doktor adı/unvanı yok.
    expect(menu.textContent ?? "").not.toMatch(/specialist|\bDr\.?\b|\bProf\b|physician|doctor/i);
  });

  it("alt uzmanlıklar üst öğenin altında çip olarak (ERCP · ESD · POEM), ayrı kart değil", async () => {
    renderMega();
    const { menu } = await openMega();
    const chips = within(menu).getByTestId("nav-procedures");
    expect(within(chips).getAllByRole("menuitem").map((c) => c.textContent)).toEqual(["ERCP", "ESD", "POEM"]);
    expect(within(chips).getByRole("menuitem", { name: "ESD" })).toHaveAttribute("href", "/en/specialties/esd");
    // Çipler flex-wrap: sarkmaz, sarar.
    expect(chips.className).toContain("flex-wrap");
    expect(within(menu).getAllByTestId("services-item")).toHaveLength(SPECIALTIES.length - 3);
  });

  it("sağ panel: Find your treatment (/find-your-treatment) ve Book an online consultation (/request); alt şerit View all services + ibare", async () => {
    renderMega();
    const { menu } = await openMega();
    const panel = within(menu).getByTestId("services-mega-panel");
    expect(panel).toHaveTextContent("Not sure which treatment you need?");
    expect(within(panel).getByRole("menuitem", { name: "Find your treatment" })).toHaveAttribute("href", "/en/find-your-treatment");
    expect(within(panel).getByRole("menuitem", { name: "Book an online consultation" })).toHaveAttribute("href", "/en/request");
    expect(within(menu).getByRole("menuitem", { name: "View all services" })).toHaveAttribute("href", "/en/specialties");
    expect(menu).toHaveTextContent("Treatments at authorized healthcare facilities");
  });

  it("WhatsApp bağlantısı yalnızca iletişim kanalı tanımlıysa görünür", async () => {
    const first = renderMega();
    await openMega();
    expect(screen.queryByTestId("services-mega-contact")).toBeNull();
    first.unmount();
    renderMega({ whatsapp: { number: "+90 555 000 11 22", message: "Hello {package}" } });
    await openMega();
    const contact = screen.getByTestId("services-mega-contact");
    expect(within(contact).getByRole("menuitem")).toHaveAttribute("href", expect.stringContaining("https://wa.me/905550001122"));
  });

  it("yükseklik tavanı 520 px ve içerik kendi içinde kayar (taşmaz)", async () => {
    renderMega();
    const { menu } = await openMega();
    expect(MEGA_MENU_MAX_HEIGHT_PX).toBe(520);
    expect(menu.style.maxHeight).toBe("520px");
    expect(menu.className).toContain("overflow-hidden");
    expect(within(menu).getByTestId("services-mega-groups").className).toContain("overflow-y-auto");
    // Tek satır açıklama (sarkmaz): truncate.
    const desc = within(menu).getByText("Digestive health procedures");
    expect(desc.className).toContain("truncate");
  });

  it("klavye: Enter ile açılır, oklarla gezilir, Esc kapatır ve odak tetikleyiciye döner", async () => {
    renderMega();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: /^Health Tourism Services/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.some((el) => el === document.activeElement)).toBe(true);
    const first = document.activeElement;
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).not.toBe(first);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("RTL: yalnızca mantıksal (start/end) sınıflar kullanılır; Arapça sözlükle çalışır", async () => {
    renderMega({ dir: "rtl", strings: arDict.services });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Health Tourism Services/ }));
    const menu = await screen.findByRole("menu");
    expect(menu.innerHTML).not.toMatch(/class="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r)-/);
    expect(within(menu).getByTestId("services-mega-panel").className).toContain("border-s");
    expect(menu).toHaveTextContent(arDict.services.groupSurgeryOncology);
    expect(menu).toHaveTextContent(arDict.services.findYourTreatment);
    expect(menu.innerHTML).toContain("rtl:-scale-x-100"); // ok ikonu RTL'de çevrilir
  });
});

describe("header — düğmeler ve mobil akordeon", () => {
  const settings = { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings;
  const nav = (id: string, label: string, href: string, order: number): NavigationItemDto => ({ id, label, href, order, parentId: null }) as NavigationItemDto;
  const items = [nav("a", "About", "/about", 0), nav("s", "Health Tourism Services", "/specialties", 1), nav("c", "Contact", "/contact", 2)];

  function renderHeader(extra: Partial<Parameters<typeof SiteHeader>[0]> = {}) {
    return render(
      <SiteHeader
        settings={settings}
        pages={[]}
        navigationItems={items}
        ctaLabel="Appointment"
        ctaHref="/request"
        dict={enNav}
        services={en}
        navSpecialties={SPECIALTIES}
        {...extra}
      />
    );
  }

  it("masaüstü: ikincil 'Find your treatment' → /find-your-treatment; birincil CTA 'Appointment' yerine 'Book a consultation' → /request", () => {
    renderHeader();
    const actions = screen.getByTestId("site-header-actions");
    const find = within(actions).getByTestId("header-find-treatment");
    expect(find).toHaveAttribute("href", "/find-your-treatment");
    expect(find).toHaveAccessibleName("Find your treatment");
    expect(within(actions).queryByText("Request a consultation")).toBeNull();
    const book = within(actions).getByTestId("header-book-consultation");
    expect(book).toHaveAttribute("href", "/request");
    expect(book).toHaveTextContent("Book a consultation");
    expect(within(actions).queryByText("Appointment")).toBeNull();
  });

  it("CTA verisi boşsa sözlükteki 'Book a consultation' (→ /request) gösterilir; özel etiket korunur", () => {
    const empty = renderHeader({ ctaLabel: null, ctaHref: null });
    expect(screen.getByTestId("header-book-consultation")).toHaveAttribute("href", "/request");
    expect(screen.getByTestId("header-book-consultation")).toHaveTextContent("Book a consultation");
    empty.unmount();
    renderHeader({ ctaLabel: "Plan my trip", ctaHref: "/plan" });
    expect(screen.getByTestId("header-book-consultation")).toHaveTextContent("Plan my trip");
    expect(screen.getByTestId("header-book-consultation")).toHaveAttribute("href", "/plan");
  });

  it("masaüstünde 'Health Tourism Services' mega menüdür; veride alt öğe varsa klasik açılır menü kalır", async () => {
    const user = userEvent.setup();
    const first = renderHeader();
    await user.click(screen.getByRole("button", { name: /^Health Tourism Services/ }));
    expect(await screen.findByTestId("services-mega-menu")).toBeInTheDocument();
    first.unmount();
    const child = { id: "x", label: "Custom Child", href: "/specialties/custom", order: 0, parentId: "s" } as NavigationItemDto;
    renderHeader({ navigationItems: [...items, child] });
    await user.click(screen.getByRole("button", { name: /^Health Tourism Services/ }));
    await screen.findByRole("menuitem", { name: "Custom Child" });
    expect(screen.queryByTestId("services-mega-menu")).toBeNull();
  });

  it("mobil: üstte iki düğme (Find your treatment, Book a consultation); hizmetler gruplu akordeon, gruplar açılınca öğe ve çipler", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole("button", { name: enNav.openMenu }));
    const find = await screen.findByTestId("mobile-menu-find-treatment");
    const book = screen.getByTestId("mobile-menu-book-consultation");
    expect(find).toHaveAttribute("href", "/find-your-treatment");
    expect(book).toHaveAttribute("href", "/request");
    expect(book).toHaveTextContent("Book a consultation");
    const panel = find.parentElement!;
    expect(panel.firstElementChild).toBe(find);
    expect(find.nextElementSibling).toBe(book);

    await user.click(within(panel).getByRole("button", { name: /^Health Tourism Services/ }));
    const groups = await screen.findByTestId("mobile-services-groups");
    const triggers = within(groups).getAllByRole("button");
    expect(triggers.map((t) => t.textContent)).toEqual(["Surgery & Oncology", "Digestive & Interventional", "Aesthetic, Dental & Hair", "Fertility", "Other"]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
    await user.click(triggers[1]!);
    expect(triggers[1]).toHaveAttribute("aria-expanded", "true");
    const chips = await screen.findByTestId("mobile-nav-procedures");
    expect(within(chips).getAllByRole("link").map((l) => l.textContent)).toEqual(["ERCP", "ESD", "POEM"]);
    expect(within(groups).getByRole("link", { name: "View all services" })).toHaveAttribute("href", "/specialties");
    expect(groups.textContent ?? "").not.toMatch(/specialist|physician|doctor/i);
  });
});

describe("Hizmetler sayfası bileşenleri", () => {
  it("süreç şeridi: 6 adım sıralı liste", () => {
    render(<ServicesProcessStrip strings={en} />);
    const steps = within(screen.getByTestId("services-process")).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent?.replace(/^\d/, ""))).toEqual([
      "Request or book",
      "Coordinator call",
      "Authorized facility & plan",
      "Travel & stay",
      "Treatment",
      "Aftercare",
    ]);
  });

  it("kart: ikon, ad, kısa açıklama, çipler; 'Book' ve 'Request' → /request?service=<slug> (dil önekli)", () => {
    render(
      <ServiceCard
        service={{ slug: "gastroenterology", name: "Gastroenterology", icon: "Stethoscope", shortDescription: "Digestive health procedures" }}
        subServices={[{ slug: "ercp", name: "ERCP" }]}
        strings={en}
        activeLocaleCode="de"
        defaultLocaleCode="en"
      />
    );
    const card = screen.getByTestId("service-card");
    expect(within(card).getByRole("link", { name: "Gastroenterology" })).toHaveAttribute("href", "/de/specialties/gastroenterology");
    expect(card).toHaveTextContent("Digestive health procedures");
    expect(within(card).getByRole("link", { name: "ERCP" })).toHaveAttribute("href", "/de/specialties/ercp");
    expect(within(card).getByTestId("service-card-book")).toHaveAttribute("href", "/de/request?service=gastroenterology");
    expect(within(card).getByTestId("service-card-request")).toHaveAttribute("href", "/de/request?service=gastroenterology");
    expect(within(card).getByTestId("service-card-book")).toHaveAccessibleName("Book an online consultation: Gastroenterology");
  });

  it("kısa açıklama yoksa (alan yok/null) açıklama satırı ve çipler çizilmez", () => {
    render(
      <ServiceCard
        service={{ slug: "dentalcare", name: "Dental Care", icon: "Smile", shortDescription: null }}
        subServices={[]}
        strings={en}
        activeLocaleCode="en"
        defaultLocaleCode="en"
      />
    );
    const card = screen.getByTestId("service-card");
    expect(card.querySelector("p")).toBeNull();
    expect(screen.queryByTestId("service-card-chips")).toBeNull();
  });
});

describe("sözlükler (9 klasör, tr = EN)", () => {
  const all = { en: enDict, tr: trDict, ar: arDict, es: esDict, de: deDict, ru: ruDict, ro: roDict, fr: frDict, "sr-latn": srDict };
  it("her dilde aynı anahtarlar dolu; tr klasörü EN metin; diğer diller EN'den farklı", () => {
    const keys = Object.keys(enDict.services).sort();
    for (const [code, dict] of Object.entries(all)) {
      expect(Object.keys(dict.services).sort(), code).toEqual(keys);
      for (const key of keys) expect((dict.services as Record<string, string>)[key]!.trim().length, `${code}.${key}`).toBeGreaterThan(0);
    }
    expect(trDict.services).toEqual(enDict.services);
    for (const code of ["ar", "es", "de", "ru", "ro", "fr", "sr-latn"] as const) {
      expect(all[code].services.findYourTreatment, code).not.toBe(en.findYourTreatment);
      expect(all[code].services.cardBookAria, code).toContain("{service}");
    }
    expect(arDict.services.groupFertility).toMatch(/[؀-ۿ]/);
  });
});
