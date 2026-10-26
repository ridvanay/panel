import { z } from "zod";
import { countryForTimeZone } from "./tz-country";

/**
 * Paket P (2026-10-26) — hastanın saati + Türkiye saati birlikte gösterimi (e-postalar, DTO
 * doğrulaması). Yeni paket YOK: yalnızca yerleşik `Intl` (tam ICU); sabit ofset KULLANILMAZ —
 * yaz saati geçişleri her an için `Intl`'den okunur.
 */
export const TURKEY_TIME_ZONE = "Europe/Istanbul";

const IANA_LIKE = /^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/;

/** Geçerli bir IANA saat dilimi mi (Intl kabul ediyor mu)? */
export function isValidTimeZone(value: string): boolean {
  if (!IANA_LIKE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z.string().trim().max(64).refine(isValidTimeZone, "Geçersiz saat dilimi.");

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timeZone: string): Wall {
  let fmt = FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    FORMATTERS.set(timeZone, fmt);
  }
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) if (part.type !== "literal") map[part.type] = part.value;
  return { year: +map.year!, month: +map.month!, day: +map.day!, hour: +map.hour! % 24, minute: +map.minute! };
}

/** Anın verilen dilimdeki UTC ofseti (dakika, doğu pozitif) — her an için ayrı hesaplanır (DST). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** `GMT+3`, `GMT-4`, `GMT+5:30`, `GMT`. */
export function gmtLabel(instant: Date, timeZone: string): string {
  const total = offsetMinutes(instant, timeZone);
  if (total === 0) return "GMT";
  const sign = total > 0 ? "+" : "-";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** `Europe/Berlin` → `Berlin`, `America/Argentina/Buenos_Aires` → `Buenos Aires`. */
export function cityLabel(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `DD.MM.YYYY HH:mm` — verilen dilimin duvar saati. */
export function formatWall(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone);
  return `${pad2(w.day)}.${pad2(w.month)}.${w.year} ${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** İki dilim bu anda aynı duvar saatini mi gösteriyor (ör. hasta zaten Türkiye saatinde)? */
export function sameWallClock(instant: Date, a: string, b: string): boolean {
  return formatWall(instant, a) === formatWall(instant, b);
}

/**
 * Hastaya giden e-postalar — `28.10.2026 16:00 your time (Berlin, GMT+1) · Turkey time: 28.10.2026 18:00 (GMT+3)`.
 * Hasta dilimi yoksa ya da Türkiye ile aynı saatteyse tek saat: `28.10.2026 18:00 Turkey time (GMT+3)`.
 */
export function formatPatientSlot(instant: Date, patientTimeZone: string | null | undefined): string {
  const tz = patientTimeZone && isValidTimeZone(patientTimeZone) ? patientTimeZone : null;
  const turkey = `${formatWall(instant, TURKEY_TIME_ZONE)}`;
  if (!tz || sameWallClock(instant, tz, TURKEY_TIME_ZONE)) return `${turkey} Turkey time (${gmtLabel(instant, TURKEY_TIME_ZONE)})`;
  return `${formatWall(instant, tz)} your time (${cityLabel(tz)}, ${gmtLabel(instant, tz)}) · Turkey time: ${turkey} (${gmtLabel(instant, TURKEY_TIME_ZONE)})`;
}

/**
 * Doktora giden e-postalar — doktorun kendi dilimi + hastanın saati:
 * `28.10.2026 18:00 (Istanbul, GMT+3) · Patient: Berlin 28.10.2026 16:00 (GMT+1)`.
 */
export function formatDoctorSlot(instant: Date, doctorTimeZone: string, patientTimeZone: string | null | undefined): string {
  const base = `${formatWall(instant, doctorTimeZone)} (${cityLabel(doctorTimeZone)}, ${gmtLabel(instant, doctorTimeZone)})`;
  const tz = patientTimeZone && isValidTimeZone(patientTimeZone) ? patientTimeZone : null;
  if (!tz || sameWallClock(instant, tz, doctorTimeZone)) return base;
  return `${base} · Patient: ${cityLabel(tz)} ${formatWall(instant, tz)} (${gmtLabel(instant, tz)})`;
}

export function formatPatientSlots(instants: readonly Date[], patientTimeZone: string | null | undefined): string {
  return instants.map((i) => formatPatientSlot(i, patientTimeZone)).join("; ");
}

export function formatDoctorSlots(instants: readonly Date[], doctorTimeZone: string, patientTimeZone: string | null | undefined): string {
  return instants.map((i) => formatDoctorSlot(i, doctorTimeZone, patientTimeZone)).join("; ");
}

// ---------------------------------------------------------------------------------------------
// Paket R (2026-10-26) — aralıklı, bölgeye göre 12/24 saatli e-posta biçimi
// ---------------------------------------------------------------------------------------------

/** Varsayılan olarak 12 saat (ÖÖ/ÖS) kullanan bölgeler — ABD, Birleşik Krallık, Avustralya vb. */
export const TWELVE_HOUR_REGIONS: ReadonlySet<string> = new Set(["US", "GB", "AU", "NZ", "CA", "IN", "PH"]);

/**
 * `CET`, `GST`, `EST`, `AEDT` — `Intl` kısa dilim adı (İngilizce yerellerde sırayla denenir). Yalnızca
 * `GMT+1` gibi bir ofset dönüyorsa (anlamsız kısaltma) `null`.
 */
export function zoneAbbreviation(instant: Date, timeZone: string): string | null {
  for (const locale of ["en-US", "en-GB", "en-AU"]) {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(instant).find((p) => p.type === "timeZoneName")?.value;
    if (name && !/^(GMT|UTC)([+\-−]|$)/.test(name)) return name;
  }
  return null;
}

/** `Tuesday, 28 October 2026` — İngilizce e-posta tarihi (verilen dilimin takvim günü). */
function formatLongDate(instant: Date, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
}

function formatClock(instant: Date, timeZone: string, hour12: boolean): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" }).format(instant);
}

export interface SlotRange {
  startsAt: Date;
  endsAt?: Date | null;
}

/** Ardışık slotları (bir öncekinin bitişi = sonrakinin başlangıcı) tek aralıkta birleştirir. */
export function mergeSlotRanges(slots: readonly SlotRange[]): SlotRange[] {
  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const merged: SlotRange[] = [];
  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (last?.endsAt && slot.endsAt && last.endsAt.getTime() === slot.startsAt.getTime()) last.endsAt = slot.endsAt;
    else merged.push({ startsAt: slot.startsAt, endsAt: slot.endsAt ?? null });
  }
  return merged;
}

function rangeText(range: SlotRange, timeZone: string, hour12: boolean): string {
  const start = formatClock(range.startsAt, timeZone, hour12);
  return range.endsAt ? `${formatLongDate(range.startsAt, timeZone)}, ${start}–${formatClock(range.endsAt, timeZone, hour12)}` : `${formatLongDate(range.startsAt, timeZone)}, ${start}`;
}

/**
 * Hastaya giden e-postalar (Paket R biçimi):
 * `Tuesday, 28 October 2026, 16:00–16:30 (Berlin, CET) — Istanbul: Tuesday, 28 October 2026, 18:00–18:30 (GMT+3)`.
 * Hastanın saati bölgesine göre 12/24 saat (ABD/BK/Avustralya 12 saat); Türkiye saati HER ZAMAN 24 saat.
 * Hasta dilimi yoksa ya da Türkiye ile aynı saatteyse tek satır: `… 18:00–18:30 Turkey time (GMT+3)`.
 */
export function formatPatientRange(range: SlotRange, patientTimeZone: string | null | undefined): string {
  const tz = patientTimeZone && isValidTimeZone(patientTimeZone) ? patientTimeZone : null;
  const turkey = `${rangeText(range, TURKEY_TIME_ZONE, false)}`;
  const turkeyGmt = gmtLabel(range.startsAt, TURKEY_TIME_ZONE);
  if (!tz || sameWallClock(range.startsAt, tz, TURKEY_TIME_ZONE)) return `${turkey} Turkey time (${turkeyGmt})`;
  const hour12 = TWELVE_HOUR_REGIONS.has(countryForTimeZone(tz) ?? "");
  const zone = zoneAbbreviation(range.startsAt, tz) ?? gmtLabel(range.startsAt, tz);
  return `${rangeText(range, tz, hour12)} (${cityLabel(tz)}, ${zone}) — Istanbul: ${turkey} (${turkeyGmt})`;
}

export function formatPatientRanges(slots: readonly SlotRange[], patientTimeZone: string | null | undefined): string {
  return mergeSlotRanges(slots)
    .map((r) => formatPatientRange(r, patientTimeZone))
    .join("; ");
}

