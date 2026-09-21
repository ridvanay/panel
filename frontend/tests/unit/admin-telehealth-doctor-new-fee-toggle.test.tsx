import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewDoctorPage from "@/app/admin/telehealth/doctors/new/page";
import type { DoctorProfile } from "@/lib/api/types";

/**
 * Admin panelde "Ücret Bilgisi Belirle / Ücretli Hizmet" switch'i — KAPALI iken "Seans
 * süresi"/"Seans ücreti"/"Para birimi" alanları gizlenir VE `sessionPriceCents: null` gönderilir
 * (backend `DoctorProfile.sessionPriceCents` artık nullable — bkz. `schema.prisma`). AÇIK
 * (varsayılan) iken mevcut davranış AYNEN korunur (kuruş cinsine çevrilmiş bir sayı gönderilir).
 */

const createDoctor = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: vi.fn(async () => []),
  createDoctor: (...args: unknown[]) => createDoctor(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

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
