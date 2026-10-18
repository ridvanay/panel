import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOIN_WINDOW_AFTER_END_MINUTES, JOIN_WINDOW_BEFORE_START_MINUTES, getJoinState } from "@/lib/telehealth-join-window";
import { EARLY_JOIN_WARNING_THRESHOLD_MINUTES } from "@/lib/telehealth-format";
import { JoinMeetingButton } from "@/components/site/telehealth/join-meeting-button";
import type { AppointmentBooking, AppointmentStatus } from "@/lib/api/types";

/**
 * Paket A2 (2026-10-18) — "Katıl" butonunun tek karar kaynağı. Pencere sabitleri backend'in
 * `lib/booking.ts` (LiveKit kırmızı çizgisi, salt-okunur) ve `lib/early-join.ts` dosyalarından
 * METİN olarak okunup karşılaştırılır — derleme bağımlılığı eklenmez.
 */
const repoRoot = resolve(__dirname, "../../..");
const bookingSource = readFileSync(resolve(repoRoot, "backend/src/modules/telehealth/lib/booking.ts"), "utf8");
const earlyJoinSource = readFileSync(resolve(repoRoot, "backend/src/modules/telehealth/lib/early-join.ts"), "utf8");

function backendMinutes(name: string): number {
  const match = bookingSource.match(new RegExp(`export const ${name} = (\\d+) \\* 60 \\* 1000;`));
  if (!match) throw new Error(`${name} backend booking.ts içinde bulunamadı`);
  return Number(match[1]);
}

const START = new Date("2026-10-18T10:00:00.000Z").getTime();
const END = START + 30 * 60_000;
const MIN = 60_000;

function booking(
  overrides: { status?: AppointmentStatus; joinableFrom?: string | null; joinableUntil?: string | null } = {}
): Pick<AppointmentBooking, "paymentStatus" | "joinableFrom" | "joinableUntil" | "appointments"> {
  return {
    paymentStatus: "PAID",
    joinableFrom: overrides.joinableFrom === undefined ? new Date(START - 10 * MIN).toISOString() : overrides.joinableFrom,
    joinableUntil: overrides.joinableUntil === undefined ? new Date(END + 15 * MIN).toISOString() : overrides.joinableUntil,
    appointments: [
      {
        id: "apt-1",
        doctorId: "doc-1",
        doctor: { id: "doc-1", title: "Dr.", fullName: "Ayşe Yılmaz", slug: "ayse-yilmaz" },
        patientUserId: null,
        patientName: "Test Hasta",
        patientEmail: "hasta@example.com",
        startsAt: new Date(START).toISOString(),
        endsAt: new Date(END).toISOString(),
        status: overrides.status ?? "SCHEDULED",
        priceCents: 10000,
        currency: "TRY",
        startedAt: null,
        endedAt: null,
        cancelledAt: null,
        cancelReason: null,
        createdAt: new Date(START).toISOString(),
        updatedAt: new Date(START).toISOString(),
      },
    ],
  };
}

describe("telehealth-join-window — backend kuralıyla parite", () => {
  it("pencere sabitleri backend `booking.ts` (10 dk önce / 15 dk sonra) ile aynıdır", () => {
    expect(JOIN_WINDOW_BEFORE_START_MINUTES).toBe(backendMinutes("JOIN_WINDOW_BEFORE_START_MS"));
    expect(JOIN_WINDOW_AFTER_END_MINUTES).toBe(backendMinutes("JOIN_WINDOW_AFTER_END_MS"));
  });

  it("erken katılım eşiği backend `early-join.ts` ile aynıdır", () => {
    const match = earlyJoinSource.match(/export const EARLY_JOIN_WARNING_THRESHOLD_MINUTES = (\d+);/);
    expect(Number(match?.[1])).toBe(EARLY_JOIN_WARNING_THRESHOLD_MINUTES);
  });
});

describe("getJoinState", () => {
  it.each([
    ["başlangıçtan 11 dk önce", START - 11 * MIN, "upcoming"],
    ["başlangıçtan tam 10 dk önce", START - 10 * MIN, "open"],
    ["seans sırasında", START + 5 * MIN, "open"],
    ["bitişten tam 15 dk sonra", END + 15 * MIN, "open"],
    ["bitişten 16 dk sonra", END + 16 * MIN, "ended"],
  ] as const)("%s → %s", (_label, now, expected) => {
    expect(getJoinState(booking(), now)).toBe(expected);
  });

  it.each(["COMPLETED", "CANCELLED", "NO_SHOW"] as const)("%s randevu pencere açık olsa da `ended` döner", (status) => {
    expect(getJoinState(booking({ status }), START)).toBe("ended");
  });

  it("sunucu penceresi yoksa (ödeme bekliyor) aynı kuralı randevu saatlerinden hesaplar", () => {
    const noWindow = booking({ joinableFrom: null, joinableUntil: null });
    expect(getJoinState(noWindow, START - 11 * MIN)).toBe("upcoming");
    expect(getJoinState(noWindow, START)).toBe("open");
    expect(getJoinState(noWindow, END + 16 * MIN)).toBe("ended");
  });

  it("Date nesnesi de kabul eder", () => {
    expect(getJoinState(booking(), new Date(END + 16 * MIN))).toBe("ended");
  });
});

describe("JoinMeetingButton — sona eren görüşme", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pencere kapandıysa buton yerine 'Görüşme sona erdi' etiketi gösterir", () => {
    render(<JoinMeetingButton booking={booking()} nowMs={END + 16 * MIN} />);
    expect(screen.queryByRole("link", { name: "Toplantıya Katıl" })).not.toBeInTheDocument();
    expect(screen.getByText("Görüşme sona erdi")).toBeInTheDocument();
  });

  it("tamamlanmış randevuda pencere içinde de buton gösterilmez", () => {
    render(<JoinMeetingButton booking={booking({ status: "COMPLETED" })} nowMs={START} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Görüşme sona erdi")).toBeInTheDocument();
  });

  it("doktor konsolu modunda da (`mergeRemainingTime`) pencere kapanınca buton kaybolur", () => {
    render(<JoinMeetingButton booking={booking()} mergeRemainingTime nowMs={END + 16 * MIN} activeLabel="Odaya Katıl" />);
    expect(screen.queryByRole("link", { name: "Odaya Katıl" })).not.toBeInTheDocument();
    expect(screen.getByText("Görüşme sona erdi")).toBeInTheDocument();
  });

  it("sayfa açıkken pencere kapanırsa dakikalık yeniden hesaplamayla buton kendiliğinden kaybolur", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(END + 14 * MIN);
    render(<JoinMeetingButton booking={booking()} />);
    expect(screen.getByRole("link", { name: "Toplantıya Katıl" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2 * MIN);
    });

    expect(screen.queryByRole("link", { name: "Toplantıya Katıl" })).not.toBeInTheDocument();
    expect(screen.getByText("Görüşme sona erdi")).toBeInTheDocument();
  });
});
