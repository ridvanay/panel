import geoip from "geoip-lite";
import { isValidTimeZone } from "./dual-time";
import { countryForTimeZone, primaryZoneForCountry } from "./tz-country";

/**
 * IP adresinden ISO 3166-1 alpha-2 ülke kodu tespiti — tamamen offline (geoip-lite
 * kendi gömülü veritabanını kullanır), harici API çağrısı/anahtar YOK. Localhost/özel
 * IP aralıkları veya bilinmeyen adresler için "UNKNOWN" döner (asla uydurma değer üretmez).
 */
export function detectCountry(ip: string | undefined): string {
  if (!ip) return "UNKNOWN";
  const result = geoip.lookup(ip);
  return result?.country ?? "UNKNOWN";
}

/**
 * Paket R — `zone.tab`'daki ilk dilimin hasta kitlesi için yanıltıcı olduğu ülkelerde ana dilim
 * (ör. RU'da ilk satır Kaliningrad). Yalnızca geoip kaydında dilim YOKSA kullanılır.
 */
const PRIMARY_ZONE_OVERRIDES: Readonly<Record<string, string>> = {
  RU: "Europe/Moscow",
  US: "America/New_York",
  CA: "America/Toronto",
  AU: "Australia/Sydney",
  BR: "America/Sao_Paulo",
  KZ: "Asia/Almaty",
  MX: "America/Mexico_City",
  ID: "Asia/Jakarta",
  CN: "Asia/Shanghai",
};

export interface GeoHint {
  /** ISO 3166-1 alpha-2; bilinmiyorsa `null`. */
  countryCode: string | null;
  /** O ülkenin olası IANA dilimi; bilinmiyorsa `null`. */
  timeZone: string | null;
}

/**
 * Paket R — `/geo/hint`: IP'den YALNIZCA ülke kodu ve olası dilim (öneri amaçlı). IP saklanmaz,
 * döndürülmez, loglanmaz (çağıran route `logLevel: "silent"`); harici çağrı yok (geoip-lite offline).
 */
export function geoHintForIp(ip: string | undefined): GeoHint {
  if (!ip) return { countryCode: null, timeZone: null };
  const result = geoip.lookup(ip);
  const countryCode = result?.country && /^[A-Z]{2}$/.test(result.country) ? result.country : null;
  if (!countryCode) return { countryCode: null, timeZone: null };
  const fromDb = result?.timezone && isValidTimeZone(result.timezone) && countryForTimeZone(result.timezone) === countryCode ? result.timezone : null;
  const timeZone = fromDb ?? PRIMARY_ZONE_OVERRIDES[countryCode] ?? primaryZoneForCountry(countryCode);
  return { countryCode, timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : null };
}

