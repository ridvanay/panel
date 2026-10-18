import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppointmentStatusBadge, resolveDisplayedAppointmentStatus } from "@/components/site/telehealth/appointment-status-badge";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";

/**
 * Paket A2 (2026-10-18) — rozet güvenlik ağı: otomatik kapatma görevi henüz çalışmamışken DB'de
 * `IN_PROGRESS` kalan ama katılım penceresi kapanmış görüşme "Devam Ediyor" DEĞİL "Sona erdi"
 * gösterir. Hasta paneli, doktor konsolu ve admin listesi aynı `resolveDisplayedAppointmentStatus`
 * kuralını kullanır. Provider yoksa (admin) TR, provider varsa aktif dil.
 */
describe("AppointmentStatusBadge — sona eren görüşme güvenlik ağı", () => {
  it("IN_PROGRESS + ended → ENDED; diğer durumlar değişmez", () => {
    expect(resolveDisplayedAppointmentStatus("IN_PROGRESS", true)).toBe("ENDED");
    expect(resolveDisplayedAppointmentStatus("IN_PROGRESS", false)).toBe("IN_PROGRESS");
    expect(resolveDisplayedAppointmentStatus("COMPLETED", true)).toBe("COMPLETED");
    expect(resolveDisplayedAppointmentStatus("SCHEDULED", true)).toBe("SCHEDULED");
  });

  it("provider yokken (admin) Türkçe: 'Sona erdi' / 'Devam Ediyor'", () => {
    const { rerender } = render(<AppointmentStatusBadge status="IN_PROGRESS" ended />);
    expect(screen.getByText("Sona erdi")).toBeInTheDocument();
    expect(screen.queryByText("Devam Ediyor")).not.toBeInTheDocument();
    rerender(<AppointmentStatusBadge status="IN_PROGRESS" />);
    expect(screen.getByText("Devam Ediyor")).toBeInTheDocument();
  });

  it("EN sitede İngilizce: 'Ended'", () => {
    render(
      <LocaleAlternatesProvider activeLocaleCode="en" defaultLocaleCode="en">
        <AppointmentStatusBadge status="IN_PROGRESS" ended />
      </LocaleAlternatesProvider>
    );
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });
});
