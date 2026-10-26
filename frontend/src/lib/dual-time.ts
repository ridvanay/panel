/**
 * Paket P (2026-10-26) — randevu saatlerinin hastanın saati + Türkiye saati olarak birlikte
 * gösterimi. Yeni paket YOK; yalnızca yerleşik `Intl`. Sabit ofset KULLANILMAZ: ofset her an için
 * ayrı okunur (yaz saati geçişleri, gün kaymaları doğru çıkar). Backend karşılığı:
 * `backend/src/lib/dual-time.ts` (e-postalar).
 */
import { formatDayKey, formatDayLabel, formatTime } from "./telehealth-format";
import { countryForTimeZone, countryName } from "./country-display";

export const TURKEY_TIME_ZONE = "Europe/Istanbul";
export const PATIENT_TIME_ZONE_STORAGE_KEY = "wm-patient-tz";

const IANA_LIKE = /^[A-Za-z][A-Za-z0-9_+\-/]{1,63}$/;

export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value || !IANA_LIKE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Tarayıcının dilimi (SSR'da / desteklenmiyorsa `undefined`). */
export function browserTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

/** Anın verilen dilimdeki UTC ofseti (dakika, doğu pozitif). */
export function offsetMinutes(iso: string | Date, timeZone: string): number {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUtc = Date.UTC(map.year!, map.month! - 1, map.day!, map.hour! % 24, map.minute!);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** `GMT+3`, `GMT-5`, `GMT+5:30`, `GMT`. */
export function gmtLabel(iso: string | Date, timeZone: string): string {
  const total = offsetMinutes(iso, timeZone);
  if (total === 0) return "GMT";
  const abs = Math.abs(total);
  const minutes = abs % 60;
  return `GMT${total > 0 ? "+" : "-"}${Math.floor(abs / 60)}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/** `Europe/Berlin` → `Berlin`, `America/Argentina/Buenos_Aires` → `Buenos Aires`. */
export function cityLabel(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/** Hasta bu anda Türkiye ile aynı duvar saatinde mi (ör. Europe/Istanbul, Asia/Riyadh)? */
export function isSameClockAsTurkey(iso: string, timeZone: string): boolean {
  return offsetMinutes(iso, timeZone) === offsetMinutes(iso, TURKEY_TIME_ZONE);
}

export interface DualSlotTime {
  /** Hastanın saati (`HH:mm`, locale'e göre). */
  patientTime: string;
  turkeyTime: string;
  /** Hasta Türkiye saatindeyse tek satır gösterilir. */
  single: boolean;
  /** Türkiye takvim günü hastanınkinden farklıysa: +1 ertesi gün, -1 önceki gün. */
  turkeyDayShift: -1 | 0 | 1;
  patientDayKey: string;
  turkeyDayKey: string;
}

export function dualSlotTime(iso: string, patientTimeZone: string, intlLocale: string): DualSlotTime {
  const patientDayKey = formatDayKey(iso, patientTimeZone);
  const turkeyDayKey = formatDayKey(iso, TURKEY_TIME_ZONE);
  return {
    patientTime: formatTime(iso, patientTimeZone, intlLocale),
    turkeyTime: formatTime(iso, TURKEY_TIME_ZONE, intlLocale),
    single: isSameClockAsTurkey(iso, patientTimeZone),
    turkeyDayShift: turkeyDayKey === patientDayKey ? 0 : turkeyDayKey > patientDayKey ? 1 : -1,
    patientDayKey,
    turkeyDayKey,
  };
}

/** Türkiye'nin hastaya göre farkı (dakika): pozitif = Türkiye ileride. */
export function turkeyLeadMinutes(iso: string, patientTimeZone: string): number {
  return offsetMinutes(iso, TURKEY_TIME_ZONE) - offsetMinutes(iso, patientTimeZone);
}

/** `2 saat` / `2 hours` / `2 часа` — çoğul ekleri `Intl.NumberFormat` (unit) ile, sözlüksüz. */
export function formatHourSpan(minutes: number, intlLocale: string): string {
  const hours = Math.abs(minutes) / 60;
  try {
    return new Intl.NumberFormat(intlLocale, { style: "unit", unit: "hour", unitDisplay: "long", maximumFractionDigits: 2 }).format(hours);
  } catch {
    return `${hours} h`;
  }
}

/** Seçim özeti için: hastanın ve Türkiye'nin tarih+saati. */
export function dualDateTimeLabels(iso: string, patientTimeZone: string, intlLocale: string) {
  return {
    patient: `${formatDayLabel(iso, patientTimeZone, intlLocale)} · ${formatTime(iso, patientTimeZone, intlLocale)}`,
    turkey: `${formatDayLabel(iso, TURKEY_TIME_ZONE, intlLocale)} · ${formatTime(iso, TURKEY_TIME_ZONE, intlLocale)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Saat dilimi listesi — `Intl.supportedValuesOf('timeZone')`. Paket R: sık kullanılanlar üstte, arama
// ülke adıyla (aktif dilde ve İngilizce), şehirle ve "GMT+4" gibi ofsetle.
// ---------------------------------------------------------------------------------------------

/** Paket R — hasta trafiğinin olası kaynakları (Türkiye referans olarak başta). */
export const POPULAR_TIME_ZONES: readonly string[] = [
  "Europe/Istanbul",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Amsterdam",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Europe/Moscow",
  "Asia/Baku",
  "America/New_York",
  "America/Los_Angeles",
  "America/Toronto",
  "Australia/Sydney",
];

/** Tüm IANA dilimleri (destek yoksa sık kullanılanlar). Sık kullanılanlar önce, gerisi alfabetik. */
export function listTimeZones(): string[] {
  let all: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    all = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  const rest = all.filter((tz) => !POPULAR_TIME_ZONES.includes(tz)).sort();
  return [...POPULAR_TIME_ZONES, ...rest];
}

const fold = (value: string) =>
  value
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i");

/** `gmt+4`, `+4`, `utc+4`, `GMT+04:00` → `gmt+4` (ofset araması); ofset değilse `null`. */
function offsetQuery(q: string): string | null {
  const m = /^(?:gmt|utc)?\s*([+\-−])\s*0?(\d{1,2})(?::?(\d{2}))?$/.exec(q);
  if (!m) return /^(gmt|utc)$/.test(q) ? "gmt" : null;
  const minutes = m[3] && m[3] !== "00" ? `:${m[3]}` : "";
  return `gmt${m[1] === "−" ? "-" : m[1]}${Number(m[2])}${minutes}`;
}

/**
 * Şehir (dilimin son parçası), tam IANA kimliği, ülke adı (aktif dilde ve İngilizce) ya da ofsetle
 * ("GMT+4", "+4") arar. Ofset bu anki değerdir (yaz saati dahil).
 */
export function searchTimeZones(query: string, zones: string[] = listTimeZones(), intlLocale = "en-US", at: Date = new Date()): string[] {
  const q = fold(query.trim());
  if (!q) return zones;
  const offset = offsetQuery(q);
  return zones.filter((tz) => {
    if (offset) {
      const label = fold(gmtLabel(at, tz));
      return label === offset;
    }
    if (fold(tz.replace(/_/g, " ")).includes(q)) return true;
    const country = countryForTimeZone(tz);
    if (!country) return false;
    return fold(countryName(country, intlLocale)).includes(q) || fold(countryName(country, "en")).includes(q);
  });
}
