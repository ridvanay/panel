import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { PublicContactPage, SiteSettings } from "@/lib/api/types";

/**
 * Paket AK (K5) — iletişim sayfası: "Call center" etiketi (CSS büyük harf: CALL CENTER) + 24/7 notu (8 dil), adres
 * önceliğiyle harita bağlantısı, `hoursVisible` ile çalışma saatleri kartı, Türkçe gün adlarının ziyaretçi diline
 * eşlenmesi; `Organization` JSON-LD adresi (posta kodu YOK) ve telefonu.
 */
const mocks = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/contact",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/server-contact", () => ({ fetchContactPageServer: () => mocks.page() }));
vi.mock("@/lib/api/server-locales", () => ({
  fetchLocalesServer: async () => [{ code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null }],
}));
vi.mock("@/lib/api/server-modules", () => ({ isModuleEnabledServer: async () => false }));
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchDoctorBySlugServer: async () => null,
  fetchSpecialtiesServer: async () => [],
  fetchTelehealthThemeServer: async () => null,
}));
vi.mock("next/font/google", () => ({ Newsreader: () => ({ variable: "about-serif", className: "about-serif" }) }));
vi.mock("@/components/site/contact/contact-page-form", () => ({ ContactPageForm: () => null }));

import ContactPage from "@/app/[lang]/(site)/contact/page";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { buildOrganizationJsonLd } from "@/lib/page-builder/structured-data";
import { CONTACT_DAY_NAMES, localizeHoursLabel } from "@/lib/contact-hours";
import { mapsHref } from "@/lib/contact-links";

const ADDRESS = "Atatürk Mah. Ertuğrul Gazi Sk. Metropol İstanbul C1 Blok No: 2B İç Kapı No: 168, Ataşehir / İstanbul, Türkiye";
const LANGS = ["en", "de", "ar", "fr", "ro", "sr-latn", "es", "ru"] as const;

function contactPage(over: Partial<PublicContactPage> = {}, content: Partial<PublicContactPage["content"]> = {}): PublicContactPage {
  return {
    locale: "en",
    content: {
      title: "",
      intro: "",
      phone: "+90 212 000 00 00",
      whatsapp: "",
      email: "info@example.com",
      address: ADDRESS,
      hours: [{ label: "Pazartesi – Cuma", value: "09:00 – 18:00" }],
      responseTime: "",
      ...content,
    },
    whatsappDigits: "",
    mapImageUrl: null,
    mapUrl: "https://maps.app.goo.gl/old-address",
    hoursVisible: true,
    privacyPage: null,
    consent: { notice: "", explicit: "", privacyLinkLabel: "" },
    treatmentNotSure: "not_sure",
    ...over,
  };
}

async function renderContact(lang = "en", page = contactPage()) {
  mocks.page.mockResolvedValue(page);
  render(await ContactPage({ params: Promise.resolve({ lang }) }));
}

beforeEach(() => mocks.page.mockReset());

describe("iletişim sayfası — çağrı merkezi", () => {
  it("telefon satırı 'Call center' etiketi taşar (CSS ile büyük harf), numaranın altında 24/7 notu", async () => {
    await renderContact();
    const note = screen.getByTestId("contact-call-center-note");
    expect(note).toHaveTextContent("You can reach our call center 24/7.");
    const row = note.closest("li")!;
    expect(within(row).getByText("Call center")).toHaveClass("uppercase");
    expect(within(row).getByRole("link", { name: "+90 212 000 00 00" })).toHaveAttribute("href", "tel:+902120000000");
    expect(screen.queryByText("Phone")).toBeNull();
  });

  it("not 8 dilde dolu ve her dilde farklı; etiket dilde değişir; tr sözlüğü EN metin", async () => {
    const notes = new Set<string>();
    for (const lang of LANGS) {
      const dict = await getSiteDictionary(lang);
      expect(dict.contact.callCenterNote.length).toBeGreaterThan(10);
      expect(dict.contact.callCenterShort).toMatch(/24/);
      expect(dict.contact.phoneRowLabel.length).toBeGreaterThan(2);
      notes.add(dict.contact.callCenterNote);
    }
    expect(notes.size).toBe(LANGS.length);
    expect(en.contact.callCenterNote).toBe("You can reach our call center 24/7.");
    expect(en.contact.phoneRowLabel).toBe("Call center");
    expect(tr.contact.callCenterNote).toBe(en.contact.callCenterNote);
    expect(tr.contact.phoneRowLabel).toBe("Call center");
  });

  it.each(LANGS)("%s: sayfa not ve etiketi o dilde çizer (RTL dahil)", async (lang) => {
    await renderContact(lang);
    const dict = await getSiteDictionary(lang);
    expect(screen.getByTestId("contact-call-center-note")).toHaveTextContent(dict.contact.callCenterNote);
    expect(screen.getByText(dict.contact.phoneRowLabel)).toBeInTheDocument();
  });
});

describe("iletişim sayfası — harita bağlantısı (adres önceliği)", () => {
  it("adres doluysa 'Open in Google Maps' ADRESİ arar; eski mapUrl yok sayılır", async () => {
    await renderContact();
    const link = screen.getByRole("link", { name: /Open in Google Maps/ });
    const href = link.getAttribute("href")!;
    expect(href).toContain("https://www.google.com/maps/search/?api=1&query=");
    expect(decodeURIComponent(href)).toContain("Metropol İstanbul C1 Blok No: 2B");
    expect(href).not.toContain("old-address");
  });

  it("adres boşsa mapUrl kullanılır; ikisi de boşsa bağlantı yok", () => {
    expect(mapsHref("https://maps.app.goo.gl/x", "")).toBe("https://maps.app.goo.gl/x");
    expect(mapsHref("", "")).toBeNull();
    expect(mapsHref("https://maps.app.goo.gl/x", "  ")).toBe("https://maps.app.goo.gl/x");
    expect(mapsHref("", "Kadıköy, İstanbul")).toBe("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Kadıköy, İstanbul"));
  });
});

describe("iletişim sayfası — çalışma saatleri kartı", () => {
  it("hoursVisible=false: kart hiç yok (satırlar silinmemiş olsa da)", async () => {
    await renderContact("en", contactPage({ hoursVisible: false }));
    expect(screen.queryByText("Working hours")).toBeNull();
    expect(screen.queryByText("09:00 – 18:00")).toBeNull();
  });

  it("hoursVisible=true ya da alan yok: kart görünür", async () => {
    await renderContact("en", contactPage({ hoursVisible: true }));
    expect(screen.getByText("Working hours")).toBeInTheDocument();
  });

  it("alan hiç yoksa (eski backend) kart görünür", async () => {
    const page = contactPage();
    delete (page as { hoursVisible?: boolean }).hoursVisible;
    await renderContact("en", page);
    expect(screen.getByText("Working hours")).toBeInTheDocument();
  });

  it.each([
    ["en", "Monday – Friday"],
    ["de", "Montag – Freitag"],
    ["ar", "الاثنين – الجمعة"],
    ["fr", "Lundi – Vendredi"],
    ["ro", "Luni – Vineri"],
    ["sr-latn", "Ponedeljak – Petak"],
    ["es", "Lunes – Viernes"],
    ["ru", "Понедельник – Пятница"],
  ])("%s: Türkçe gün aralığı ziyaretçi diline eşlenir", async (lang, expected) => {
    await renderContact(lang);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/Pazartesi/)).toBeNull();
  });
});

describe("localizeHoursLabel", () => {
  it("tüm gün adları 8 dilde eşlenir; büyük/küçük harf ve ayraç türleri korunur", () => {
    expect(localizeHoursLabel("PAZARTESİ - CUMA", "en")).toBe("Monday - Friday");
    expect(localizeHoursLabel("Cumartesi", "de")).toBe("Samstag");
    expect(localizeHoursLabel("Pazar", "es")).toBe("Domingo");
    expect(localizeHoursLabel("Salı — Perşembe", "fr")).toBe("Mardi — Jeudi");
    expect(localizeHoursLabel("Çarşamba", "ru")).toBe("Среда");
    expect(localizeHoursLabel("Cumartesi - Pazar", "en")).toBe("Saturday - Sunday");
    expect(localizeHoursLabel("Hafta içi", "en")).toBe("Weekdays");
    expect(localizeHoursLabel("Her gün", "de")).toBe("Täglich");
    for (const lang of LANGS) expect(Object.keys(CONTACT_DAY_NAMES[lang]!)).toContain("sunday");
  });

  it("gün adı olmayan serbest metin ve tanınmayan dil aynen döner; kelime içi eşleşme yok", () => {
    expect(localizeHoursLabel("By appointment", "de")).toBe("By appointment");
    expect(localizeHoursLabel("Pazartesi", "tr")).toBe("Pazartesi");
    expect(localizeHoursLabel("Cumhuriyet bayramı", "en")).toBe("Cumhuriyet bayramı");
    expect(localizeHoursLabel("", "en")).toBe("");
  });
});

describe("Organization JSON-LD — adres ve telefon", () => {
  const settings = { siteName: "WM Health", logoUrl: null } as unknown as SiteSettings;

  it("PostalAddress: tam adres metni, İstanbul/TR yalnızca adres içeriyorsa, posta kodu YOK; telephone", () => {
    const json = JSON.parse(buildOrganizationJsonLd(settings, [], "https://wmhealth.test", [], undefined, { phone: " +90 212 000 00 00 ", address: ADDRESS }));
    expect(json.telephone).toBe("+90 212 000 00 00");
    expect(json.address).toEqual({ "@type": "PostalAddress", streetAddress: ADDRESS, addressLocality: "Istanbul", addressCountry: "TR" });
    expect(json.address).not.toHaveProperty("postalCode");
  });

  it("adres İstanbul/Türkiye içermiyorsa locality/country eklenmez; boş adres/telefon alan üretmez", () => {
    const json = JSON.parse(buildOrganizationJsonLd(settings, [], "https://x.test", [], undefined, { phone: "", address: "Somewhere 5" }));
    expect(json.address).toEqual({ "@type": "PostalAddress", streetAddress: "Somewhere 5" });
    expect(json).not.toHaveProperty("telephone");
    const none = JSON.parse(buildOrganizationJsonLd(settings, [], "https://x.test", [], undefined, { phone: null, address: "  " }));
    expect(none).not.toHaveProperty("address");
    const legacy = JSON.parse(buildOrganizationJsonLd(settings, [], "https://x.test"));
    expect(legacy).not.toHaveProperty("address");
    expect(legacy).not.toHaveProperty("telephone");
  });

  it("İngilizce 'Istanbul' ve 'Turkey' yazımı da tanınır", () => {
    const json = JSON.parse(buildOrganizationJsonLd(settings, [], "https://x.test", [], undefined, { address: "Ataşehir, Istanbul, Turkey" }));
    expect(json.address.addressLocality).toBe("Istanbul");
    expect(json.address.addressCountry).toBe("TR");
  });
});
