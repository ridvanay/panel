import geoip from "geoip-lite";

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
