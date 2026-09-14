import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoctorProfilePanel } from "@/components/site/telehealth/doctor-profile-panel";
import type { DoctorPortalProfile } from "@/lib/api/types";

/**
 * Bug fix (backend-agent/frontend-agent/qa-agent) — doktor `/doctor/profile` formunu hiçbir
 * bilimsel yayın/özgeçmiş girdisi OLMADAN kaydettiğinde `422` ile engelleniyordu. Backend
 * (`UpdateDoctorSelfProfileRequestSchema`) VE frontend (`DoctorProfilePanel`) zaten `cvEntries`/
 * `publications`'ı boş dizi olarak gönderiyor — bu regresyon testi bu davranışı KİLİTLER.
 */

const updateDoctorSelfProfile = vi.fn();

vi.mock("@/lib/api/telehealth", () => ({
  updateDoctorSelfProfile: (...args: unknown[]) => updateDoctorSelfProfile(...args),
}));

// Tiptap `useEditor` jsdom'da ağır/gereksiz — bu test `aboutHtml` içeriğini DEĞİL, boş
// yayın/CV listesiyle kaydetmeyi doğruluyor, bu yüzden gerçek editör YERİNE dar bir stub kullanılır.
vi.mock("@/components/site/telehealth/doctor-about-editor", () => ({
  DoctorAboutEditor: () => <div data-testid="about-editor-stub" />,
}));

function makeDoctorProfile(overrides: Partial<DoctorPortalProfile["doctorProfile"]> = {}) {
  return {
    id: "doctor-1",
    userId: "user-1",
    specialtyId: "specialty-1",
    specialty: {
      id: "specialty-1",
      name: "Kardiyoloji",
      slug: "kardiyoloji",
      icon: "heart",
      description: null,
      order: 0,
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    title: "Dr.",
    fullName: "Elif Aydemir",
    slug: "dr-elif-aydemir",
    subSpecialty: null,
    bio: "Örnek biyografi.",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
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

const portalProfile: DoctorPortalProfile = {
  userId: "user-1",
  email: "doktor@example.com",
  name: "Elif Aydemir",
  twoFactorEnabled: true,
  doctorProfile: makeDoctorProfile(),
};

vi.mock("@/components/site/telehealth/doctor-portal-shell", () => ({
  useDoctorPortalProfile: () => portalProfile,
}));

describe("DoctorProfilePanel", () => {
  beforeEach(() => {
    updateDoctorSelfProfile.mockReset();
  });

  it("hiçbir yayın/özgeçmiş girdisi olmadan kaydedince `cvEntries`/`publications` boş dizi olarak gönderilir ve 200 sonrası başarı rozeti görünür", async () => {
    updateDoctorSelfProfile.mockResolvedValue({ doctorProfile: makeDoctorProfile({ bio: "Güncel özet" }) });
    const user = userEvent.setup();

    render(<DoctorProfilePanel />);

    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(updateDoctorSelfProfile).toHaveBeenCalledTimes(1));
    const payload = updateDoctorSelfProfile.mock.calls[0][0];
    expect(payload.cvEntries).toEqual([]);
    expect(payload.publications).toEqual([]);
    expect(payload.subSpecialty).toBeNull();

    expect(await screen.findByText(/Profiliniz güncellendi/)).toBeInTheDocument();
  });

  it("bir yayın eklenip silindikten sonra kaydedince yine `publications: []` gönderilir ve şema patlamaz", async () => {
    updateDoctorSelfProfile.mockResolvedValue({ doctorProfile: makeDoctorProfile({ bio: "Güncel özet" }) });
    const user = userEvent.setup();

    render(<DoctorProfilePanel />);

    await user.click(screen.getByRole("button", { name: "Yayın Ekle" }));
    expect(screen.getByLabelText("Yayını kaldır")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Yayını kaldır"));
    expect(screen.queryByLabelText("Yayını kaldır")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(updateDoctorSelfProfile).toHaveBeenCalledTimes(1));
    const payload = updateDoctorSelfProfile.mock.calls[0][0];
    expect(payload.publications).toEqual([]);

    expect(await screen.findByText(/Profiliniz güncellendi/)).toBeInTheDocument();
  });
});
