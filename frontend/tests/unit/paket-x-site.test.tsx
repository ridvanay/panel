import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({ usePathname: () => "/en", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/legal-pages", () => ({ fetchLegalPagesClient: () => Promise.resolve([]), resolveKvkkNoticePage: () => null }));

import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as es } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as fr } from "@/lib/i18n/site-dictionaries/fr";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as ru } from "@/lib/i18n/site-dictionaries/ru";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as srLatn } from "@/lib/i18n/site-dictionaries/sr-latn";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { ContactChannelsProvider } from "@/components/site/contact/contact-channels-context";
import { ContactCta } from "@/components/site/contact/contact-cta";
import { HeaderContactLinks } from "@/components/site/contact/header-contact-links";
import { MobileContactButton } from "@/components/site/contact/mobile-contact-button";
import { SupportLanguagesBand } from "@/components/site/support/support-languages-band";
import { LiveChatWidget, applyChatContext } from "@/components/site/live-chat-widget";
import { DestinationsView } from "@/components/site/destinations/destinations-section";
import { resolveLanguageSupport } from "@/lib/language-support";
import { buildWhatsappHref } from "@/lib/whatsapp-link";
import { openLiveChat, OPEN_LIVE_CHAT_EVENT } from "@/lib/live-chat-open";
import type { Destination } from "@/lib/api/server-destinations";
import type { TelehealthThemeSettings } from "@/lib/api/types";

// jsdom `scrollTo` uygulamaz (sohbet listesi kaydırması).
Element.prototype.scrollTo = vi.fn();

const WA = { number: "905550000000", message: "Hello, I'm interested in {package}." };

function wrap(ui: ReactNode, opts: { lang?: string; whatsapp?: typeof WA | null; chat?: boolean } = {}) {
  return (
    <LocaleAlternatesProvider activeLocaleCode={opts.lang ?? "en"} defaultLocaleCode="en">
      <ContactChannelsProvider value={{ whatsapp: opts.whatsapp ?? null, chatEnabled: opts.chat ?? false, contactHref: "/en/contact" }}>{ui}</ContactChannelsProvider>
    </LocaleAlternatesProvider>
  );
}

const chatSettings = { siteName: "Site", liveChatEnabled: true, liveChatProvider: "internal" as const };
const supportSettings = { languageSupport: { supportLanguages: ["en"], supportHours: {}, interpreterIncluded: false } } as unknown as Pick<TelehealthThemeSettings, "languageSupport">;

describe("WhatsApp bağlantısı", () => {
  it("doğru numara + dilde şablon; yalnızca konu girer, kişisel veri yok", () => {
    const href = buildWhatsappHref({ number: "+90 555 000 00 00", message: "Merhaba, {package} hakkında bilgi almak istiyorum." }, "Executive  Check-up");
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe("https://wa.me/905550000000");
    expect(url.searchParams.get("text")).toBe("Merhaba, Executive Check-up hakkında bilgi almak istiyorum.");
    expect([...url.searchParams.keys()]).toEqual(["text"]);
  });
});

describe("ContactCta", () => {
  it("WhatsApp yalnızca kanal varken; not görünür ve kanal yokken hiç yok", () => {
    const { unmount } = render(wrap(<ContactCta topic="Check-up" />));
    expect(screen.queryByTestId("contact-cta-whatsapp")).toBeNull();
    expect(screen.queryByTestId("contact-cta-whatsapp-note")).toBeNull();
    unmount();
    render(wrap(<ContactCta topic="Check-up" />, { whatsapp: WA }));
    const link = screen.getByTestId("contact-cta-whatsapp");
    expect(link).toHaveAttribute("href", buildWhatsappHref(WA, "Check-up"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByTestId("contact-cta-whatsapp-note")).toHaveTextContent(en.contactCta.whatsappNote);
    expect(link.getAttribute("aria-describedby")).toBe(screen.getByTestId("contact-cta-whatsapp-note").id);
  });

  it("compact boyutta not görsel değil (sr-only) ama title ile bağlı", () => {
    render(wrap(<ContactCta topic="x" size="compact" />, { whatsapp: WA }));
    expect(screen.getByTestId("contact-cta-whatsapp-note")).toHaveClass("sr-only");
    expect(screen.getByTestId("contact-cta-whatsapp")).toHaveAttribute("title", en.contactCta.whatsappNote);
  });

  it("canlı destek yalnızca chatEnabled iken ve bağlamla açar", () => {
    const { unmount } = render(wrap(<ContactCta topic="Check-up" />));
    expect(screen.queryByTestId("contact-cta-chat")).toBeNull();
    unmount();
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_LIVE_CHAT_EVENT, listener);
    render(wrap(<ContactCta topic="Check-up" />, { chat: true }));
    fireEvent.click(screen.getByTestId("contact-cta-chat"));
    window.removeEventListener(OPEN_LIVE_CHAT_EVENT, listener);
    expect(seen).toEqual([{ context: "Check-up" }]);
  });

  it("'Sizi arayalım': onCallback verilirse düğme çağırır, yoksa iletişim sayfasına bağlanır", () => {
    const onCallback = vi.fn();
    const { unmount } = render(wrap(<ContactCta topic="x" onCallback={onCallback} />));
    fireEvent.click(screen.getByTestId("contact-cta-callback"));
    expect(onCallback).toHaveBeenCalledTimes(1);
    unmount();
    render(wrap(<ContactCta topic="x" />));
    expect(screen.getByTestId("contact-cta-callback")).toHaveAttribute("href", "/en/contact");
  });
});

describe("whatsapp null iken hiçbir WhatsApp öğesi yok", () => {
  it("header, mobil düğme ve destek bandı", () => {
    const support = resolveLanguageSupport(supportSettings, "en");
    const { container } = render(
      wrap(
        <>
          <HeaderContactLinks topic="Site" />
          <MobileContactButton topic="Site" />
          <SupportLanguagesBand support={support} dict={en.common} topic="Site" />
        </>,
        { chat: true }
      )
    );
    expect(container.querySelector("[data-testid*='whatsapp']")).toBeNull();
    expect(container.querySelector("a[href*='wa.me']")).toBeNull();
    expect(screen.queryByTestId("mobile-contact-button")).toBeNull();
    expect(screen.getByTestId("site-header-talk-to-us")).toBeInTheDocument();
  });

  it("kanal yok + sohbet kapalı: header bağlantıları hiçbir şey çizmez", () => {
    const { container } = render(wrap(<HeaderContactLinks topic="Site" />));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("header üst şerit bağlantıları", () => {
  it("WhatsApp site adıyla; Talk to us sohbeti açar", () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_LIVE_CHAT_EVENT, listener);
    render(wrap(<HeaderContactLinks topic="WM Health" />, { whatsapp: WA, chat: true }));
    expect(screen.getByTestId("site-header-whatsapp")).toHaveAttribute("href", buildWhatsappHref(WA, "WM Health"));
    expect(screen.getByTestId("site-header-whatsapp")).toHaveAttribute("title", en.contactCta.whatsappNote);
    fireEvent.click(screen.getByTestId("site-header-talk-to-us"));
    window.removeEventListener(OPEN_LIVE_CHAT_EVENT, listener);
    expect(seen).toEqual([{}]);
  });
});

describe("mobil birleşik Contact düğmesi", () => {
  it("WhatsApp açıkken menüde WhatsApp + (açıksa) canlı destek + arayalım; not var", () => {
    render(wrap(<MobileContactButton topic="Site" />, { whatsapp: WA, chat: true }));
    expect(screen.queryByTestId("mobile-contact-menu")).toBeNull();
    const trigger = screen.getByTestId("mobile-contact-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const menu = screen.getByTestId("mobile-contact-menu");
    // Ref kodu için CRM izleyicisinin WhatsApp tıklamasını görmesi gerekir (onaylıysa): düğme izleme dışı DEĞİL.
    expect(screen.getByTestId("mobile-contact-button")).not.toHaveAttribute("data-crm-ignore");
    expect(within(menu).getByTestId("mobile-contact-whatsapp")).toHaveAttribute("href", buildWhatsappHref(WA, "Site"));
    expect(within(menu).getByTestId("mobile-contact-whatsapp-note")).toHaveTextContent(en.contactCta.whatsappNote);
    expect(within(menu).getByTestId("mobile-contact-chat")).toBeInTheDocument();
    expect(within(menu).getByTestId("mobile-contact-callback")).toHaveAttribute("href", "/en/contact");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("mobile-contact-menu")).toBeNull();
  });

  it("sohbet kapalıysa menüde canlı destek yok", () => {
    render(wrap(<MobileContactButton topic="Site" />, { whatsapp: WA, chat: false }));
    fireEvent.click(screen.getByTestId("mobile-contact-trigger"));
    expect(screen.queryByTestId("mobile-contact-chat")).toBeNull();
  });

  it("WhatsApp kapalıyken yalnızca mevcut sohbet balonu: düğme yok, balon mobilde de görünür", () => {
    const { container } = render(
      wrap(
        <>
          <MobileContactButton topic="Site" />
          <LiveChatWidget settings={chatSettings} />
        </>,
        { chat: true }
      )
    );
    expect(screen.queryByTestId("mobile-contact-button")).toBeNull();
    const bubble = container.querySelector(`button[aria-label="${en.ui.chatOpen}"]`) as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.className).not.toContain("max-lg:hidden");
  });

  it("WhatsApp açıkken sohbet balonu mobilde gizlenir (yerine Contact düğmesi)", () => {
    const { container } = render(wrap(<LiveChatWidget settings={chatSettings} />, { whatsapp: WA, chat: true }));
    const bubble = container.querySelector(`button[aria-label="${en.ui.chatOpen}"]`) as HTMLElement;
    expect(bubble.className).toContain("max-lg:hidden");
  });
});

describe("destek bandı ContactCta kullanır", () => {
  it("band içinde contact-cta; WhatsApp açıkken onPrimary tonlu bağlantı", () => {
    const support = resolveLanguageSupport(supportSettings, "en");
    render(wrap(<SupportLanguagesBand support={support} dict={en.common} topic="WM Health" />, { whatsapp: WA, chat: true }));
    const band = screen.getByTestId("support-languages-band");
    const cta = within(band).getByTestId("contact-cta");
    expect(within(cta).getByTestId("contact-cta-whatsapp")).toHaveAttribute("href", buildWhatsappHref(WA, "WM Health"));
    expect(within(cta).getByTestId("contact-cta-whatsapp")).toHaveClass("bg-white");
    expect(within(cta).getByTestId("contact-cta-chat")).toBeInTheDocument();
  });
});

describe("canlı destek bağlamı ön-doldurma", () => {
  it("applyChatContext: boşsa doldurur, doluysa dokunmaz", () => {
    expect(applyChatContext("", "Health package: Executive Check-up")).toBe("Health package: Executive Check-up — ");
    expect(applyChatContext("   ", "X")).toBe("X — ");
    expect(applyChatContext("Merhaba", "X")).toBe("Merhaba");
    expect(applyChatContext("", undefined)).toBe("");
  });

  it("pencere bağlamla açılınca mesaj kutusu doldurulur; ikinci çağrı yazılanı ezmez", async () => {
    render(wrap(<LiveChatWidget settings={chatSettings} />, { chat: true }));
    act(() => openLiveChat("Executive Check-up"));
    const box = (await screen.findByRole("textbox")) as HTMLInputElement;
    expect(box.value).toBe("Executive Check-up — ");
    fireEvent.change(box, { target: { value: "Fiyat nedir?" } });
    act(() => openLiveChat("Başka paket"));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Fiyat nedir?");
  });

  it("bağlam verilmezse kutu boş kalır", async () => {
    render(wrap(<LiveChatWidget settings={chatSettings} />, { chat: true }));
    act(() => openLiveChat());
    expect(((await screen.findByRole("textbox")) as HTMLInputElement).value).toBe("");
  });
});

const DEST: Destination = {
  id: "d1",
  slug: "istanbul",
  city: "Istanbul",
  title: "Istanbul",
  summary: "Hair, dental and check-ups.",
  highlights: [],
  cover: { url: "https://cdn.example/ist.webp", compatUrl: null, width: 800, height: 500, alt: "Bosphorus" },
  patientCountLastYear: 1200,
  dataPeriodLabel: "Jan–Dec 2025",
  treatments: [
    { label: "Hair transplant", price: { from: 1800, currency: "EUR" } },
    { label: "Dental", price: null },
    { label: "Check-up", price: { from: 400, currency: "EUR" } },
    { label: "Fourth", price: null },
  ],
};

describe("Top destinations", () => {
  const view = (items: Destination[]) =>
    render(wrap(<DestinationsView items={items} dict={en.destinations} lang="en" siteName="Acme Clinic" packagesHref="/en/packages" />));

  it("bölüm CRM'de kişi bazında izlenmez (yalnızca anonim sayaç)", () => {
    view([DEST]);
    expect(screen.getByTestId("home-destinations")).toHaveAttribute("data-crm-ignore");
  });

  it("kayıt yokken bölüm yok", () => {
    const { container } = view([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("site adı sözlükteki yer tutucuya girer (sabit marka yok); dataPeriodLabel başlık altında", () => {
    view([DEST]);
    const section = screen.getByTestId("home-destinations");
    expect(section).toHaveTextContent("Top destinations");
    expect(section).toHaveTextContent("Where Acme Clinic patients travelled most in the past year");
    expect(section).not.toHaveTextContent("WM Health");
    expect(screen.getByTestId("destinations-period")).toHaveTextContent("Jan–Dec 2025");
  });

  it("hasta sayısı boşken gizli; doluyken görünür", () => {
    const { unmount } = view([{ ...DEST, patientCountLastYear: null }]);
    expect(screen.queryByTestId("destination-patients")).toBeNull();
    unmount();
    view([DEST]);
    expect(screen.getByTestId("destination-patients")).toHaveTextContent("1,200");
  });

  it("en çok 3 tedavi; fiyat varsa 'from' ve fiyat notu, yoksa not da yok", () => {
    const { unmount } = view([DEST]);
    const card = screen.getByTestId("destination-card");
    expect(card).not.toHaveTextContent("Fourth");
    expect(card).toHaveTextContent("Check-up");
    expect(card).toHaveTextContent("from €1,800");
    expect(screen.getByTestId("destinations-price-note")).toHaveTextContent("final price after medical evaluation");
    unmount();
    view([{ ...DEST, treatments: DEST.treatments.map((t) => ({ ...t, price: null })) }]);
    expect(screen.queryByTestId("destinations-price-note")).toBeNull();
    expect(screen.getByTestId("destination-card")).not.toHaveTextContent("from");
  });

  it("görsel alt metniyle çizilir; paketler bağlantısı ve eşleştirme eylemi var", () => {
    view([DEST]);
    expect(screen.getByAltText("Bosphorus")).toBeInTheDocument();
    expect(screen.getByTestId("destinations-explore-packages")).toHaveAttribute("href", "/en/packages");
    expect(screen.getByRole("link", { name: /find the right service/i })).toBeInTheDocument();
  });
});

describe("sözlük eşitliği (9 dil)", () => {
  const DICTS = { en, tr, de, es, fr, ar, ru, ro, "sr-latn": srLatn };
  it.each(["destinations", "contactCta"] as const)("%s anahtarları aynı, boş değer yok", (section) => {
    const keys = Object.keys(en[section]).sort();
    for (const [code, d] of Object.entries(DICTS)) {
      expect(Object.keys(d[section]).sort(), code).toEqual(keys);
      for (const v of Object.values(d[section])) expect(String(v).trim().length, code).toBeGreaterThan(0);
    }
  });

  it("destinations yer tutucuları dillerde korunur", () => {
    for (const [code, d] of Object.entries(DICTS)) {
      expect(d.destinations.sectionIntro, code).toContain("{site}");
      expect(d.destinations.patientsLastYear, code).toContain("{count}");
      expect(d.destinations.fromPrice, code).toContain("{price}");
    }
  });
});
