import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicContactPage } from "@/lib/api/types";

/**
 * Paket AN — iletişim sayfasında (yalnız /contact) eskiden soluk olan açıklama metinleri `font-semibold` (600):
 * breadcrumb, giriş paragrafı, "Fields marked * are required.", form yardım/rıza notları, çağrı merkezi notu, satır
 * etiket ve değerleri, harita adresi, acil durum uyarısı. Başlıklar (h1, h2) değişmez; renk/boyut/font ailesi değişmez.
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
// Telehealth modülü açık: acil durum uyarısı (varsayılan metin) sayfada çizilir.
vi.mock("@/lib/api/server-modules", () => ({ isModuleEnabledServer: async () => true }));
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchDoctorBySlugServer: async () => null,
  fetchSpecialtiesServer: async () => [],
  fetchTelehealthThemeServer: async () => null,
}));
vi.mock("next/font/google", () => ({ Newsreader: () => ({ variable: "about-serif", className: "about-serif" }) }));
vi.mock("@/components/site/contact/contact-page-form", () => ({ ContactPageForm: () => null }));

import ContactPage from "@/app/[lang]/(site)/contact/page";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";

const ADDRESS = "Atatürk Mah. Ertuğrul Gazi Sk. Metropol İstanbul C1 Blok No: 2B İç Kapı No: 168, Ataşehir / İstanbul, Türkiye";

function contactPage(): PublicContactPage {
  return {
    locale: "en",
    content: {
      title: "",
      intro: "Send us your question and our coordinators will get back to you.",
      phone: "+90 212 000 00 00",
      whatsapp: "+90 555 000 00 00",
      email: "info@example.com",
      address: ADDRESS,
      hours: [{ label: "Monday – Friday", value: "09:00 – 18:00" }],
      responseTime: "",
    },
    whatsappDigits: "905550000000",
    mapImageUrl: null,
    mapUrl: "",
    hoursVisible: true,
    privacyPage: null,
    consent: { notice: "", explicit: "", privacyLinkLabel: "" },
    treatmentNotSure: "not_sure",
  };
}

async function renderContact() {
  mocks.page.mockResolvedValue(contactPage());
  render(await ContactPage({ params: Promise.resolve({ lang: "en" }) }));
}

const semibold = (el: Element | null) => expect(el?.className ?? "").toMatch(/(^|\s)font-semibold(\s|$)/);

describe("Paket AN — iletişim sayfası açıklama metinleri font-semibold", () => {
  it("breadcrumb, giriş paragrafı ve 'zorunlu alan' notu 600", async () => {
    await renderContact();
    semibold(screen.getByRole("navigation", { name: en.ui.breadcrumb }));
    semibold(screen.getByText(contactPage().content.intro));
    semibold(screen.getByText(en.contact.requiredNote));
  });

  it("iletişim kartı: satır etiketleri, değerler (telefon, WhatsApp, e-posta, adres) ve çağrı merkezi notu 600", async () => {
    await renderContact();
    // Etiketler kartta büyük harfli `<p>` olarak çizilir (mobil düğmelerde aynı kelimeler de geçebilir).
    for (const label of [en.contact.phoneRowLabel, en.contact.whatsappRowLabel, en.contact.emailRowLabel, en.contact.addressRowLabel]) {
      const rowLabel = screen.getAllByText(label).find((el) => el.tagName === "P" && el.className.includes("uppercase"));
      semibold(rowLabel ?? null);
    }
    semibold(screen.getByText("info@example.com").closest("a"));
    semibold(screen.getByText("+90 212 000 00 00").closest("a"));
    semibold(screen.getByText("+90 555 000 00 00").closest("a"));
    semibold(screen.getByTestId("contact-call-center-note"));
  });

  it("harita kartındaki adres ve çalışma saatleri (etiket + değer) 600", async () => {
    await renderContact();
    const addressTexts = screen.getAllByText(ADDRESS);
    // Biri iletişim kartı bağlantısı, biri harita kartı paragrafı — ikisi de 600.
    expect(addressTexts.length).toBeGreaterThanOrEqual(2);
    for (const el of addressTexts) semibold(el.closest("a") ?? el);
    semibold(screen.getByText("Monday – Friday"));
    semibold(screen.getByText("09:00 – 18:00"));
  });

  it("acil durum uyarısı yalnız iletişim sayfasında kalın (sarmalayıcı); ortak bileşen değişmedi", async () => {
    await renderContact();
    const wrapper = screen.getByTestId("contact-emergency-notice");
    expect(wrapper.className).toContain("[&_p]:font-semibold");
    expect(wrapper.querySelector("p")).not.toBeNull();
    const shared = readFileSync(path.resolve(__dirname, "../../src/components/site/telehealth/emergency-notice.tsx"), "utf8");
    expect(shared).toContain('<p className="text-sm leading-relaxed">{text}</p>');
  });

  it("başlıklar değişmedi: h1'de font-semibold yok; h2'ler eski sınıflarıyla", async () => {
    await renderContact();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).not.toMatch(/font-(semibold|bold|medium)/);
    const formTitle = screen.getByRole("heading", { level: 2, name: en.contact.formTitle });
    expect(formTitle.className).toBe("text-2xl font-semibold text-foreground");
    const details = document.getElementById("contact-details-title");
    expect(details?.className).toBe("text-lg font-semibold text-foreground");
  });
});

describe("Paket AN — iletişim formu yardım ve rıza metinleri font-semibold (kaynak denetimi)", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/components/site/contact/contact-page-form.tsx"), "utf8");

  it("muted/body token'lı tüm açıklama metinleri font-semibold taşır", () => {
    const tokenLines = src.split("\n").filter((l) => /text-\[var\(--about-(muted|body)-text\)\]/.test(l));
    expect(tokenLines.length).toBeGreaterThanOrEqual(5);
    for (const line of tokenLines) expect(line).toMatch(/font-semibold/);
  });

  it("rıza ve gizlilik onay etiketleri (iki checkbox label) font-semibold", () => {
    const labels = src.split("\n").filter((l) => l.includes('className="flex cursor-pointer items-start gap-3'));
    expect(labels).toHaveLength(2);
    for (const line of labels) expect(line).toMatch(/font-semibold/);
  });
});

describe("Paket AN — kapsam yalnız /contact", () => {
  it("paylaşılan --about-* token'larına ya da globals.css'e kalınlık eklenmedi", () => {
    const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/--about-(body|muted)-text[^;]*;\s*font-weight/);
    // Mevcut tek kural başlık serif fontunun 400'ü (AN öncesi); .contact-page kapsamında kalın (500+) kural eklenmedi.
    expect(css).not.toMatch(/\.contact-page[^{]*\{[^}]*font-weight:\s*[5-9]00/);
  });
});
