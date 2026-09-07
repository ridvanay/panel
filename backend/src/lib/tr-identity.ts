/**
 * `.claude/architect-scope-checkout-redesign.md` §5.4 (bağlayıcı) — TCKN/posta kodu doğrulama
 * yardımcıları. SAF fonksiyonlar, DB/IO YOK — `checkout.schemas.ts::CheckoutBillingInputSchema`
 * (`billing.nationalId`) bu modülü tüketir.
 */

const TC_KIMLIK_NO_PATTERN = /^[1-9]\d{10}$/;
const TR_POSTAL_CODE_PATTERN = /^\d{5}$/;

/**
 * T.C. Kimlik Numarası — resmî checksum algoritması:
 * - 11 hane, ilk hane `0` OLAMAZ.
 * - 10. hane: `((1,3,5,7,9. hanelerin toplamı * 7) - (2,4,6,8. hanelerin toplamı)) mod 10`.
 * - 11. hane: `(ilk 10 hanenin toplamı) mod 10`.
 *
 * Gerekçe (§5.2, bağlayıcı) — algoritma resmî/kapalı/istisnasızdır (yanlış reddetme riski
 * ~0), bu yüzden VKN'nin AKSİNE burada checksum ZORUNLU tutulur.
 */
export function isValidTcKimlikNo(value: string): boolean {
  if (!TC_KIMLIK_NO_PATTERN.test(value)) return false;

  const digits = value.split("").map(Number);
  const oddSum = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
  const evenSum = digits[1]! + digits[3]! + digits[5]! + digits[7]!;

  const expectedTenth = ((oddSum * 7 - evenSum) % 10 + 10) % 10;
  if (expectedTenth !== digits[9]) return false;

  const firstTenSum = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0);
  const expectedEleventh = firstTenSum % 10;
  if (expectedEleventh !== digits[10]) return false;

  return true;
}

/** TR posta kodu — tam 5 rakam (`^\d{5}$`), başka bir normalizasyon/il eşlemesi YAPILMAZ. */
export function isValidTrPostalCode(value: string): boolean {
  return TR_POSTAL_CODE_PATTERN.test(value);
}
