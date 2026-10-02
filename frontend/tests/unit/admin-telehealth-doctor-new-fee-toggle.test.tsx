import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewDoctorPage from "@/app/admin/telehealth/doctors/new/page";
import type { DoctorProfile, Specialty } from "@/lib/api/types";

/**
 * Admin panelde "Ücret Bilgisi Belirle / Ücretli Hizmet" switch'i — KAPALI iken "Seans
 * süresi"/"Seans ücreti"/"Para birimi" alanları gizlenir VE `sessionPriceCents: null` gönderilir
 * (backend `DoctorProfile.sessionPriceCents` artık nullable — bkz. `schema.prisma`). AÇIK
 * (varsayılan) iken mevcut davranış AYNEN korunur (kuruş cinsine çevrilmiş bir sayı gönderilir).
 */

const createDoctor = vi.fn();
const routerPush = vi.fn();
const listAdminSpecialties = vi.fn(async () => [] as Specialty[]);

vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: (...args: unknown[]) => listAdminSpecialties(...(args as [])),
  createDoctor: (...args: unknown[]) => createDoctor(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

function makeSpecialty(overrides: Partial<Specialty> = {}): Specialty {
  return {
    id: "specialty-1",
    name: "Obesity & Metabolic Surgery",
    slug: "obesity-metabolic-surgery",
    icon: "stethoscope",
    description: null,
    order: 0,
    isActive: true,
    imageMediaId: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Dr.",
    fullName: "Yeni Doktor",
    slug: "yeni-doktor",
    subSpecialty: null,
    bio: "Test.",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    socialLinks: [],
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: null,
    currency: "TRY",
    avatarMediaId: null,
    avatarMedia: null,
    isVerified: false,
    verifiedAt: null,
    isActive: true,
    order: 0,
    availability: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("NewDoctorPage — 'Ücretli Hizmet' switch (opsiyonel seans ücreti)", () => {
  beforeEach(() => {
    createDoctor.mockReset();
    routerPush.mockReset();
    listAdminSpecialties.mockReset();
    listAdminSpecialties.mockResolvedValue([]);
  });

  it("switch varsayılan AÇIK — ücret alanları görünür ve `sessionPriceCents` sayı olarak gönderilir", async () => {
    createDoctor.mockResolvedValue(makeDoctor({ sessionPriceCents: 60000 }));
    const user = userEvent.setup();
    render(<NewDoctorPage />);

    expect(screen.getByLabelText(/Seans ücreti/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Ad soyad/), "Test Doktor");
    await user.type(screen.getByLabelText(/Biyografi/), "Kısa biyografi.");
    await user.clear(screen.getByLabelText(/Seans ücreti/));
    await user.type(screen.getByLabelText(/Seans ücreti/), "600");
    await user.click(screen.getByRole("button", { name: /Oluştur ve müsaitliği ayarla/ }));

    await waitFor(() => expect(createDoctor).toHaveBeenCalledTimes(1));
    expect(createDoctor.mock.calls[0]![0]).toMatchObject({ sessionPriceCents: 60000 });
  });

  it("switch KAPATILINCA ücret alanları gizlenir ve `sessionPriceCents: null` gönderilir", async () => {
    createDoctor.mockResolvedValue(makeDoctor());
    const user = userEvent.setup();
    render(<NewDoctorPage />);

    await user.click(screen.getByLabelText("Ücretli hizmet mi"));
    expect(screen.queryByLabelText(/Seans ücreti/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Ad soyad/), "Ücretsiz Doktor");
    await user.type(screen.getByLabelText(/Biyografi/), "Kısa biyografi.");
    await user.click(screen.getByRole("button", { name: /Oluştur ve müsaitliği ayarla/ }));

    await waitFor(() => expect(createDoctor).toHaveBeenCalledTimes(1));
    expect(createDoctor.mock.calls[0]![0]).toMatchObject({ sessionPriceCents: null });
  });
});

/**
 * [DPI] §1.1 — `DoctorSocialLinksEditor` admin "Yeni Doktor" formuna kablolanmış mı (ekle/sil/
 * gönder). Editörün KENDİ liste mantığı (`platform`/`url`/`label` alan davranışı) `doctor-cv-
 * entries-editor.tsx`/`doctor-publications-editor.tsx` İLE AYNI "kontrollü liste" desenidir —
 * burada yalnızca formla UÇTAN UCA entegrasyon doğrulanır.
 */
describe("NewDoctorPage — sosyal medya/web bağlantıları", () => {
  beforeEach(() => {
    createDoctor.mockReset();
    routerPush.mockReset();
    listAdminSpecialties.mockReset();
    listAdminSpecialties.mockResolvedValue([]);
  });

  it("'Bağlantı Ekle' ile eklenen satır doldurulup `createDoctor`'a `socialLinks` olarak gönderilir", async () => {
    createDoctor.mockResolvedValue(
      makeDoctor({ socialLinks: [{ platform: "instagram", url: "https://instagram.com/doc", label: "" }] })
    );
    const user = userEvent.setup();
    render(<NewDoctorPage />);

    await user.click(screen.getByRole("button", { name: "Bağlantı Ekle" }));
    await user.type(screen.getByLabelText("Bağlantı 1 adresi"), "https://instagram.com/doc");

    await user.type(screen.getByLabelText(/Ad soyad/), "Sosyal Doktor");
    await user.type(screen.getByLabelText(/Biyografi/), "Kısa biyografi.");
    await user.click(screen.getByRole("button", { name: /Oluştur ve müsaitliği ayarla/ }));

    await waitFor(() => expect(createDoctor).toHaveBeenCalledTimes(1));
    expect(createDoctor.mock.calls[0]![0].socialLinks).toEqual([
      { platform: "instagram", url: "https://instagram.com/doc", label: "" },
    ]);
  });

  it("'N. bağlantıyı kaldır' ile eklenen satır formdan silinir", async () => {
    const user = userEvent.setup();
    render(<NewDoctorPage />);

    await user.click(screen.getByRole("button", { name: "Bağlantı Ekle" }));
    expect(screen.getByLabelText("Bağlantı 1 adresi")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1. bağlantıyı kaldır" }));
    expect(screen.queryByLabelText("Bağlantı 1 adresi")).not.toBeInTheDocument();
  });

  it("8 bağlantıya ulaşınca 'Bağlantı Ekle' butonu devre dışı kalır", async () => {
    const user = userEvent.setup();
    render(<NewDoctorPage />);

    const addButton = screen.getByRole("button", { name: "Bağlantı Ekle" });
    for (let i = 0; i < 8; i++) {
      await user.click(addButton);
    }

    expect(screen.getAllByLabelText(/Bağlantı \d+ adresi/)).toHaveLength(8);
    expect(addButton).toBeDisabled();
  });
});

/**
 * `docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md` madde 2 (`DoctorAdditionalSpecialty`)
 * — admin "Yeni Doktor" formundaki "Ek uzmanlıklar" çoklu seçimi: render, 5 limiti, birincil
 * uzmanlıkla çakışmanın UI'da engellenmesi ve `additionalSpecialtyIds` payload'ı.
 */
describe("NewDoctorPage — ek uzmanlıklar (çoklu seçim)", () => {
  const specialties = [
    makeSpecialty({ id: "s1", name: "Obezite ve Metabolik Cerrahi", slug: "obezite" }),
    makeSpecialty({ id: "s2", name: "Cerrahi Onkoloji", slug: "cerrahi-onkoloji" }),
    makeSpecialty({ id: "s3", name: "Genel Cerrahi", slug: "genel-cerrahi" }),
    makeSpecialty({ id: "s4", name: "Kardiyoloji", slug: "kardiyoloji" }),
    makeSpecialty({ id: "s5", name: "Nöroloji", slug: "noroloji" }),
    makeSpecialty({ id: "s6", name: "Dermatoloji", slug: "dermatoloji" }),
  ];

  beforeEach(() => {
    createDoctor.mockReset();
    routerPush.mockReset();
    listAdminSpecialties.mockReset();
    listAdminSpecialties.mockResolvedValue(specialties);
  });

  it("uzmanlık listesi checkbox olarak render edilir", async () => {
    render(<NewDoctorPage />);
    await waitFor(() => expect(screen.getByLabelText("Obezite ve Metabolik Cerrahi ek uzmanlık olarak seç")).toBeInTheDocument());
    for (const specialty of specialties) {
      expect(screen.getByLabelText(`${specialty.name} ek uzmanlık olarak seç`)).toBeInTheDocument();
    }
  });

  it("en fazla 5 seçime izin verir; 5'e ulaşınca kalan checkbox'lar devre dışı kalır", async () => {
    const user = userEvent.setup();
    render(<NewDoctorPage />);
    await waitFor(() => expect(screen.getByLabelText("Obezite ve Metabolik Cerrahi ek uzmanlık olarak seç")).toBeInTheDocument());

    for (const specialty of specialties.slice(0, 5)) {
      await user.click(screen.getByLabelText(`${specialty.name} ek uzmanlık olarak seç`));
    }

    expect(screen.getByText("5/5 seçildi")).toBeInTheDocument();
    const lastCheckbox = screen.getByLabelText(`${specialties[5]!.name} ek uzmanlık olarak seç`);
    expect(lastCheckbox).toBeDisabled();
    expect(screen.getByText(/En fazla 5 uzmanlık seçebilirsiniz\./)).toBeInTheDocument();
  });

  it("birincil uzmanlık olarak seçilen, ek uzmanlık listesinde devre dışı kalır", async () => {
    const user = userEvent.setup();
    render(<NewDoctorPage />);
    await waitFor(() => expect(screen.getByLabelText("Obezite ve Metabolik Cerrahi ek uzmanlık olarak seç")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Uzmanlık"), "s1");

    expect(screen.getByLabelText("Obezite ve Metabolik Cerrahi ek uzmanlık olarak seç")).toBeDisabled();
  });

  it("birincil uzmanlık DEĞİŞTİRİLİP yeni değer ek uzmanlık listesinde seçiliyse, o seçim otomatik kaldırılır", async () => {
    const user = userEvent.setup();
    render(<NewDoctorPage />);
    await waitFor(() => expect(screen.getByLabelText("Cerrahi Onkoloji ek uzmanlık olarak seç")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Cerrahi Onkoloji ek uzmanlık olarak seç"));
    expect(screen.getByLabelText("Cerrahi Onkoloji ek uzmanlık olarak seç")).toBeChecked();

    await user.selectOptions(screen.getByLabelText("Uzmanlık"), "s2");

    expect(screen.getByLabelText("Cerrahi Onkoloji ek uzmanlık olarak seç")).not.toBeChecked();
  });

  it("kaydetme payload'ı `additionalSpecialtyIds` içerir", async () => {
    createDoctor.mockResolvedValue(makeDoctor());
    const user = userEvent.setup();
    render(<NewDoctorPage />);
    await waitFor(() => expect(screen.getByLabelText("Cerrahi Onkoloji ek uzmanlık olarak seç")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Cerrahi Onkoloji ek uzmanlık olarak seç"));
    await user.click(screen.getByLabelText("Genel Cerrahi ek uzmanlık olarak seç"));

    await user.type(screen.getByLabelText(/Ad soyad/), "Ek Uzmanlıklı Doktor");
    await user.type(screen.getByLabelText(/Biyografi/), "Kısa biyografi.");
    await user.click(screen.getByRole("button", { name: /Oluştur ve müsaitliği ayarla/ }));

    await waitFor(() => expect(createDoctor).toHaveBeenCalledTimes(1));
    expect(createDoctor.mock.calls[0]![0].additionalSpecialtyIds).toEqual(["s2", "s3"]);
  });
});
