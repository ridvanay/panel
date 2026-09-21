import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DoctorQuickBookingCard } from "@/components/site/telehealth/doctor-quick-booking-card";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";
import { telehealthStrings } from "@/lib/i18n/site-dictionaries/tr/telehealth";
import type { DoctorProfile } from "@/lib/api/types";

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — sağdaki "Book Appointment"/"Randevu Oluştur"
 * CTA'sı, sihirbaz ZATEN tamamlanmış bir rezervasyon gösteriyorken (`hasCompletedBooking`) salt
 * `#randevu`'ya kaydırmak YERİNE `requestBookingReset()`i TETİKLEMELİDİR — aksi halde kullanıcı
 * eski "randevunuz tamamlandı" ekranına kaydırılır. Devam eden (henüz TAMAMLANMAMIŞ) bir seçimi
 * YANLIŞLIKLA silmemesi için bu davranış YALNIZCA `hasCompletedBooking` iken TETİKLENMELİDİR.
 */

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

/** Testten `setHasCompletedBooking`i çağırıp `BookingWizard`'ın "tamamlandı" bildirimini simüle eder. */
function CompletionMarker({ completed }: { completed: boolean }) {
  const { setHasCompletedBooking } = useBookingSelection();
  useEffect(() => {
    setHasCompletedBooking(completed);
  }, [completed, setHasCompletedBooking]);
  return null;
}

function ResetSignalProbe() {
  const { resetSignal } = useBookingSelection();
  return <span data-testid="reset-signal">{resetSignal}</span>;
}

describe("DoctorQuickBookingCard — tamamlanmış rezervasyon sonrası CTA sıfırlaması", () => {
  it("hasCompletedBooking=false iken tıklama SADECE kaydırır — requestBookingReset TETİKLENMEZ", () => {
    render(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <CompletionMarker completed={false} />
        <ResetSignalProbe />
        <DoctorQuickBookingCard doctor={makeDoctor()} earliestAvailableIso={null} dict={telehealthStrings} />
      </BookingSelectionProvider>
    );

    fireEvent.click(screen.getByRole("link", { name: telehealthStrings.createAppointmentCta }));
    expect(screen.getByTestId("reset-signal").textContent).toBe("0");
  });

  it("hasCompletedBooking=true iken tıklama requestBookingReset'i TETİKLER (resetSignal artar)", () => {
    render(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <CompletionMarker completed={true} />
        <ResetSignalProbe />
        <DoctorQuickBookingCard doctor={makeDoctor()} earliestAvailableIso={null} dict={telehealthStrings} />
      </BookingSelectionProvider>
    );

    fireEvent.click(screen.getByRole("link", { name: telehealthStrings.createAppointmentCta }));
    expect(screen.getByTestId("reset-signal").textContent).toBe("1");
  });

  it("CTA hâlâ `#randevu`'ya işaret eder (sıfırlama, kaydırmanın YERİNE değil, YANINA eklenir)", () => {
    render(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <DoctorQuickBookingCard doctor={makeDoctor()} earliestAvailableIso={null} dict={telehealthStrings} />
      </BookingSelectionProvider>
    );
    expect(screen.getByRole("link", { name: telehealthStrings.createAppointmentCta })).toHaveAttribute("href", "#randevu");
  });
});
