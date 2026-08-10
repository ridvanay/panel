/**
 * §10.8.9 WooCommerce fiyat ayrıştırma — `Product.priceCents`/`discountPriceCents` HER ZAMAN
 * kuruş cinsinden `Int`'tir. `parseFloat(x) * 100` YASAKTIR (float hassasiyeti, ör.
 * `19.99 * 100 = 1998.9999…`) — bkz. ARCHITECTURE.md §10.8.9 "Fiyat kuralı".
 *
 * Yalnızca STRING tabanlı tamsayı aritmetiği kullanılır: ondalık kısım METİN üzerinden
 * ayrılır, kesir 2 basamağa pad'lenir/round edilir (2'den fazla basamak → yarım yukarı
 * yuvarlama), sonra tam kısımla tam sayı toplaması yapılır.
 */
export function parsePriceToCents(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let s = raw.trim();
  if (!s) return null;

  // WooCommerce export'ları bazen ondalık ayracı olarak virgül kullanır (yerel biçim).
  s = s.replace(/,/g, ".");

  const segments = s.split(".");
  let intPart: string;
  let fracPart: string;
  if (segments.length > 1) {
    // Son segment ondalık kesirdir; öncekiler (binlik ayraç kalıntısı olabilir) birleştirilir.
    fracPart = segments.pop()!;
    intPart = segments.join("");
  } else {
    intPart = segments[0] ?? "";
    fracPart = "";
  }

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;

  intPart = intPart || "0";

  let cents: number;
  if (fracPart.length <= 2) {
    cents = Number(fracPart.padEnd(2, "0"));
  } else {
    // 2'den fazla ondalık basamak — yarım yukarı yuvarlama (banker's rounding DEĞİL).
    const kept = fracPart.slice(0, 2);
    const nextDigit = fracPart.charAt(2);
    cents = Number(kept);
    if (nextDigit >= "5") cents += 1;
  }

  const totalCents = Number(intPart) * 100 + cents;
  if (!Number.isFinite(totalCents) || !Number.isInteger(totalCents)) return null;
  return totalCents;
}
