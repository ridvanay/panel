/**
 * Paket R (2026-10-26) — saat diliminden ülke, ülke adı (aktif dilde), bayrak ve dilim kısaltması;
 * bölgeye göre 12/24 saat. Yeni paket YOK: `Intl` + statik tzdata tablosu (`tz-country.ts`).
 */
import { COUNTRY_ZONES, countryForTimeZone } from "./tz-country";

export { countryForTimeZone };

/** Ülke bilgisi taşımayan dilimler (tarayıcı bunu bildiriyorsa IP önerisi varsayılan olur). */
export function isAmbiguousTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return true;
  return /^(UTC|UCT|GMT|Universal|Zulu|Greenwich|Etc\/.*)$/i.test(timeZone);
}

/**
 * Bayrak yolu (flag-icons v7.5.0 `4x3`, `public/flags/README.md`). Tablodaki tüm ülkelerin bayrağı
 * vardır; bilinmeyen kodda `null` → çağıran ülke kodu rozeti gösterir.
 */
export function countryFlagSrc(countryCode: string | null | undefined): string | null {
  if (!countryCode || !COUNTRY_ZONES[countryCode.toUpperCase()]) return null;
  return `/flags/4x3/${countryCode.toLowerCase()}.svg`;
}

const displayNames = new Map<string, Intl.DisplayNames | null>();

/** `DE` → `Almanya` / `Germany` / `ألمانيا` (aktif dilde); desteklenmezse kodun kendisi. */
export function countryName(countryCode: string, intlLocale: string): string {
  let names = displayNames.get(intlLocale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([intlLocale], { type: "region" });
    } catch {
      names = null;
    }
    displayNames.set(intlLocale, names);
  }
  try {
    return names?.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

/**
 * `CET`, `GST`, `EST`, `AEDT` — İngilizce yerellerde sırayla denenir; yalnızca `GMT+1` gibi bir ofset
 * çıkıyorsa (anlamsız kısaltma) `null`.
 */
export function zoneAbbreviation(iso: string | Date, timeZone: string): string | null {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  for (const locale of ["en-US", "en-GB", "en-AU"]) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
      if (name && !/^(GMT|UTC)([+\-−]|$)/.test(name)) return name;
    } catch {
      return null;
    }
  }
  return null;
}

/** Varsayılan olarak 12 saat (4:00 PM) kullanılan bölgeler — ABD, Birleşik Krallık, Avustralya vb. */
export const TWELVE_HOUR_REGIONS: ReadonlySet<string> = new Set(["US", "GB", "AU", "NZ", "CA", "IN", "PH"]);

/**
 * Bölge + dil etiketinden varsayılan saat biçimi: bölge biliniyorsa bölgeye göre (en-US/en-GB/en-AU →
 * 12 saat; de/tr/Körfez → 24 saat), bölgesiz etikette yalnızca İngilizce 12 saat.
 */
export function defaultHour12(locale: string): boolean {
  let language = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  let region: string | undefined;
  try {
    const parsed = new Intl.Locale(locale);
    language = parsed.language;
    region = parsed.region;
  } catch {
    region = locale.split(/[-_]/)[1]?.toUpperCase();
  }
  if (region) return TWELVE_HOUR_REGIONS.has(region.toUpperCase());
  return language === "en";
}

/** Hastanın varsayılan saat biçimi için etiket: site dili + hastanın dilimindeki ülke (`en` + `GB` → `en-GB`). */
export function patientLocaleTag(siteLanguage: string, patientTimeZone: string | null | undefined): string {
  const language = siteLanguage.toLowerCase().split(/[-_]/)[0] ?? "tr";
  const region = countryForTimeZone(patientTimeZone ?? null);
  return region ? `${language}-${region}` : language;
}

/** Saat: 12 saatte `4:00 PM`, 24 saatte `16:00` (rakam sistemi aktif dile göre). */
export function formatClock(iso: string | Date, timeZone: string, intlLocale: string, hour12: boolean): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(intlLocale, {
    timeZone,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
  }).format(date);
}

/** `16:00 – 16:30` / `4:00 PM – 4:30 PM`. */
export function formatClockRange(startIso: string, endIso: string | null | undefined, timeZone: string, intlLocale: string, hour12: boolean): string {
  const start = formatClock(startIso, timeZone, intlLocale, hour12);
  return endIso ? `${start} – ${formatClock(endIso, timeZone, intlLocale, hour12)}` : start;
}

/** `28 Ekim 2026 Salı` / `Tuesday, October 28, 2026` — tarih sırası aktif dile göre. */
export function formatLongDate(iso: string | Date, timeZone: string, intlLocale: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(intlLocale, { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** Hastanın saatiyle gece mi (23:00–07:00 arası başlangıç)? Slot gizlenmez, yalnızca ipucu. */
export function isNightHour(iso: string, timeZone: string): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  return hour >= 23 || hour < 7;
}

/** Ardışık slotları (bitiş = sonraki başlangıç) tek aralıkta birleştirir (özet/onay/takvim için). */
export function mergeSlotRanges(slots: readonly { startsAt: string; endsAt: string }[]): { startsAt: string; endsAt: string }[] {
  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const merged: { startsAt: string; endsAt: string }[] = [];
  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (last && new Date(last.endsAt).getTime() === new Date(slot.startsAt).getTime()) last.endsAt = slot.endsAt;
    else merged.push({ startsAt: slot.startsAt, endsAt: slot.endsAt });
  }
  return merged;
}
