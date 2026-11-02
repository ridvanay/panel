import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * Paket AH (FE2) — sayfa içerikleri: hekim adreslerinin ve ziyaretçi sepet/ödeme girişlerinin kalıcı yönlendirmesi,
 * talep formu sayfası (ön seçim, aracı kuruluş ibaresi, belge satırı), VIP sade sayfa, Hakkımızda bölümleri,
 * paket "Request this package" bağlantısı ve bölüm sayfasında hekim yokluğu.
 */
const mocks = vi.hoisted(() => ({
  doctor: vi.fn(),
  specialty: vi.fn(),
  specialties: vi.fn(),
  settings: vi.fn(),
  pages: vi.fn(),
  pkg: vi.fn(),
  locales: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: () => mocks.locales() }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: () => mocks.settings() }));
vi.mock("@/lib/api/server-pages", () => ({ fetchPublishedPagesServer: () => mocks.pages() }));
vi.mock("@/lib/api/server-packages", () => ({ fetchPackageServer: (...a: unknown[]) => mocks.pkg(...a) }));
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchDoctorBySlugServer: (...a: unknown[]) => mocks.doctor(...a),
  fetchSpecialtyBySlugServer: (...a: unknown[]) => mocks.specialty(...a),
  fetchSpecialtiesServer: (...a: unknown[]) => mocks.specialties(...a),
  fetchDoctorsServer: vi.fn(async () => {
    throw new Error("hekim listesi çekilmemeli");
  }),
}));

import PhysiciansIndexRedirect from "@/app/[lang]/(site)/physicians/page";
import PhysicianRedirect from "@/app/[lang]/(site)/physicians/[slug]/page";
import MedicalReviewersRedirect from "@/app/[lang]/(site)/medical-reviewers/page";
import CartRedirect from "@/app/[lang]/(site)/cart/page";
import CheckoutRedirect from "@/app/[lang]/(site)/checkout/page";
import CheckoutSuccessRedirect from "@/app/[lang]/(site)/checkout/success/page";
import CheckoutCancelRedirect from "@/app/[lang]/(site)/checkout/cancel/page";
import RequestPage from "@/app/[lang]/(site)/request/page";
import VipAccommodationTransferPage from "@/app/[lang]/(site)/vip-accommodation-transfer/page";
import { OurRole, WhoWeAre } from "@/components/site/about/intermediary-sections";
import { requestFormPath } from "@/lib/intermediary";

const LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "de", label: "German", nativeLabel: "Deutsch", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", isDefault: false, enabled: true, sortOrder: 2, hreflang: null },
];

const spec = (over: Record<string, unknown>) => ({
  id: over.slug,
  name: String(over.slug),
  icon: "Stethoscope",
  description: null,
  order: 0,
  isActive: true,
  parentId: null,
  ...over,
});

beforeEach(() => {
  mocks.locales.mockReset().mockResolvedValue(LOCALES);
  mocks.settings.mockReset().mockResolvedValue({ siteName: "WM Health", healthTourismCertificateNo: null });
  mocks.pages.mockReset().mockResolvedValue([]);
  mocks.doctor.mockReset().mockResolvedValue(null);
  mocks.specialty.mockReset().mockResolvedValue(null);
  mocks.pkg.mockReset().mockResolvedValue(null);
  mocks.specialties.mockReset().mockResolvedValue([
    spec({ id: "g", slug: "gastroenterology", name: "Gastroenterology", order: 1 }),
    spec({ id: "e", slug: "esd", name: "ESD", parentId: "g", order: 1 }),
    spec({ id: "d", slug: "dental", name: "Dental care", order: 2 }),
    spec({ id: "x", slug: "inactive", name: "Inactive service", isActive: false }),
  ]);
});

const params = <E extends Record<string, string> = Record<never, never>>(lang: string, extra?: E) => ({ params: Promise.resolve({ lang, ...extra } as { lang: string } & E) });

describe("Yönlendirmeler (kalıcı)", () => {
  it("/physicians → /specialties; dil önekli", async () => {
    await expect(PhysiciansIndexRedirect(params("en"))).rejects.toThrow("NEXT_REDIRECT:/specialties");
    await expect(PhysiciansIndexRedirect(params("de"))).rejects.toThrow("NEXT_REDIRECT:/de/specialties");
  });

  it("/physicians/{slug} → hekimin birincil uzmanlığı aktifse o bölüme", async () => {
    mocks.doctor.mockResolvedValue({ slug: "ali", specialty: { slug: "esd" } });
    mocks.specialty.mockResolvedValue(spec({ slug: "esd", isActive: true }));
    await expect(PhysicianRedirect(params("en", { slug: "ali" }))).rejects.toThrow("NEXT_REDIRECT:/specialties/esd");
    await expect(PhysicianRedirect(params("de", { slug: "ali" }))).rejects.toThrow("NEXT_REDIRECT:/de/specialties/esd");
  });

  it("/physicians/{slug} → uzmanlık pasif, yok ya da hekim bulunamazsa /specialties", async () => {
    mocks.doctor.mockResolvedValue({ slug: "ali", specialty: { slug: "esd" } });
    mocks.specialty.mockResolvedValue(spec({ slug: "esd", isActive: false }));
    await expect(PhysicianRedirect(params("en", { slug: "ali" }))).rejects.toThrow("NEXT_REDIRECT:/specialties");
    mocks.specialty.mockResolvedValue(null);
    await expect(PhysicianRedirect(params("en", { slug: "ali" }))).rejects.toThrow("NEXT_REDIRECT:/specialties");
    mocks.doctor.mockResolvedValue(null);
    await expect(PhysicianRedirect(params("en", { slug: "yok" }))).rejects.toThrow("NEXT_REDIRECT:/specialties");
  });

  it("/medical-reviewers → /content-standards", async () => {
    await expect(MedicalReviewersRedirect(params("en"))).rejects.toThrow("NEXT_REDIRECT:/content-standards");
    await expect(MedicalReviewersRedirect(params("ar"))).rejects.toThrow("NEXT_REDIRECT:/ar/content-standards");
  });

  it.each([
    ["sepet", CartRedirect],
    ["ödeme", CheckoutRedirect],
    ["ödeme başarılı", CheckoutSuccessRedirect],
    ["ödeme iptal", CheckoutCancelRedirect],
  ])("ziyaretçi %s sayfası → /request", async (_name, Page) => {
    await expect(Page(params("en"))).rejects.toThrow("NEXT_REDIRECT:/request");
    await expect(Page(params("de"))).rejects.toThrow("NEXT_REDIRECT:/de/request");
  });

  it("requestFormPath bölüm/paket sorgusunu taşır", () => {
    expect(requestFormPath()).toBe("/request");
    expect(requestFormPath({ service: "esd" })).toBe("/request?service=esd");
    expect(requestFormPath({ pkg: "check-up" })).toBe("/request?package=check-up");
  });
});

describe("/request sayfası", () => {
  async function renderRequest(lang = "en", query: Record<string, string> = {}) {
    return render(await RequestPage({ params: Promise.resolve({ lang }), searchParams: Promise.resolve(query) }));
  }

  it("H1, giriş metni, aktif bölümler (alt bölümler gruplu; pasif yok) ve aracı kuruluş ibaresi", async () => {
    await renderRequest();
    const dict = await getSiteDictionary("en");
    expect(screen.getByRole("heading", { level: 1, name: dict.request.pageTitle })).toBeInTheDocument();
    const select = screen.getByLabelText(dict.request.serviceLabel) as HTMLSelectElement;
    expect(select.querySelector('optgroup[label="Gastroenterology"]')).not.toBeNull();
    expect(select.querySelector('option[value="esd"]')).not.toBeNull();
    expect(select.querySelector('option[value="dental"]')).not.toBeNull();
    expect(select.querySelector('option[value="inactive"]')).toBeNull();
    expect(screen.getByTestId("intermediary-notice")).toHaveTextContent("International Health Tourism Intermediary");
    expect(screen.queryByTestId("intermediary-certificate")).toBeNull();
  });

  it("?service= bilinen bölümü önceden seçer; bilinmeyen değer yok sayılır", async () => {
    const { unmount } = await renderRequest("en", { service: "esd" });
    expect(screen.getByLabelText((await getSiteDictionary("en")).request.serviceLabel)).toHaveValue("esd");
    unmount();
    await renderRequest("en", { service: "nope" });
    expect(screen.getByLabelText((await getSiteDictionary("en")).request.serviceLabel)).toHaveValue("");
  });

  it("?package= bilinen paketi gösterir; paket yoksa yok sayılır", async () => {
    mocks.pkg.mockResolvedValue({ slug: "check-up", title: "Executive Check-up" });
    const { unmount } = await renderRequest("en", { package: "check-up" });
    expect(screen.getByTestId("request-package")).toHaveTextContent("Executive Check-up");
    expect(mocks.pkg).toHaveBeenCalledWith("check-up", "en");
    unmount();
    mocks.pkg.mockResolvedValue(null);
    await renderRequest("en", { package: "gone" });
    expect(screen.queryByTestId("request-package")).toBeNull();
  });

  it("belge numarası doluyken satır görünür", async () => {
    mocks.settings.mockResolvedValue({ siteName: "WM Health", healthTourismCertificateNo: "TS-12345" });
    await renderRequest();
    expect(screen.getByTestId("intermediary-certificate")).toHaveTextContent("Health Tourism Authorization Certificate No: TS-12345");
  });

  it("KVKK/GDPR aydınlatma ve açık rıza bağlantıları yasal sayfalardan çözülür", async () => {
    mocks.pages.mockResolvedValue([
      { slug: "privacy-notice-pdpl-kvkk", title: "Privacy Notice (PDPL / KVKK)", isLegalDocument: true },
      { slug: "explicit-consent", title: "Explicit Consent", isLegalDocument: true },
    ]);
    await renderRequest();
    const dict = await getSiteDictionary("en");
    expect(screen.getByRole("link", { name: dict.request.privacyNoticeLink })).toHaveAttribute("href", "/privacy-notice-pdpl-kvkk");
    expect(screen.getByRole("link", { name: dict.request.consentHealthLink })).toHaveAttribute("href", "/explicit-consent");
  });

  it("RTL (ar): sayfa dir=rtl ve Arapça başlık", async () => {
    await renderRequest("ar");
    const dict = await getSiteDictionary("ar");
    expect(screen.getByTestId("request-page")).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { level: 1, name: dict.request.pageTitle })).toBeInTheDocument();
  });

  it("bölüm listesi alınamazsa hata durumu: uyarı + iletişim bağlantısı", async () => {
    mocks.specialties.mockRejectedValue(new Error("boom"));
    await renderRequest();
    expect(screen.getByTestId("request-services-unavailable")).toBeInTheDocument();
  });
});

describe("VIP Accommodation & Transfer (sade sayfa)", () => {
  it.each(["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"])("%s: 6 başlık, 'Request' düğmeleri /request'e gider, FİYAT yok, ibare var", async (lang) => {
    const { container } = render(await VipAccommodationTransferPage(params(lang)));
    const dict = await getSiteDictionary(lang);
    expect(screen.getByRole("heading", { level: 1, name: dict.request.vipTitle })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
    const links = screen.getAllByTestId("vip-request");
    expect(links).toHaveLength(6);
    const prefix = lang === "en" ? "" : `/${lang}`;
    for (const link of links) {
      expect(link).toHaveAttribute("href", `${prefix}/request`);
      expect(link).toHaveTextContent(dict.request.vipRequestCta);
    }
    expect(container.textContent).not.toMatch(/[€$£₺]|\bEUR\b|\bUSD\b|\bTL\b/);
    expect(screen.getByTestId("intermediary-notice")).toBeInTheDocument();
    expect(screen.getByTestId("vip-page")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  });
});

describe("Hakkımızda — aracı kuruluş bölümleri", () => {
  it("'Who we are' bölümü #authorized-facilities çapasını taşır ve aracı kuruluş tanımını verir", async () => {
    const dict = await getSiteDictionary("en");
    render(<WhoWeAre t={dict.request} />);
    const section = screen.getByTestId("about-who-we-are");
    expect(section).toHaveAttribute("id", "authorized-facilities");
    expect(within(section).getByRole("heading", { level: 2, name: "Who we are" })).toBeInTheDocument();
    expect(section).toHaveTextContent("not a healthcare provider");
  });

  it("'Our role / What we do not do': tanı ve tedavi yapılmaz; tıbbi kararı hekim verir", async () => {
    const dict = await getSiteDictionary("en");
    render(<OurRole t={dict.request} />);
    const section = screen.getByTestId("about-our-role");
    expect(within(section).getByRole("heading", { name: "What we do not do" })).toBeInTheDocument();
    expect(section).toHaveTextContent("We do not diagnose conditions or provide treatment.");
    expect(section).toHaveTextContent("Medical decisions are made by the physician at the healthcare facility.");
  });
});

describe("Bölüm sayfası — hekim yok", () => {
  it("hekim listesi çekilmez ve hekim sayısı/başlığı çıkmaz; talep düğmesi bölümü taşır", async () => {
    const { default: SpecialtyDetailPage } = await import("@/app/[lang]/(site)/specialties/[slug]/page");
    mocks.specialty.mockResolvedValue({ ...spec({ slug: "esd", name: "ESD" }), doctorCount: 4, children: [] });
    render(await SpecialtyDetailPage({ params: Promise.resolve({ lang: "en", slug: "esd" }) }));
    expect(screen.getByTestId("specialty-request-cta")).toHaveAttribute("href", "/request?service=esd");
    expect(screen.getByTestId("specialty-request-cta")).toHaveTextContent("Request a consultation for ESD");
    expect(screen.queryByText(/\d+ physicians?/)).toBeNull();
    expect(screen.queryByText("Physicians performing this procedure")).toBeNull();
    expect(screen.getByTestId("intermediary-notice")).toBeInTheDocument();
  });
});
