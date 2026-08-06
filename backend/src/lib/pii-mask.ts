/**
 * §10.8.10 Analitik Rapor Dışa Aktarma — kullanıcı tarafından onaylanmış karar: export
 * verisi VARSAYILAN olarak maskeli üretilir (`unmaskPii: false`, bkz. reports.schemas.ts).
 * Bu modül yalnızca SAF string dönüşümleri içerir, DB/IO YOKTUR.
 */

/** `a***@domain.com` biçimi — ilk karakter + sabit üç yıldız + domain aynen kalır. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const first = email[0];
  const domain = email.slice(at + 1);
  return `${first}***@${domain}`;
}

/**
 * IPv4: son oktet `0`'lanır (ör. `8.8.8.8` -> `8.8.8.0`). IPv6: son grup `0`'lanır (yaklaşık
 * eşdeğer davranış — şu anki export rapor türlerinden (VIEWS/BREAKDOWN/SUMMARY/TOP_CONTENT/
 * USERS/REVENUE) HİÇBİRİ ham IP alanı içermiyor; bu fonksiyon ileride IP taşıyan bir rapor
 * türü eklenirse kullanılmak üzere hazır tutulur.
 */
export function maskIp(ip: string): string {
  if (!ip) return ip;
  const ipv4Match = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (ipv4Match) return `${ipv4Match[1]}.0`;

  if (ip.includes(":")) {
    const parts = ip.split(":");
    parts[parts.length - 1] = "0";
    return parts.join(":");
  }
  return ip;
}
