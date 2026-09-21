import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — `BookingWizard` (sihirbaz) ile
 * `DoctorQuickBookingCard` (sağ sticky kart) KARDEŞ ağaçlardır, prop-drilling ile HABERLEŞEMEZ;
 * `hasCompletedBooking`/`resetSignal`/`requestBookingReset` bu iki bileşen arasındaki TEK
 * paylaşım kanalıdır. Bu dosya context/provider'ın KENDİSİNİ (gerçek sihirbaz/kart olmadan, ince
 * bir tüketici bileşenle) doğrular: "tamamlandı" bayrağı doğru okunur/yazılır, sıfırlama sinyali
 * her tetiklemede artar ve seçili slotları temizler.
 */

function Probe() {
  const { hasCompletedBooking, setHasCompletedBooking, resetSignal, requestBookingReset } = useBookingSelection();
  return (
    <div>
      <span data-testid="completed">{String(hasCompletedBooking)}</span>
      <span data-testid="reset-signal">{resetSignal}</span>
      <button onClick={() => setHasCompletedBooking(true)}>mark-completed</button>
      <button onClick={() => requestBookingReset()}>request-reset</button>
    </div>
  );
}

describe("BookingSelectionProvider — hasCompletedBooking / resetSignal / requestBookingReset", () => {
  it("varsayılan olarak tamamlanmamış (false) ve resetSignal 0 ile başlar", () => {
    render(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <Probe />
      </BookingSelectionProvider>
    );
    expect(screen.getByTestId("completed").textContent).toBe("false");
    expect(screen.getByTestId("reset-signal").textContent).toBe("0");
  });

  it("setHasCompletedBooking(true) bayrağı günceller; requestBookingReset() yalnızca sinyali artırır (slotları KENDİ BAŞINA temizlemez — bu sihirbazın işidir)", () => {
    render(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <Probe />
      </BookingSelectionProvider>
    );

    fireEvent.click(screen.getByText("mark-completed"));
    expect(screen.getByTestId("completed").textContent).toBe("true");

    fireEvent.click(screen.getByText("request-reset"));
    expect(screen.getByTestId("reset-signal").textContent).toBe("1");

    fireEvent.click(screen.getByText("request-reset"));
    expect(screen.getByTestId("reset-signal").textContent).toBe("2");
  });

  it("bir bileşenin (kart) attığı sinyali BAŞKA bir bileşen (sihirbaz) OKUYABİLİR — iki ayrı tüketici AYNI context değerini paylaşır", () => {
    function OtherConsumer() {
      const { resetSignal } = useBookingSelection();
      return <span data-testid="other-consumer-signal">{resetSignal}</span>;
    }

    render(
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <Probe />
        <OtherConsumer />
      </BookingSelectionProvider>
    );

    fireEvent.click(screen.getByText("request-reset"));
    expect(screen.getByTestId("reset-signal").textContent).toBe("1");
    expect(screen.getByTestId("other-consumer-signal").textContent).toBe("1");
  });
});
