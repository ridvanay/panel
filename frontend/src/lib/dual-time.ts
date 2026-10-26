/**
 * Paket P (2026-10-26) — randevu saatlerinin hastanın saati + Türkiye saati olarak birlikte
 * gösterimi. Yeni paket YOK; yalnızca yerleşik `Intl`. Sabit ofset KULLANILMAZ: ofset her an için
 * ayrı okunur (yaz saati geçişleri, gün kaymaları doğru çıkar). Backend karşılığı:
 * `backend/src/lib/dual-time.ts` (e-postalar).
 */
import { formatDayKey, formatDayLabel, formatTime } from "./telehealth-format";

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
// Saat dilimi listesi — `Intl.supportedValuesOf('timeZone')`; yaygın şehirler üstte, ülke adıyla aranabilir.
// ---------------------------------------------------------------------------------------------

/** Hasta kitlesinin yaygın dilimleri (üstte gösterilir) + aramada kullanılan ülke adları (EN/TR/yerel). */
export const COMMON_TIME_ZONES: { tz: string; countries: string[] }[] = [
  { tz: "Europe/Istanbul", countries: ["Turkey", "Türkiye", "Türkei", "Turquía", "تركيا", "Турция"] },
  { tz: "Europe/London", countries: ["United Kingdom", "UK", "England", "Birleşik Krallık", "İngiltere", "Reino Unido", "Vereinigtes Königreich", "المملكة المتحدة", "Великобритания"] },
  { tz: "Europe/Berlin", countries: ["Germany", "Almanya", "Deutschland", "Alemania", "ألمانيا", "Германия"] },
  { tz: "Europe/Paris", countries: ["France", "Fransa", "Frankreich", "Francia", "فرنسا", "Франция"] },
  { tz: "Europe/Amsterdam", countries: ["Netherlands", "Hollanda", "Niederlande", "Países Bajos", "هولندا", "Нидерланды"] },
  { tz: "Europe/Madrid", countries: ["Spain", "İspanya", "Spanien", "España", "إسبانيا", "Испания"] },
  { tz: "Europe/Moscow", countries: ["Russia", "Rusya", "Russland", "Rusia", "روسيا", "Россия"] },
  { tz: "Asia/Almaty", countries: ["Kazakhstan", "Kazakistan", "Kasachstan", "Kazajistán", "كازاخستان", "Казахстан"] },
  { tz: "Asia/Baku", countries: ["Azerbaijan", "Azerbaycan", "Aserbaidschan", "Azerbaiyán", "أذربيجان", "Азербайджан"] },
  { tz: "Asia/Riyadh", countries: ["Saudi Arabia", "Suudi Arabistan", "Saudi-Arabien", "Arabia Saudí", "السعودية", "Саудовская Аравия"] },
  { tz: "Asia/Dubai", countries: ["United Arab Emirates", "UAE", "Birleşik Arap Emirlikleri", "BAE", "Vereinigte Arabische Emirate", "Emiratos Árabes Unidos", "الإمارات", "ОАЭ"] },
  { tz: "Asia/Qatar", countries: ["Qatar", "Katar", "قطر", "Катар"] },
  { tz: "Asia/Kuwait", countries: ["Kuwait", "Kuveyt", "الكويت", "Кувейт"] },
  { tz: "Asia/Baghdad", countries: ["Iraq", "Irak", "العراق", "Ирак"] },
  { tz: "Africa/Cairo", countries: ["Egypt", "Mısır", "Ägypten", "Egipto", "مصر", "Египет"] },
  { tz: "America/New_York", countries: ["United States", "USA", "ABD", "Amerika", "Vereinigte Staaten", "Estados Unidos", "الولايات المتحدة", "США"] },
  { tz: "America/Chicago", countries: ["United States", "USA", "ABD"] },
  { tz: "America/Los_Angeles", countries: ["United States", "USA", "ABD"] },
  { tz: "America/Toronto", countries: ["Canada", "Kanada", "كندا", "Канада"] },
  { tz: "Australia/Sydney", countries: ["Australia", "Avustralya", "Australien", "أستراليا", "Австралия"] },
];

/** Tüm IANA dilimleri (destek yoksa yaygın liste). Yaygınlar önce, gerisi alfabetik. */
export function listTimeZones(): string[] {
  let all: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    all = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  const common = COMMON_TIME_ZONES.map((c) => c.tz);
  const rest = all.filter((tz) => !common.includes(tz)).sort();
  return [...common, ...rest];
}

const fold = (value: string) =>
  value
    .toLocaleLowerCase("en")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");

/** Şehir (dilimin son parçası), tam IANA kimliği veya (yaygınlar için) ülke adıyla arar. */
export function searchTimeZones(query: string, zones: string[] = listTimeZones()): string[] {
  const q = fold(query.trim());
  if (!q) return zones;
  return zones.filter((tz) => {
    if (fold(tz.replace(/_/g, " ")).includes(q)) return true;
    const countries = COMMON_TIME_ZONES.find((c) => c.tz === tz)?.countries ?? [];
    return countries.some((country) => fold(country).includes(q));
  });
}
