import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";
import type { Appointment, AppointmentBooking, DoctorSummary } from "@/lib/api/types";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §1 — Erken Katılım Onay Modalı.
 * `join-meeting-button.tsx` projedeki TEK katılım girişi olduğu için bu davranış BURADA test
 * edilir; e2e karşılığı `qa-agent`ın Talep 1 senaryolarıdır (bkz. görev raporu).
 */

const DOCTOR: DoctorSummary = { id: "doc-1", title: "Dr.", fullName: "Ayşe Yılmaz", slug: "ayse-yilmaz" };

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt-1",
    doctorId: DOCTOR.id,
    doctor: DOCTOR,
    patientUserId: null,
    patientName: "Test Hasta",
    patientEmail: "hasta@example.com",
    startsAt: new Date().toISOString(),
    endsAt: new Date().toISOString(),
    status: "SCHEDULED",
    priceCents: 10000,
    currency: "TRY",
    startedAt: null,
    endedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildBooking(startsAt: string): Pick<AppointmentBooking, "paymentStatus" | "joinableFrom" | "joinableUntil" | "appointments"> {
  return {
    paymentStatus: "PAID",
    joinableFrom: null,
    joinableUntil: null,
    appointments: [buildAppointment({ startsAt })],
  };
}

const NOW = new Date("2026-09-16T10:00:00.000Z").getTime();
const locationAssignMock = vi.fn();

beforeEach(() => {
  window.sessionStorage.clear();
  locationAssignMock.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: locationAssignMock },
  });
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("JoinMeetingButton — erken katılım onay modalı", () => {
  it("randevuya 5dk kalmışsa (10dk EŞİĞİ ALTI) modal AÇILMAZ, doğrudan navigasyon yapılır (regresyon koruması)", async () => {
    const user = userEvent.setup();
    const startsAt = new Date(NOW + 5 * 60_000).toISOString();
    render(<JoinMeetingButton booking={buildBooking(startsAt)} nowMs={NOW} />);

    await user.click(screen.getByRole("link", { name: "Toplantıya Katıl" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("randevuya 2 saat kalmışsa (10dk EŞİĞİ ÜSTÜ) tıklama navigasyonu durdurup modalı BİREBİR metinle açar", async () => {
    const user = userEvent.setup();
    const startsAt = new Date(NOW + 2 * 60 * 60_000).toISOString();
    render(<JoinMeetingButton booking={buildBooking(startsAt)} nowMs={NOW} />);

    await user.click(screen.getByRole("link", { name: "Toplantıya Katıl" }));

    expect(await screen.findByText("Erken Katılım")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dikkat: Randevu saatinizden erken katılıyorsunuz. Görüşmeyi erken başlatıp sonlandırmanız durumunda, asıl randevu saatinizde odaya yeniden giriş yapılamayabilir. Devam etmek istiyor musunuz?"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vazgeç" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anladım, Odaya Katıl" })).toBeInTheDocument();
    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it("[Vazgeç] modalı kapatır, navigasyon YAPILMAZ", async () => {
    const user = userEvent.setup();
    const startsAt = new Date(NOW + 2 * 60 * 60_000).toISOString();
    render(<JoinMeetingButton booking={buildBooking(startsAt)} nowMs={NOW} />);

    await user.click(screen.getByRole("link", { name: "Toplantıya Katıl" }));
    await screen.findByText("Erken Katılım");
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));

    expect(locationAssignMock).not.toHaveBeenCalled();
  });

  it("[Anladım, Odaya Katıl] navigasyonu tetikler ve AYNI oturumda ikinci tıklamada modal BİR DAHA açılmaz", async () => {
    const user = userEvent.setup();
    const startsAt = new Date(NOW + 2 * 60 * 60_000).toISOString();
    const { rerender } = render(<JoinMeetingButton booking={buildBooking(startsAt)} nowMs={NOW} />);

    await user.click(screen.getByRole("link", { name: "Toplantıya Katıl" }));
    await screen.findByText("Erken Katılım");
    await user.click(screen.getByRole("button", { name: "Anladım, Odaya Katıl" }));

    expect(locationAssignMock).toHaveBeenCalledTimes(1);

    // Aynı randevu için `sessionStorage` onayı hatırlar — bileşen yeniden mount edilse bile
    // (ör. liste yeniden render edilse) modal bir daha sorulmaz. İkinci tıklama `preventDefault`
    // ÇAĞRILMADAN varsayılan `<a href>` navigasyonuna düşer (§1.3 "BUGÜNKÜYLE BİREBİR AYNI" kuralı
    // — programatik `location.assign` yalnızca modal onayında kullanılır), bu yüzden mock'un
    // çağrı sayısı ARTMAZ; test yalnızca modalın bir daha AÇILMADIĞINI doğrular.
    rerender(<JoinMeetingButton booking={buildBooking(startsAt)} nowMs={NOW} />);
    await user.click(screen.getByRole("link", { name: "Toplantıya Katıl" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(locationAssignMock).toHaveBeenCalledTimes(1);
  });

  it("doktor konsolu modunda (`mergeRemainingTime`) da AYNI modal davranışı uygulanır (tek bileşen, iki portal)", async () => {
    const user = userEvent.setup();
    const startsAt = new Date(NOW + 2 * 60 * 60_000).toISOString();
    const booking: Pick<AppointmentBooking, "paymentStatus" | "joinableFrom" | "joinableUntil" | "appointments"> = {
      paymentStatus: "PAID",
      joinableFrom: new Date(NOW + 2 * 60 * 60_000 - 10 * 60_000).toISOString(),
      joinableUntil: new Date(NOW + 2 * 60 * 60_000 + 15 * 60_000).toISOString(),
      appointments: [buildAppointment({ startsAt })],
    };
    render(<JoinMeetingButton booking={booking} mergeRemainingTime nowMs={NOW} activeLabel="Odaya Katıl" />);

    await user.click(screen.getByRole("link", { name: "Odaya Katıl" }));

    expect(await screen.findByText("Erken Katılım")).toBeInTheDocument();
  });
});
