import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoctorProfile, Specialty, SpecialtyWithDoctorCount } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";

const fetchSpecialtyBySlugServer = vi.fn();
const fetchDoctorsServer = vi.fn();
const fetchSpecialtiesServer = vi.fn();
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchSpecialtyBySlugServer: (...a: unknown[]) => fetchSpecialtyBySlugServer(...a),
  fetchDoctorsServer: (...a: unknown[]) => fetchDoctorsServer(...a),
  fetchSpecialtiesServer: (...a: unknown[]) => fetchSpecialtiesServer(...a),
}));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: async () => [{ code: "en", isDefault: true, enabled: true }] }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: async () => ({ siteName: "WM", liveChatEnabled: false }) }));
vi.mock("@/components/site/matcher/matcher-modal", () => ({ MatcherCtaCard: () => null }));
vi.mock("@/components/site/telehealth/doctor-card", () => ({
  DoctorCard: ({ doctor }: { doctor: { id: string } }) => <div data-testid="doctor-card">{doctor.id}</div>,
}));

const listAdminSpecialties = vi.fn();
const createSpecialty = vi.fn();
const updateSpecialty = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: () => listAdminSpecialties(),
  createSpecialty: (...a: unknown[]) => createSpecialty(...a),
  updateSpecialty: (...a: unknown[]) => updateSpecialty(...a),
  deleteSpecialty: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/translation-locale-tabs", () => ({
  CANONICAL_LOCALE_CODE: "en",
  TranslationLocaleTabs: () => null,
  getTranslation: () => "",
  isCanonicalLocale: () => true,
  setTranslation: (t: unknown) => t,
  useTranslationLocales: () => [],
}));
vi.mock("@/components/admin/page-builder/blocks/icon-picker", () => ({
  IconPickerField: ({ value }: { value: string }) => <span>ikon:{value}</span>,
}));
vi.mock("@/components/admin/media/media-select-field", () => ({ MediaSelectField: () => null }));

import SpecialtyDetailPage from "@/app/[lang]/(site)/specialties/[slug]/page";
import AdminTelehealthSpecialtiesPage from "@/app/admin/telehealth/specialties/page";
import { topLevelSpecialties } from "@/lib/specialty-hierarchy";
import { buildSpecialtyBreadcrumbJsonLd } from "@/lib/specialty-json-ld";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

const LANGS = ["en", "tr", "ar", "de", "es", "fr", "ro", "ru", "sr-latn"];

function spec(overrides: Partial<SpecialtyWithDoctorCount>): SpecialtyWithDoctorCount {
  return {
    id: overrides.slug ?? "id",
    name: "Gastroenterology",
    slug: "gastroenterology",
    icon: "Stethoscope",
    description: null,
    order: 0,
    isActive: true,
    imageMediaId: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    doctorCount: 0,
    ...overrides,
  };
}

const doctor = (id: string) => ({ id }) as unknown as DoctorProfile;

describe("Paket AG — sözlük tamlığı", () => {
  it.each(LANGS)("%s: yeni anahtarlar dolu", async (lang) => {
    const dict = await getSiteDictionary(lang);
    expect(dict.nav.specialtyProceduresTitle.trim()).not.toBe("");
    expect(dict.telehealth.specialtyProceduresTitle.trim()).not.toBe("");
    expect(dict.telehealth.physiciansPerformingProcedure.trim()).not.toBe("");
    expect(dict.telehealth.breadcrumbSpecialties.trim()).not.toBe("");
  });
});

describe("topLevelSpecialties", () => {
  it("parentId null/undefined olanları tutar, doluları eler", () => {
    const list = [{ parentId: null }, {}, { parentId: "x" }] as Pick<Specialty, "parentId">[];
    expect(topLevelSpecialties(list)).toHaveLength(2);
  });
});

describe("Alt uzmanlık sayfası", () => {
  beforeEach(() => {
    fetchSpecialtyBySlugServer.mockReset();
    fetchDoctorsServer.mockReset();
  });

  async function renderPage(slug: string) {
    render(await SpecialtyDetailPage({ params: Promise.resolve({ lang: "en", slug }) }));
  }

  it("kırıntı, BreadcrumbList ve MedicalSpecialty JSON-LD; kendi hekimi yoksa üst hekimleri başlıkla listelenir", async () => {
    fetchSpecialtyBySlugServer.mockResolvedValue(
      spec({ slug: "esd", name: "ESD", parentId: "g", parentSlug: "gastroenterology", parent: { slug: "gastroenterology", name: "Gastroenterology" } })
    );
    fetchDoctorsServer.mockImplementation(async (f: { specialtySlug?: string }) => (f.specialtySlug === "gastroenterology" ? [doctor("d1"), doctor("d2")] : []));
    await renderPage("esd");

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Specialties", "Gastroenterology"]);
    expect(links[0]).toHaveAttribute("href", "/specialties");
    expect(links[1]).toHaveAttribute("href", "/specialties/gastroenterology");
    expect(within(nav).getByText("ESD")).toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("heading", { level: 2, name: "Physicians performing this procedure" })).toBeInTheDocument();
    expect(screen.getAllByTestId("doctor-card")).toHaveLength(2);
    expect(screen.queryByTestId("specialty-coordinator-box")).toBeNull();

    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent ?? "{}"));
    expect(scripts.map((s) => s["@type"])).toEqual(["MedicalSpecialty", "BreadcrumbList"]);
    expect(scripts[1].itemListElement.map((i: { name: string }) => i.name)).toEqual(["Specialties", "Gastroenterology", "ESD"]);
    expect(scripts[1].itemListElement[2].position).toBe(3);
  });

  it("kendi hekimi varsa üst hekimleri çekilmez ve 'Physicians performing' başlığı yok", async () => {
    fetchSpecialtyBySlugServer.mockResolvedValue(
      spec({ slug: "esd", name: "ESD", parentId: "g", parent: { slug: "gastroenterology", name: "Gastroenterology" } })
    );
    fetchDoctorsServer.mockResolvedValue([doctor("own")]);
    await renderPage("esd");
    expect(screen.getAllByTestId("doctor-card")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Physicians performing this procedure" })).toBeNull();
    expect(fetchDoctorsServer).toHaveBeenCalledTimes(1);
  });

  it("alt uzmanlığın hiçbir hekimi (üstte de) yoksa koordinatör kutusu görünür", async () => {
    fetchSpecialtyBySlugServer.mockResolvedValue(
      spec({ slug: "esd", name: "ESD", parentId: "g", parent: { slug: "gastroenterology", name: "Gastroenterology" } })
    );
    fetchDoctorsServer.mockResolvedValue([]);
    await renderPage("esd");
    expect(screen.getByTestId("specialty-coordinator-box")).toBeInTheDocument();
  });

  it("üst uzmanlık: kırıntı yok, children varsa 'Procedures' bölümü alt sayfalara bağlanır", async () => {
    fetchSpecialtyBySlugServer.mockResolvedValue(
      spec({ doctorCount: 1, children: [{ slug: "esd", name: "ESD", icon: "Stethoscope" }, { slug: "poem", name: "POEM", icon: "Stethoscope" }] })
    );
    fetchDoctorsServer.mockResolvedValue([doctor("d1")]);
    await renderPage("gastroenterology");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    const section = screen.getByTestId("specialty-procedures");
    expect(within(section).getByRole("heading", { name: "Procedures" })).toBeInTheDocument();
    expect(within(section).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/specialties/esd", "/specialties/poem"]);
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
  });

  it("eski API (parent/children yok) → önceki davranış", async () => {
    fetchSpecialtyBySlugServer.mockResolvedValue(spec({ doctorCount: 1 }));
    fetchDoctorsServer.mockResolvedValue([doctor("d1")]);
    await renderPage("gastroenterology");
    expect(screen.queryByTestId("specialty-procedures")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });
});

describe("buildSpecialtyBreadcrumbJsonLd", () => {
  it("sıralı ListItem üretir", () => {
    const json = JSON.parse(buildSpecialtyBreadcrumbJsonLd([{ name: "A", url: "https://x/a" }, { name: "B", url: "https://x/b" }]));
    expect(json["@type"]).toBe("BreadcrumbList");
    expect(json.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "A", item: "https://x/a" },
      { "@type": "ListItem", position: 2, name: "B", item: "https://x/b" },
    ]);
  });
});

describe("Admin uzmanlık formu — üst uzmanlık", () => {
  const base = {
    description: null,
    order: 0,
    isActive: true,
    imageMediaId: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    icon: "Stethoscope",
  };
  const list: Specialty[] = [
    { ...base, id: "g", name: "Gastroenterology", slug: "gastroenterology", parentId: null, parentSlug: null },
    { ...base, id: "e", name: "ESD", slug: "esd", parentId: "g", parentSlug: "gastroenterology" },
    { ...base, id: "c", name: "Cardiology", slug: "cardiology", parentId: null, parentSlug: null },
  ];

  beforeEach(() => {
    listAdminSpecialties.mockReset().mockResolvedValue(list);
    updateSpecialty.mockReset();
    createSpecialty.mockReset();
  });

  it("listede alt uzmanlık 'Üst: …' rozetiyle üstün altında görünür", async () => {
    render(<AdminTelehealthSpecialtiesPage />);
    const child = await screen.findByTestId("specialty-child-row");
    expect(child).toHaveTextContent("ESD");
    expect(child).toHaveTextContent("Üst: Gastroenterology");
  });

  it("seçenekler: kendisi ve alt uzmanlıklar hariç; çocuklu uzmanlıkta seçim devre dışı", async () => {
    const user = userEvent.setup();
    render(<AdminTelehealthSpecialtiesPage />);
    await screen.findByTestId("specialty-child-row");
    await user.click(screen.getByRole("button", { name: '"Cardiology" uzmanlığını düzenle' }));
    const select = screen.getByLabelText("Üst uzmanlık") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["— Yok (üst seviye) —", "Gastroenterology"]);
    expect(select).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: '"Gastroenterology" uzmanlığını düzenle' }));
    const select2 = screen.getByLabelText("Üst uzmanlık") as HTMLSelectElement;
    expect(select2).toBeDisabled();
    expect(screen.getByText(/alt uzmanlıkları var/)).toBeInTheDocument();
  });

  it("parentId gövdeye girer; boş seçim null gönderir; 422 mesajı alanda gösterilir", async () => {
    const user = userEvent.setup();
    updateSpecialty.mockRejectedValueOnce(
      new ApiClientError(422, { code: "VALIDATION_ERROR", message: "Geçersiz", details: { parentId: ["Üst uzmanlık tek seviye olmalı."] } })
    );
    render(<AdminTelehealthSpecialtiesPage />);
    await screen.findByTestId("specialty-child-row");
    await user.click(screen.getByRole("button", { name: '"Cardiology" uzmanlığını düzenle' }));
    await user.selectOptions(screen.getByLabelText("Üst uzmanlık"), "g");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSpecialty).toHaveBeenCalled());
    expect(updateSpecialty.mock.calls[0]![1]).toMatchObject({ parentId: "g" });
    expect(await screen.findByText("Üst uzmanlık tek seviye olmalı.")).toBeInTheDocument();

    updateSpecialty.mockResolvedValueOnce(list[2]);
    await user.selectOptions(screen.getByLabelText("Üst uzmanlık"), "");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSpecialty).toHaveBeenCalledTimes(2));
    expect(updateSpecialty.mock.calls[1]![1]).toMatchObject({ parentId: null });
  });
});
