/**
 * Paket P (İş 2) — hasta takviminde doktor müsaitliğinin net gösterimi (saf yardımcılar):
 *  - gün durumları: müsait (uygun slot sayısıyla) / dolu / müsait değil (hiç slot yok — neden gösterilmez)
 *  - en erken uygun randevu
 *  - haftalık çalışma saatlerinin HASTANIN diliminde özeti ("Pzt–Cum 11:00–17:00")
 * Yeni paket YOK; ofsetler `Intl` ile, referans andaki gerçek değerle (yaz saati dahil) hesaplanır.
 */
import type { AvailabilitySlot } from "./api/types";
import { formatDayKey } from "./telehealth-format";
import { offsetMinutes } from "./dual-time";

export type DayStatus = { status: "available"; availableCount: number } | { status: "full" };

/** Slotu olan günlerin durumu; haritada OLMAYAN gün = "müsait değil" (doktor hizmet vermiyor / izinli). */
export function computeDayStatuses(slots: readonly AvailabilitySlot[], timeZone: string, nowMs: number): Map<string, DayStatus> {
  const counts = new Map<string, { available: number; future: number }>();
  for (const slot of slots) {
    const key = formatDayKey(slot.startsAt, timeZone);
    const entry = counts.get(key) ?? { available: 0, future: 0 };
    if (slot.available) entry.available++;
    if (new Date(slot.startsAt).getTime() >= nowMs) entry.future++;
    counts.set(key, entry);
  }
  const result = new Map<string, DayStatus>();
  for (const [key, { available, future }] of counts) {
    if (available > 0) result.set(key, { status: "available", availableCount: available });
    // Geçmişte kalmış saatler "dolu" sayılmaz — yalnızca gelecekteki saatleri alınmış gün dolu.
    else if (future > 0) result.set(key, { status: "full" });
  }
  return result;
}

export function earliestAvailableSlot(slots: readonly AvailabilitySlot[]): AvailabilitySlot | null {
  let best: AvailabilitySlot | null = null;
  for (const slot of slots) if (slot.available && (!best || slot.startsAt < best.startsAt)) best = slot;
  return best;
}

export interface WeeklyRule {
  dayOfWeek: number; // ISO 1=Pzt … 7=Paz, doktorun diliminde
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

export interface WeeklyHoursGroup {
  /** ISO gün numaraları (hastanın diliminde), ardışık. */
  days: number[];
  fromMinute: number;
  toMinute: number;
}

const DAY_MINUTES = 24 * 60;

/**
 * Doktorun haftalık kurallarını hastanın dilimine kaydırır (referans andaki ofset farkıyla) ve aynı
 * saat aralığına sahip ARDIŞIK günleri birleştirir. Gece yarısını aşan aralıklar bölünür.
 */
export function weeklyHoursInTimeZone(rules: readonly WeeklyRule[], doctorTimeZone: string, patientTimeZone: string, at: Date = new Date()): WeeklyHoursGroup[] {
  const shift = offsetMinutes(at, patientTimeZone) - offsetMinutes(at, doctorTimeZone);
  const pieces: { day: number; from: number; to: number }[] = [];
  for (const rule of rules) {
    if (!rule.isActive || rule.endMinute <= rule.startMinute) continue;
    const start = (rule.dayOfWeek - 1) * DAY_MINUTES + rule.startMinute + shift;
    const end = (rule.dayOfWeek - 1) * DAY_MINUTES + rule.endMinute + shift;
    // Hafta sınırını sarmala (0..7 gün) ve gün sınırlarında böl.
    let cursor = start;
    while (cursor < end) {
      const dayIndex = Math.floor(cursor / DAY_MINUTES);
      const dayEnd = (dayIndex + 1) * DAY_MINUTES;
      const pieceEnd = Math.min(end, dayEnd);
      const day = (((dayIndex % 7) + 7) % 7) + 1;
      pieces.push({ day, from: cursor - dayIndex * DAY_MINUTES, to: pieceEnd - dayIndex * DAY_MINUTES });
      cursor = pieceEnd;
    }
  }
  // Aynı güne düşen parçaları birleştir (en erken başlangıç–en geç bitiş).
  const byDay = new Map<number, { from: number; to: number }>();
  for (const p of pieces) {
    const existing = byDay.get(p.day);
    byDay.set(p.day, existing ? { from: Math.min(existing.from, p.from), to: Math.max(existing.to, p.to) } : { from: p.from, to: p.to });
  }
  const groups: WeeklyHoursGroup[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const range = byDay.get(day)!;
    const last = groups[groups.length - 1];
    if (last && last.days[last.days.length - 1] === day - 1 && last.fromMinute === range.from && last.toMinute === range.to) last.days.push(day);
    else groups.push({ days: [day], fromMinute: range.from, toMinute: range.to });
  }
  return groups;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export function formatMinuteOfDay(minute: number): string {
  const m = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return minute === DAY_MINUTES ? "24:00" : `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** ISO gün → kısa gün adı (aktif dilde). 2024-01-01 bir Pazartesi. */
export function shortWeekday(isoDay: number, intlLocale: string): string {
  return new Intl.DateTimeFormat(intlLocale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, isoDay)));
}

/** "Pzt–Cum" / "Cmt" */
export function formatDayRange(days: number[], intlLocale: string): string {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return first === last ? shortWeekday(first, intlLocale) : `${shortWeekday(first, intlLocale)}–${shortWeekday(last, intlLocale)}`;
}

/**
 * Doktorun dilimindeki duvar saatini (`YYYY-MM-DD`, `HH:mm`) UTC ana çevirir — izin formunda
 * "tam gün" (gün başı → ertesi gün başı) ve saat aralığı için. Ofset hedef andaki gerçek değerdir
 * (yaz saati); iki adım yakınsama yeterlidir.
 */
export function wallTimeToUtcIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0);
  let guess = asUtc - offsetMinutes(new Date(asUtc), timeZone) * 60_000;
  guess = asUtc - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess).toISOString();
}

/** `YYYY-MM-DD` + gün. */
export function addDaysToDateKey(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
