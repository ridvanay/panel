import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { DoctorProfile, Specialty } from "@/lib/api/types";
import { homeStrings as en } from "@/lib/i18n/site-dictionaries/en/home";
import { homeStrings as tr } from "@/lib/i18n/site-dictionaries/tr/home";
import { telehealthStrings as enTelehealth } from "@/lib/i18n/site-dictionaries/en/telehealth";
import {
  buildDefaultHomeContent,
  buildHomeTemplateCreatePayload,
  findHomeBlockData,
  isHomeTemplatePage,
  resolveHomeContent,
  toEditableHomeContent,
} from "@/lib/home-page";

const fetchSpecialtiesServer = vi.fn<() => Promise<Specialty[]>>();
const fetchDoctorsServer = vi.fn<() => Promise<DoctorProfile[]>>();
const fetchTelehealthThemeServer = vi.fn();
const isModuleEnabledServer = vi.fn<(key: string) => Promise<boolean>>();
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchSpecialtiesServer: () => fetchSpecialtiesServer(),
  fetchDoctorsServer: () => fetchDoctorsServer(),
  fetchTelehealthThemeServer: () => fetchTelehealthThemeServer(),
}));
vi.mock("@/lib/api/server-modules", () => ({ isModuleEnabledServer: (key: string) => isModuleEnabledServer(key) }));
vi.mock("@/components/site/about/about-doctors", () => ({
  AboutDoctors: ({ section, doctors }: { section: { title: string }; doctors: { id: string }[] }) => (
    <section data-testid="doctors-section">
      <h2>{section.title}</h2>
      <span data-testid="doctor-count">{doctors.length}</span>
    </section>
  ),
}));

const { HomePageView } = await import("@/components/site/home/home-page-view");
const { HomeTemplateForm } = await import("@/components/admin/page-builder/home-template-form");

function specialty(slug: string): Specialty {
  return {
    id: slug,
    name: slug,
    slug,
    icon: "HeartPulse",
    description: null,
    order: 0,
    isActive: true,
    imageMediaId: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  isModuleEnabledServer.mockResolvedValue(true);
  fetchSpecialtiesServer.mockResolvedValue([specialty("kardiyoloji"), specialty("dermatoloji")]);
  fetchDoctorsServer.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }) as DoctorProfile));
  fetchTelehealthThemeServer.mockResolvedValue({ emergencyNotice: { enabled: false, summary: {}, full: {} } });
});

describe("lib/home-page", () => {
  it("boş veri → sözlük varsayılanları (3 güven maddesi, 3 adım, 6 kolon, 3 doktor)", () => {
    const content = resolveHomeContent({}, buildDefaultHomeContent(en));
    expect(content.hero.title).toBe(en.heroTitle);
    expect(content.hero.secondaryCta).toEqual({ label: en.heroSecondaryCta, href: "#how" });
    expect(content.trust.items).toHaveLength(3);
    expect(content.how.steps).toHaveLength(3);
    expect(content.specialties.columns).toBe(6);
    expect(content.doctors.count).toBe(3);
  });

  it("dolu alanlar kullanılır, boş alan varsayılana düşer, başlıksız madde atlanır", () => {
    const content = resolveHomeContent(
      {
        hero: { title: "Custom", body: "  " },
        trust: { items: [{ id: "x", icon: "Globe", title: "Only one", text: "t" }, { id: "y", icon: "Globe", title: "", text: "t" }] },
        doctors: { count: 99 },
        closing: { enabled: false },
      },
      buildDefaultHomeContent(tr)
    );
    expect(content.hero.title).toBe("Custom");
    expect(content.hero.body).toBe(tr.heroBody);
    expect(content.trust.items.map((i) => i.title)).toEqual(["Only one"]);
    expect(content.doctors.count).toBe(3);
    expect(content.closing.enabled).toBe(false);
  });

  it("şablon tespiti ve admin formu için doldurmadan okuma", () => {
    const blocks = [{ id: "home-page-root", type: "home-page", data: { hero: { title: "" } } }];
    expect(isHomeTemplatePage({ blocks, translations: {} })).toBe(true);
    expect(isHomeTemplatePage({ blocks: [{ id: "a", type: "heading", data: {} }], translations: {} })).toBe(false);
    const editable = toEditableHomeContent(findHomeBlockData(blocks), buildDefaultHomeContent(en));
    expect(editable.hero.title).toBe("");
    expect(editable.trust.items).toHaveLength(3); // liste kaydedilmemişse form varsayılan maddelerle başlar
  });

  it("Yeni Sayfa gövdesi: varsayılan dil kendi sözlüğüyle, diğer dil çeviri olarak — varsayılan dilden bağımsız", () => {
    const enDefault = buildHomeTemplateCreatePayload([
      { code: "en", isDefault: true, enabled: true },
      { code: "tr", isDefault: false, enabled: true },
    ]);
    expect(enDefault.editMode).toBe("TEMPLATE");
    expect((findHomeBlockData(enDefault.blocks) as { hero: { title: string } }).hero.title).toBe(en.heroTitle);
    const trBlocks = (enDefault.translations as Record<string, { blocks: unknown[] }>).tr!.blocks;
    expect((findHomeBlockData(trBlocks) as { hero: { title: string } }).hero.title).toBe(tr.heroTitle);

    const trDefault = buildHomeTemplateCreatePayload([
      { code: "tr", isDefault: true, enabled: true },
      { code: "en", isDefault: false, enabled: false },
    ]);
    expect((findHomeBlockData(trDefault.blocks) as { hero: { title: string } }).hero.title).toBe(tr.heroTitle);
    expect(trDefault.translations).toBeUndefined(); // EN kapalı → çeviri yazılmaz
  });
});

describe("HomePageView", () => {
  it("tüm bölümler sırayla; görselsiz hero düzgün; #how çapası; uzmanlık bağlantısı dil önekli; acil durum özeti", async () => {
    const { container } = render(await HomePageView({ data: {}, siteContext: { lang: "en", defaultLocaleCode: "tr" } }));
    expect(screen.getByRole("heading", { level: 1, name: en.heroTitle })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull(); // görsel yok → dekoratif alan
    expect(screen.getByRole("link", { name: en.heroSecondaryCta })).toHaveAttribute("href", "#how");
    expect(screen.getAllByRole("link", { name: en.heroPrimaryCta })[0]).toHaveAttribute("href", "/en/doctors");
    expect(container.querySelector("#how")).not.toBeNull();
    expect(screen.getByText(en.trust2Title)).toBeInTheDocument();
    // Masaüstü (başlık yanında) + mobil (ızgara altında) kopyası — ikisi de aynı hedefe gider.
    const viewAll = screen.getAllByRole("link", { name: /View all specialties/ });
    expect(viewAll).toHaveLength(2);
    for (const link of viewAll) expect(link).toHaveAttribute("href", "/en/specialties");
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "kardiyoloji" })).toHaveAttribute("href", "/en/specialties/kardiyoloji");
    expect(screen.getByTestId("doctor-count")).toHaveTextContent("3");
    // Şerit anahtarı kapalı olsa bile kapanış bandında acil durum özeti her zaman.
    expect(within(screen.getByRole("note")).getByText(enTelehealth.emergencyNoticeSummary)).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([en.specialtiesTitle, en.howTitle, en.doctorsTitle, en.closingTitle]);
  });

  it("gizlenen bölümler render edilmez; how gizliyse hero'daki #how butonu da gösterilmez; görsel priority ile yüklenir", async () => {
    render(
      await HomePageView({
        data: {
          hero: { imageUrl: "https://cdn.example.com/hero.jpg", imageAlt: "Doctor on a video call" },
          how: { enabled: false, steps: [] },
          trust: { enabled: false, items: [] },
          doctors: { enabled: false },
        },
        siteContext: { lang: "tr", defaultLocaleCode: "tr" },
      })
    );
    expect(screen.queryByRole("link", { name: tr.heroSecondaryCta })).toBeNull();
    expect(screen.queryByText(tr.trust1Title)).toBeNull();
    expect(screen.queryByTestId("doctors-section")).toBeNull();
    const image = screen.getByAltText("Doctor on a video call");
    expect(image.getAttribute("loading") === "eager" || image.getAttribute("fetchpriority") === "high").toBe(true);
  });

  it("tele-sağlık modülü kapalıysa uzmanlık ve doktor bölümleri görünmez, sayfa yine render edilir", async () => {
    isModuleEnabledServer.mockResolvedValue(false);
    render(await HomePageView({ data: {}, siteContext: { lang: "en", defaultLocaleCode: "en" } }));
    expect(screen.queryByText(en.specialtiesTitle)).toBeNull();
    expect(screen.queryByTestId("doctors-section")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("toOptimizableMediaUrl", () => {
  it("göreli medya yolunu medya host'una bağlar, mutlak URL'e dokunmaz", async () => {
    const { toOptimizableMediaUrl } = await import("@/lib/env");
    expect(toOptimizableMediaUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(toOptimizableMediaUrl("//cdn.example.com/a.jpg")).toBe("//cdn.example.com/a.jpg");
    expect(toOptimizableMediaUrl("/uploads/a.jpg")).toMatch(/^https?:\/\/[^/]+\/uploads\/a\.jpg$/);
  });
});

describe("HomeTemplateForm", () => {
  it("bölüm gizleme, madde ekleme ve en az madde sınırı", () => {
    const onChange = vi.fn();
    const value = toEditableHomeContent({}, buildDefaultHomeContent(en));
    render(<HomeTemplateForm value={value} onChange={onChange} localeCode="en" />);

    fireEvent.click(screen.getAllByRole("switch", { name: "Bölümü göster" })[1]!); // Güven şeridi
    expect(onChange.mock.calls.at(-1)![0].trust.enabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Madde ekle/ }));
    expect(onChange.mock.calls.at(-1)![0].trust.items).toHaveLength(4);

    expect(screen.getByLabelText("Masaüstü kolon sayısı")).toHaveValue("6");
    expect(screen.getByLabelText("Gösterilecek doktor sayısı")).toHaveValue(3);
    expect(screen.getAllByPlaceholderText(en.heroTitle).length).toBeGreaterThan(0);
  });
});
