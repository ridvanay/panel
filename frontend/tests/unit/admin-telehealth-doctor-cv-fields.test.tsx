import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoctorProfile } from "@/lib/api/types";

/**
 * Paket A4 (2026-10-18) — admin doktor formlarında doktorun "Profilim" formundaki CV alanları
 * (alt branş, mesleğe başlama yılı, hakkında, özgeçmiş, yayınlar, diller) ortak bileşenden gelir.
 */
const createDoctor = vi.fn();
const updateDoctor = vi.fn();
const getAdminDoctor = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: vi.fn(async () => []),
  createDoctor: (...args: unknown[]) => createDoctor(...args),
  updateDoctor: (...args: unknown[]) => updateDoctor(...args),
  getAdminDoctor: (...args: unknown[]) => getAdminDoctor(...args),
  getDoctorAvailability: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Tiptap jsdom'da gereksiz — `doctor-profile-panel.test.tsx` ile aynı dar stub; içeriği düz textarea.
vi.mock("@/components/site/telehealth/doctor-about-editor", () => ({
  DoctorAboutEditor: ({ content, onChange }: { content: string; onChange: (html: string) => void }) => (
    <textarea aria-label="Hakkında editörü" value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import NewDoctorPage from "@/app/admin/telehealth/doctors/new/page";
import EditDoctorPage from "@/app/admin/telehealth/doctors/[doctorId]/page";
import { toDoctorCvPayload } from "@/components/site/telehealth/doctor-cv-fields";

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Dr.",
    fullName: "Ayşe Yılmaz",
    slug: "ayse-yilmaz",
    subSpecialty: "Girişimsel Kardiyoloji",
    bio: "Kısa özet.",
    aboutHtml: "<p>Uzun biyografi</p>",
    practiceStartYear: 2005,
    experienceYears: 21,
    cvEntries: [{ kind: "EDUCATION", title: "Tıp Fakültesi", organization: "İÜ", location: null, startYear: 1998, endYear: 2004, description: null }],
    publications: [],
    socialLinks: [],
    languages: ["tr", "en"],
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
  } as DoctorProfile;
}

beforeEach(() => {
  createDoctor.mockReset();
  updateDoctor.mockReset();
  getAdminDoctor.mockReset();
});

describe("toDoctorCvPayload", () => {
  it("boş metinleri null'a, yılı sayıya çevirir", () => {
    expect(toDoctorCvPayload({ subSpecialty: "  ", practiceStartYear: "", aboutHtml: " ", cvEntries: [], publications: [] })).toEqual({
      subSpecialty: null,
      practiceStartYear: null,
      aboutHtml: null,
      cvEntries: [],
      publications: [],
    });
    expect(toDoctorCvPayload({ subSpecialty: " Kardiyoloji ", practiceStartYear: "2010", aboutHtml: "<p>x</p>", cvEntries: [], publications: [] })).toMatchObject({
      subSpecialty: "Kardiyoloji",
      practiceStartYear: 2010,
      aboutHtml: "<p>x</p>",
    });
  });
});

describe("Admin yeni doktor formu — CV alanları", () => {
  it("alt branş, mesleğe başlama yılı, hakkında ve diller oluşturma isteğine eklenir", async () => {
    const user = userEvent.setup();
    createDoctor.mockResolvedValue(makeDoctor());
    render(<NewDoctorPage />);

    await user.type(screen.getByLabelText(/Ad soyad/), "Ayşe Yılmaz");
    await user.type(screen.getByLabelText(/Biyografi/), "Kısa özet.");
    await user.type(screen.getByLabelText(/Alt Branş/), "Girişimsel Kardiyoloji");
    await user.type(screen.getByLabelText(/Mesleğe Başlama Yılı/), "2005");
    await user.type(screen.getByLabelText("Hakkında editörü"), "<p>Uzun</p>");
    await user.click(screen.getByLabelText("EN"));
    expect(screen.getByRole("button", { name: /Özgeçmiş Öğesi Ekle/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yayın Ekle/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Oluştur ve müsaitliği ayarla/ }));

    await waitFor(() => expect(createDoctor).toHaveBeenCalledTimes(1));
    expect(createDoctor.mock.calls[0]![0]).toMatchObject({
      subSpecialty: "Girişimsel Kardiyoloji",
      practiceStartYear: 2005,
      aboutHtml: "<p>Uzun</p>",
      languages: ["tr", "en"],
      cvEntries: [],
      publications: [],
    });
  });
});

describe("Admin doktor düzenleme formu — CV alanları", () => {
  it("mevcut CV alanlarını yükler ve güncelleme isteğinde geri gönderir", async () => {
    const user = userEvent.setup();
    const doc = makeDoctor();
    getAdminDoctor.mockResolvedValue(doc);
    updateDoctor.mockResolvedValue(doc);
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <EditDoctorPage params={Promise.resolve({ doctorId: doc.id })} />
        </Suspense>
      );
    });

    expect(await screen.findByDisplayValue("Girişimsel Kardiyoloji")).toBeInTheDocument();
    expect(screen.getByLabelText(/Mesleğe Başlama Yılı/)).toHaveValue(2005);
    expect(screen.getByDisplayValue("Tıp Fakültesi")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Alt Branş/));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(updateDoctor).toHaveBeenCalledTimes(1));
    expect(updateDoctor.mock.calls[0]![1]).toMatchObject({
      subSpecialty: null,
      practiceStartYear: 2005,
      aboutHtml: "<p>Uzun biyografi</p>",
      cvEntries: doc.cvEntries,
      publications: [],
    });
  });
});
