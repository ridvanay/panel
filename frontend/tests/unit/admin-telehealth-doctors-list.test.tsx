import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AdminTelehealthDoctorsPage from "@/app/admin/telehealth/doctors/page";
import type { DoctorProfile, Page } from "@/lib/api/types";

/**
 * Görev tanımı madde 1/2/3 — admin doktor listesinde para birimi/süre/saat dilimi. `sonner`
 * (`toast`) DOM dışı bir portal render eder, burada assert EDİLMEZ; yalnızca listeleme akışı
 * mocklanır (silme akışı bu testin kapsamı DIŞINDA).
 */
vi.mock("@/lib/api/telehealth", () => ({
  listAdminDoctors: vi.fn(),
  deleteDoctor: vi.fn(),
}));

const telehealthApi = await import("@/lib/api/telehealth");

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
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
    fullName: "James Whitfield",
    slug: "dr-james-whitfield",
    bio: "Örnek biyografi.",
    languages: ["en"],
    timeZone: "Europe/London",
    sessionDurationMin: 45,
    sessionPriceCents: 500000,
    currency: "GBP",
    avatarMediaId: null,
    avatarMedia: null,
    isVerified: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    isActive: true,
    order: 0,
    availability: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AdminTelehealthDoctorsPage — Ücret/Süre/Saat Dilimi (görev tanımı madde 1/2/3)", () => {
  it("doktorun GERÇEK para birimiyle (GBP, sabit ₺ DEĞİL) ücreti, gerçek süresini ve saat dilimi rozetini gösterir", async () => {
    const page: Page<DoctorProfile> = { items: [makeDoctor()], meta: { nextCursor: null } };
    vi.mocked(telehealthApi.listAdminDoctors).mockResolvedValue(page);

    render(<AdminTelehealthDoctorsPage />);

    await waitFor(() => expect(screen.getByText(/James Whitfield/)).toBeInTheDocument());

    expect(screen.getByText(/45 dk/)).toBeInTheDocument();
    expect(screen.getByText(/£5.000,00|£5,000.00/)).toBeInTheDocument();
    expect(screen.getByText("Europe/London")).toBeInTheDocument();
  });
});
