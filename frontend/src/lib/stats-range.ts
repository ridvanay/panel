import { format, startOfYear, subDays } from "date-fns";
import type { StatsGranularity } from "@/lib/api/types";
import type { StatsRangeQuery } from "@/lib/api/stats";

export type RangePreset = "7d" | "30d" | "90d" | "ytd" | "custom";

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "7 gün",
  "30d": "30 gün",
  "90d": "90 gün",
  ytd: "Yıl başından",
  custom: "Özel aralık",
};

export const GRANULARITY_LABELS: Record<StatsGranularity, string> = {
  day: "Günlük",
  week: "Haftalık",
  month: "Aylık",
};

const DATE_KEY_FORMAT = "yyyy-MM-dd";

/** Sayfa/bileşen state'i — `from`/`to` her zaman `yyyy-MM-dd` (yerel gün) tutar, API'ye
 *  gönderilirken `toStatsRangeQuery` UTC gün başı/sonu ISO datetime'a çevirir. */
export interface StatsFilterState {
  preset: RangePreset;
  from: string;
  to: string;
  granularity: StatsGranularity;
}

function dateKey(date: Date): string {
  return format(date, DATE_KEY_FORMAT);
}

/** `custom` DIŞINDAKİ tüm preset'lerin `from`/`to`'sunu bugüne göre türetir. */
export function computePresetRange(preset: Exclude<RangePreset, "custom">, today: Date = new Date()): { from: string; to: string } {
  const to = dateKey(today);
  switch (preset) {
    case "7d":
      return { from: dateKey(subDays(today, 6)), to };
    case "30d":
      return { from: dateKey(subDays(today, 29)), to };
    case "90d":
      return { from: dateKey(subDays(today, 89)), to };
    case "ytd":
      return { from: dateKey(startOfYear(today)), to };
  }
}

export function defaultStatsFilterState(): StatsFilterState {
  return { preset: "30d", ...computePresetRange("30d"), granularity: "day" };
}

const KNOWN_PRESETS: RangePreset[] = ["7d", "30d", "90d", "ytd", "custom"];
const KNOWN_GRANULARITIES: StatsGranularity[] = ["day", "week", "month"];

function isValidDateKey(value: string | null): value is string {
  return Boolean(value) && !Number.isNaN(Date.parse(value!));
}

/** URL `?preset=...&granularity=...&from=...&to=...`'dan filtre state'i türetir — paylaşılabilir link. */
export function statsFilterStateFromSearchParams(params: URLSearchParams): StatsFilterState {
  const presetParam = params.get("preset");
  const preset = KNOWN_PRESETS.includes(presetParam as RangePreset) ? (presetParam as RangePreset) : "30d";
  const granularityParam = params.get("granularity");
  const granularity = KNOWN_GRANULARITIES.includes(granularityParam as StatsGranularity)
    ? (granularityParam as StatsGranularity)
    : "day";

  if (preset === "custom") {
    const from = params.get("from");
    const to = params.get("to");
    if (isValidDateKey(from) && isValidDateKey(to) && from <= to) {
      return { preset, from, to, granularity };
    }
    return defaultStatsFilterState();
  }

  return { preset, ...computePresetRange(preset), granularity };
}

/** Filtre state'ini URL query string'e (yeni bir `URLSearchParams`) çevirir. */
export function statsFilterStateToSearchParams(state: StatsFilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("preset", state.preset);
  params.set("granularity", state.granularity);
  if (state.preset === "custom") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  return params;
}

/**
 * `yyyy-MM-dd` bir gün anahtarını GERÇEK UTC gün başı/sonu ISO datetime'a çevirir (backend
 * `resolveStatsRange`/`startOfUtcDay` ile AYNI gün sınırları — bkz. `lib/stats-query.ts`).
 * BİLEREK `Date.UTC(...)` ile inşa edilir; `date-fns`'in `startOfDay`/`endOfDay`'i YEREL saat
 * dilimini kullanır ve UTC+X'te (ör. TR, +03:00) günü kaydırırdı (regresyon — bkz.
 * `tests/unit/stats-range.test.ts`). `create-export-dialog.tsx` da AYNI fonksiyonu kullanır.
 */
export function dateKeyToUtcIso(dateKey: string, boundary: "start" | "end"): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date =
    boundary === "start"
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return date.toISOString();
}

/** Filtre state'ini `/admin/stats/*` sorgu parametrelerine çevirir. */
export function toStatsRangeQuery(state: StatsFilterState, extra: { compare?: boolean } = {}): StatsRangeQuery {
  return {
    from: dateKeyToUtcIso(state.from, "start"),
    to: dateKeyToUtcIso(state.to, "end"),
    granularity: state.granularity,
    compare: extra.compare,
  };
}

// Projedeki diğer grafiklerle (bkz. visitor-chart.tsx/chart-tooltip.tsx) AYNI tr-TR gösterim
// dilini korumak için etiketler `Intl.DateTimeFormat` ile üretilir — `date-fns` yalnızca
// (locale'den bağımsız) tarih ARİTMETİĞİ için kullanılır.
const dayLabelFormatter = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const monthLabelFormatter = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "numeric" });

/** Grafik/tarih ekseni etiketleri için — bucket `date`'i (gün/hafta/ay) granularity'ye göre biçimler. */
export function formatBucketLabel(dateKey: string, granularity: StatsGranularity): string {
  const date = new Date(dateKey);
  if (Number.isNaN(date.getTime())) return dateKey;
  return granularity === "month" ? monthLabelFormatter.format(date) : dayLabelFormatter.format(date);
}
