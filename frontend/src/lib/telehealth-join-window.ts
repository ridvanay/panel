import type { AppointmentStatus } from "@/lib/api/types";
import { EARLY_JOIN_WARNING_THRESHOLD_MINUTES } from "@/lib/telehealth-format";

/**
 * 2026-10-18 (Paket A2) — "Katıl" butonunun TEK karar kaynağı. Pencere backend'in
 * `modules/telehealth/lib/booking.ts::getBookingJoinWindow` kuralıyla birebir aynıdır:
 * `min(startsAt) - 10 dk` … `max(endsAt) + 15 dk`. Booking DTO'sundaki `joinableFrom`/
 * `joinableUntil` (sunucunun hesapladığı) varsa doğrudan o kullanılır; yalnızca yoksa (ör. ödeme
 * bekleyen booking'de `null`) aşağıdaki sabitlerle aynı hesap yapılır. Sabitlerin backend ile
 * aynı olduğu `tests/unit/telehealth-join-window.test.ts` içinde kaynak dosyadan okunarak doğrulanır.
 */
export const JOIN_WINDOW_BEFORE_START_MINUTES = EARLY_JOIN_WARNING_THRESHOLD_MINUTES;
export const JOIN_WINDOW_AFTER_END_MINUTES = 15;

export type JoinState = "upcoming" | "open" | "ended";

/** Bu durumlardaki randevuya bir daha katılınamaz. */
export const TERMINAL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ["COMPLETED", "CANCELLED", "NO_SHOW"];

export interface JoinWindowInput {
  appointments: readonly { startsAt: string; endsAt: string; status: AppointmentStatus }[];
  joinableFrom?: string | null;
  joinableUntil?: string | null;
}

export function getJoinState(input: JoinWindowInput, now: number | Date): JoinState {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const { appointments } = input;
  if (appointments.length === 0) return "ended";
  if (appointments.every((a) => TERMINAL_APPOINTMENT_STATUSES.includes(a.status))) return "ended";

  const fromMs = input.joinableFrom
    ? new Date(input.joinableFrom).getTime()
    : Math.min(...appointments.map((a) => new Date(a.startsAt).getTime())) - JOIN_WINDOW_BEFORE_START_MINUTES * 60_000;
  const untilMs = input.joinableUntil
    ? new Date(input.joinableUntil).getTime()
    : Math.max(...appointments.map((a) => new Date(a.endsAt).getTime())) + JOIN_WINDOW_AFTER_END_MINUTES * 60_000;

  if (nowMs < fromMs) return "upcoming";
  if (nowMs > untilMs) return "ended";
  return "open";
}
