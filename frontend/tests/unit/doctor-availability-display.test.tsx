import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AvailabilitySlot, DoctorTimeOff } from "@/lib/api/types";
import { computeDayStatuses, earliestAvailableSlot, wallTimeToUtcIso, weeklyHoursInTimeZone } from "@/lib/doctor-schedule";
import { TimeOffManager } from "@/components/telehealth/time-off-manager";
import { AvailabilityCalendar } from "@/components/site/telehealth/availability-calendar";
import { BookingSelectionProvider } from "@/components/site/telehealth/booking-selection-context";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { PATIENT_TIME_ZONE_STORAGE_KEY } from "@/lib/dual-time";

/**
 * Paket P (İş 2) — takvimde gün durumları (müsait/dolu/müsait değil), en erken randevu kısayolu,
 * haftalık saatlerin hastanın diliminde özeti, hiç slot yoksa talep yönlendirmesi; izin yönetimi
 * (çakışma uyarısı, iç not uyarısı) ve duvar saati → UTC dönüşümü.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/api/telehealth", () => ({ getDoctorSlots: vi.fn(async () => []) }));
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => null }));

const FIXED_NOW = new Date("2026-10-20T08:00:00.000Z").getTime();
const slot = (startsAt: string, available: boolean): AvailabilitySlot => ({
  startsAt,
  endsAt: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
  available,
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(PATIENT_TIME_ZONE_STORAGE_KEY, "Europe/Berlin");
});
afterEach(() => vi.restoreAllMocks());

describe("lib/doctor-schedule", () => {
  it("gün durumları: uygun saat sayısı, dolu gün, slotsuz gün (müsait değil)", () => {
    const map = computeDayStatuses(
      [slot("2026-10-28T13:00:00Z", true), slot("2026-10-28T13:30:00Z", true), slot("2026-10-29T13:00:00Z", false)],
      "Europe/Berlin",
      FIXED_NOW
    );
    expect(map.get("2026-10-28")).toEqual({ status: "available", availableCount: 2 });
    expect(map.get("2026-10-29")).toEqual({ status: "full" });
    expect(map.has("2026-10-30")).toBe(false);
    expect(earliestAvailableSlot([slot("2026-10-29T13:00:00Z", true), slot("2026-10-28T13:00:00Z", true)])!.startsAt).toBe("2026-10-28T13:00:00Z");
  });

  it("haftalık saatler hastanın diliminde: İstanbul Pzt–Cum 09–17 → Berlin (kış) 07–15; Sydney gece yarısını aşar", () => {
    const rules = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020, isActive: true }));
    expect(weeklyHoursInTimeZone(rules, "Europe/Istanbul", "Europe/Berlin", new Date("2026-11-02T12:00:00Z"))).toEqual([
      { days: [1, 2, 3, 4, 5], fromMinute: 420, toMinute: 900 },
    ]);
    // Sydney GMT+11 (yaz) — İstanbul'dan 8 saat ileride: 17:00–01:00 → gün içi parça + ertesi güne taşan parça birleşir.
    const sydney = weeklyHoursInTimeZone([{ dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true }], "Europe/Istanbul", "Australia/Sydney", new Date("2026-11-02T12:00:00Z"));
    expect(sydney).toEqual([
      { days: [1], fromMinute: 1020, toMinute: 1440 },
      { days: [2], fromMinute: 0, toMinute: 60 },
    ]);
  });

  it("duvar saati → UTC: yaz saati geçişini doğru hesaplar (Berlin 24 Ekim GMT+2, 26 Ekim GMT+1)", () => {
    expect(wallTimeToUtcIso("2026-10-24", "00:00", "Europe/Berlin")).toBe("2026-10-23T22:00:00.000Z");
    expect(wallTimeToUtcIso("2026-10-26", "00:00", "Europe/Berlin")).toBe("2026-10-25T23:00:00.000Z");
    expect(wallTimeToUtcIso("2026-11-05", "09:00", "Europe/Istanbul")).toBe("2026-11-05T06:00:00.000Z");
  });
});

function renderCalendar(slots: AvailabilitySlot[]) {
  return render(
    <LocaleAlternatesProvider activeLocaleCode="tr" defaultLocaleCode="tr">
      <BookingSelectionProvider doctorTimeZone="Europe/Istanbul">
        <AvailabilityCalendar
          doctorSlug="dr-x"
          doctorTimeZone="Europe/Istanbul"
          initialSlots={slots}
          weeklyRules={[1, 2, 3].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020, isActive: true }))}
          requestHref="/contact?doctor=dr-x"
        />
      </BookingSelectionProvider>
    </LocaleAlternatesProvider>
  );
}

describe("hasta takvimi", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
  });

  it("müsait gün rozetli, dolu gün 'Dolu', slotsuz gün soluk ve 'Doktor bu gün hizmet vermiyor'; en erken kısayolu ve haftalık özet", async () => {
    const user = userEvent.setup();
    renderCalendar([slot("2026-10-28T13:00:00Z", true), slot("2026-10-28T13:30:00Z", true), slot("2026-10-29T13:00:00Z", false), slot("2026-10-31T13:00:00Z", true)]);
    const full = await screen.findByLabelText(/29 Ekim.* — Dolu/);
    expect(full).toHaveAttribute("data-day-status", "full");
    const off = screen.getByLabelText(/30 Ekim.* — Doktor bu gün hizmet vermiyor/);
    expect(off).toHaveAttribute("data-day-status", "unavailable");
    expect(off.tagName).toBe("SPAN"); // tıklanamaz
    expect(screen.getByLabelText(/31 Ekim.*1 uygun saat/)).toBeInTheDocument();

    const shortcut = screen.getByTestId("earliest-shortcut");
    expect(shortcut).toHaveTextContent("En erken uygun randevu:");
    expect(shortcut).toHaveTextContent("28 Ekim Çarşamba, 14:00 (Türkiye 16:00)");
    expect(screen.getByTestId("weekly-hours")).toHaveTextContent("Pzt–Çar 08:00–16:00 (sizin saatinizle)");

    await user.click(screen.getByLabelText(/31 Ekim.*uygun saat/));
    await user.click(shortcut.querySelector("button")!);
    expect(screen.getByLabelText(/28 Ekim.* — seçili/)).toBeInTheDocument();
  });

  it("önümüzdeki 30 günde hiç uygun saat yoksa boş takvim yerine talep yönlendirmesi", () => {
    renderCalendar([slot("2026-10-29T13:00:00Z", false)]);
    const box = screen.getByTestId("no-slots-request");
    expect(box).toHaveTextContent("Bu doktor için yakın tarihte uygun saat yok — talep bırakın, sizi arayalım");
    expect(screen.getByRole("link", { name: "Talep bırakın" })).toHaveAttribute("href", "/contact?doctor=dr-x");
    expect(screen.queryByTestId("earliest-shortcut")).not.toBeInTheDocument();
  });
});

describe("izin yönetimi", () => {
  it("iç not uyarısı görünür; çakışan onaylı randevular kayıttan sonra listelenir (kayıt engellenmez)", async () => {
    const user = userEvent.setup();
    const created: DoctorTimeOff = {
      id: "t1",
      doctorId: "d1",
      startsAt: "2026-11-02T21:00:00.000Z",
      endsAt: "2026-11-03T21:00:00.000Z",
      kind: "CONGRESS",
      allDay: true,
      note: null,
      createdAt: "2026-10-20T08:00:00.000Z",
      conflicts: [{ appointmentId: "a1", startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T07:30:00.000Z", patientName: "Ayşe Hasta", bookingNumber: "BKG-1" }],
    };
    const list = vi.fn(async () => [] as DoctorTimeOff[]);
    const create = vi.fn(async () => created);
    render(<TimeOffManager doctorTimeZone="Europe/Istanbul" list={list} create={create} remove={vi.fn()} errorMessage={() => "hata"} />);
    expect(screen.getByText(/hasta veya sağlık bilgisi yazmayın/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Tür"), "CONGRESS");
    await user.clear(screen.getByLabelText("Başlangıç tarihi"));
    await user.type(screen.getByLabelText("Başlangıç tarihi"), "2026-11-03");
    await user.clear(screen.getByLabelText("Bitiş tarihi"));
    await user.type(screen.getByLabelText("Bitiş tarihi"), "2026-11-03");
    await user.click(screen.getByRole("button", { name: "İzin ekle" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    // Tam gün: İstanbul gün başı → ertesi gün başı (UTC).
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "CONGRESS", allDay: true, startsAt: "2026-11-02T21:00:00.000Z", endsAt: "2026-11-03T21:00:00.000Z" }));
    const alert = await screen.findByTestId("time-off-conflicts");
    expect(alert).toHaveTextContent("1 onaylı randevu var");
    expect(alert).toHaveTextContent("Ayşe Hasta (BKG-1)");
  });
});
