import { generateAvailableSlots, parseIsoCalendarDate, type DoctorAvailabilityRule } from "../telehealth/lib/availability";
import { addCalendarDays, formatCalendarDateKey, getWallClockParts, type CalendarDate } from "../telehealth/lib/timezone";

/**
 * Paket AI (İş 3) — hizmet masası slot hesabı (SAF: DB/IO yok). Mevcut `generateAvailableSlots` (haftalık kurallar,
 * DST, ISO gün) masanın saatleri ve dilimiyle çalıştırılır; ardından en erken/ufuk/tatil/koordinatör meşguliyeti
 * süzgeçleri uygulanır. Yanıta koordinatör kimliği ya da sayısı SIZMAZ (çağıran yalnızca startsAt/endsAt döner).
 */
export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface DeskSlotInput {
  timeZone: string;
  durationMin: number;
  minNoticeMin: number;
  horizonDays: number;
  hours: ReadonlyArray<Pick<DoctorAvailabilityRule, "dayOfWeek" | "startMinute" | "endMinute">>;
  /** Masa diliminde kapalı günler (`YYYY-MM-DD`). */
  closureDates: ReadonlySet<string>;
  /** Etkin koordinatör kimlikleri. */
  coordinatorIds: readonly string[];
  /** Koordinatör başına meşgul aralıklar (kendi SCHEDULED görüşmeleri + ev sahibi olduğu SCHEDULED toplantılar). */
  busy: ReadonlyMap<string, readonly BusyInterval[]>;
  /** DAHİL, masa diliminin takvim günleri (`YYYY-MM-DD`). */
  from: string;
  to: string;
  now: Date;
}

export interface DeskSlot {
  startsAt: Date;
  endsAt: Date;
  /** Bu slotta boş koordinatörler (YALNIZCA sunucu içi; API yanıtına konmaz). */
  freeCoordinatorIds: string[];
}

export type DayStatus = "available" | "full" | "closed";

export interface DeskSlotResult {
  slots: DeskSlot[];
  days: Array<{ date: string; status: DayStatus }>;
}

function overlaps(a: BusyInterval, startsAt: Date, endsAt: Date): boolean {
  return a.start.getTime() < endsAt.getTime() && startsAt.getTime() < a.end.getTime();
}

/** Bir slotta boş koordinatörler. */
export function freeCoordinatorsFor(
  startsAt: Date,
  endsAt: Date,
  coordinatorIds: readonly string[],
  busy: ReadonlyMap<string, readonly BusyInterval[]>
): string[] {
  return coordinatorIds.filter((id) => !(busy.get(id) ?? []).some((b) => overlaps(b, startsAt, endsAt)));
}

export function dateKeyInZone(instant: Date, timeZone: string): string {
  const p = getWallClockParts(instant, timeZone);
  return formatCalendarDateKey({ year: p.year, month: p.month, day: p.day });
}

/** Slot için en erken / en geç sınır (yarı açık değil: en erken DAHİL, ufuk DAHİL). */
export function bookingWindow(now: Date, minNoticeMin: number, horizonDays: number): { earliest: Date; latest: Date } {
  return { earliest: new Date(now.getTime() + minNoticeMin * 60_000), latest: new Date(now.getTime() + horizonDays * 86_400_000) };
}

export function computeDeskSlots(input: DeskSlotInput): DeskSlotResult {
  const { earliest, latest } = bookingWindow(input.now, input.minNoticeMin, input.horizonDays);
  const rules: DoctorAvailabilityRule[] = input.hours.map((h) => ({ ...h, isActive: true }));
  const generated = generateAvailableSlots({
    timeZone: input.timeZone,
    sessionDurationMin: input.durationMin,
    rules,
    fromDate: parseIsoCalendarDate(input.from),
    toDate: parseIsoCalendarDate(input.to),
    now: input.now,
    bookedStartTimesMs: new Set(),
  });

  const slots: DeskSlot[] = [];
  const candidatesPerDay = new Map<string, number>();
  const availablePerDay = new Map<string, number>();
  for (const g of generated) {
    const key = dateKeyInZone(g.startsAt, input.timeZone);
    if (input.closureDates.has(key)) continue;
    if (g.startsAt.getTime() < earliest.getTime() || g.startsAt.getTime() > latest.getTime()) continue;
    candidatesPerDay.set(key, (candidatesPerDay.get(key) ?? 0) + 1);
    const free = freeCoordinatorsFor(g.startsAt, g.endsAt, input.coordinatorIds, input.busy);
    if (free.length === 0) continue;
    availablePerDay.set(key, (availablePerDay.get(key) ?? 0) + 1);
    slots.push({ startsAt: g.startsAt, endsAt: g.endsAt, freeCoordinatorIds: free });
  }

  const days: DeskSlotResult["days"] = [];
  let cursor: CalendarDate = parseIsoCalendarDate(input.from);
  const last = parseIsoCalendarDate(input.to);
  const lastKey = formatCalendarDateKey(last);
  for (let guard = 0; guard < 400; guard++) {
    const key = formatCalendarDateKey(cursor);
    const candidates = candidatesPerDay.get(key) ?? 0;
    const available = availablePerDay.get(key) ?? 0;
    days.push({ date: key, status: available > 0 ? "available" : candidates > 0 ? "full" : "closed" });
    if (key === lastKey) break;
    cursor = addCalendarDays(cursor, 1);
  }
  return { slots, days };
}

/**
 * İstenen başlangıç gerçekten bu masanın bir slotu mu (yapısal + en erken + ufuk + tatil) ve kimler boş?
 * `null` = geçerli slot değil; boş dizi = slot var ama dolu.
 */
export function freeCoordinatorsForStart(input: Omit<DeskSlotInput, "from" | "to">, startsAt: Date): string[] | null {
  const key = dateKeyInZone(startsAt, input.timeZone);
  const result = computeDeskSlots({ ...input, from: key, to: key });
  const exact = result.slots.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (exact) return exact.freeCoordinatorIds;
  // Yapısal olarak geçerli ama dolu mu, yoksa hiç slot değil mi?
  const structural = computeDeskSlots({ ...input, coordinatorIds: ["__probe__"], busy: new Map(), from: key, to: key });
  return structural.slots.some((s) => s.startsAt.getTime() === startsAt.getTime()) ? [] : null;
}
