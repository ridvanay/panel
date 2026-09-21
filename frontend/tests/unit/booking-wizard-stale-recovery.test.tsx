import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BookingWizard } from "@/components/site/telehealth/booking-wizard";
import { BookingSelectionProvider } from "@/components/site/telehealth/booking-selection-context";
import type { AppointmentBooking, DoctorProfile } from "@/lib/api/types";

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — kök neden: sihirbaz, `?booking=&t=` (veya
 * `sessionStorage`) üzerinden ZATEN `PAID` (ücretsiz doktor DAHİL) bir booking'i bulduğunda Adım
 * 5'e (tamamlandı ekranı) KURTARIYORDU — kullanıcı sayfayı yenilediğinde veya AYNI doktordan
 * TEKRAR randevu almak için geri geldiğinde eski "randevunuz tamamlandı" ekranında ÇIKMAZ kalıyor,
 * yeni tarih/saat seçemiyordu. Bu dosya, mount-anı kurtarma effect'inin artık HER durumda (`PAID`
 * dahil) kalıcı kaydı temizleyip Adım 2'den (Tarih & Saat) TEMİZ başladığını doğrular — ağır
 * bağımlılıkları (`AvailabilityCalendar`/`BookingIdentityStep`/vb., LiveKit'siz ama yine de gerçek
 * SDK/network çağrıları İÇEREN alt adımlar) hafif stub'larla İZOLE eder.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const getBookingMock = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  getBooking: (...args: unknown[]) => getBookingMock(...args),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(async () => undefined),
}));

vi.mock("@/components/site/telehealth/availability-calendar", () => ({
  AvailabilityCalendar: () => <div data-testid="step-2-calendar">calendar stub</div>,
}));
vi.mock("@/components/site/telehealth/booking-identity-step", () => ({
  BookingIdentityStep: () => <div data-testid="step-3-identity">identity stub</div>,
}));
vi.mock("@/components/site/telehealth/booking-intake-step", () => ({
  BookingIntakeStep: () => <div data-testid="step-4-intake">intake stub</div>,
}));
vi.mock("@/components/site/telehealth/booking-payment-step", () => ({
  BookingPaymentStep: () => <div data-testid="step-5-payment">payment stub</div>,
}));
vi.mock("@/components/site/telehealth/doctor-service-summary", () => ({
  DoctorServiceSummaryPanel: () => <div data-testid="summary-panel">summary stub</div>,
}));

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Dr.",
    fullName: "Elif Aydemir",
    slug: "dr-elif-aydemir",
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

function makeBooking(overrides: Partial<AppointmentBooking> = {}): AppointmentBooking {
  return {
    id: "booking-1",
    bookingNumber: "BKG-STALE-0001",
    doctorId: "doctor-1",
    doctor: { id: "doctor-1", title: "Dr.", fullName: "Elif Aydemir", slug: "dr-elif-aydemir" },
    patientUserId: null,
    patientName: "Test Hasta",
    patientEmail: "hasta@example.com",
    identity: null,
    slotCount: 1,
    unitPriceCents: 0,
    subtotalCents: 0,
    totalCents: 0,
    currency: "TRY",
    paymentStatus: "PAID",
    paidAt: "2026-09-20T09:00:00.000Z",
    paidBy: "free",
    expiresAt: "2026-09-20T09:30:00.000Z",
    errorSummary: null,
    appointments: [],
    hasIntakeNote: false,
    hasConsultationNote: false,
    ...overrides,
  } as AppointmentBooking;
}

function renderWizard(doctor: DoctorProfile = makeDoctor()) {
  return render(
    <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
      <BookingWizard
        doctor={doctor}
        doctorSlug={doctor.slug}
        doctorTimeZone={doctor.timeZone}
        lang="tr"
        defaultLocaleCode="tr"
        initialSlots={[]}
        kvkkPage={null}
      />
    </BookingSelectionProvider>
  );
}

describe("BookingWizard — sayfa yenilenince/tekrar geldiğinde ESKİ tamamlanmış booking'i sıfırlar", () => {
  beforeEach(() => {
    getBookingMock.mockReset();
    window.history.replaceState(null, "", "/tr/doctors/dr-elif-aydemir");
    try {
      sessionStorage.clear();
    } catch {
      // jsdom'da genelde erişilebilir; erişilemezse test zaten anlamsız olur.
    }
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/tr/doctors/dr-elif-aydemir");
  });

  it("URL'de `?booking=&t=` ile ZATEN PAID (ücretsiz, totalCents=0) bir booking varsa — Adım 5/tamamlandı ekranı GÖSTERİLMEZ, Adım 2 (takvim) render edilir, kalıcı kayıt temizlenir", async () => {
    window.history.replaceState(null, "", "/tr/doctors/dr-elif-aydemir?booking=booking-1&t=stale-token-abc");
    getBookingMock.mockResolvedValue(makeBooking());

    renderWizard();

    await waitFor(() => expect(getBookingMock).toHaveBeenCalledWith("booking-1", "stale-token-abc"));
    await waitFor(() => expect(screen.getByTestId("step-2-calendar")).toBeInTheDocument());

    expect(screen.queryByText(/Ödeme adımı gerekmiyor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rezervasyonunuz oluşturuldu/)).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has("booking")).toBe(false);
    expect(new URLSearchParams(window.location.search).has("t")).toBe(false);
  });

  it("aynı senaryo gerçekten ÖDENMİŞ (ücretsiz DEĞİL) bir booking için de geçerlidir — regresyon (ücretli akış zaten hep sıfırlanıyordu)", async () => {
    window.history.replaceState(null, "", "/tr/doctors/dr-elif-aydemir?booking=booking-2&t=stale-token-paid");
    getBookingMock.mockResolvedValue(makeBooking({ id: "booking-2", totalCents: 75000, unitPriceCents: 75000, paidBy: "stripe" }));

    renderWizard(makeDoctor({ sessionPriceCents: 75000 }));

    await waitFor(() => expect(getBookingMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("step-2-calendar")).toBeInTheDocument());
    expect(screen.queryByTestId("step-5-payment")).not.toBeInTheDocument();
  });

  it("`PENDING` VE süresi dolmamış bir booking hâlâ Adım 4'e (kimlik/belge) kurtarılır — bu davranış DEĞİŞMEDİ", async () => {
    window.history.replaceState(null, "", "/tr/doctors/dr-elif-aydemir?booking=booking-3&t=pending-token");
    const future = new Date(Date.now() + 15 * 60_000).toISOString();
    getBookingMock.mockResolvedValue(makeBooking({ id: "booking-3", paymentStatus: "PENDING", totalCents: 75000, expiresAt: future }));

    renderWizard(makeDoctor({ sessionPriceCents: 75000 }));

    await waitFor(() => expect(getBookingMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("step-4-intake")).toBeInTheDocument());
  });
});
