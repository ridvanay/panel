/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.4 + §6 madde 4
 * (bağlayıcı, ENGELLEYİCİ) — bu dosya `backend/src/lib/identity.ts`'in T.C. Kimlik No / pasaport
 * FORMAT DENETİMİ + doğum tarihi/yaş kurallarının **BİREBİR istemci kopyasıdır** (yalnızca anlık
 * form geri bildirimi için — **sunucu doğrulaması asıldır**, ikinci bir algoritma İCAT EDİLMEZ).
 *
 * Bu bir "kimlik doğrulaması" DEĞİLDİR ([DPI] §2.5) — algoritmik format denetimidir. Hiçbir
 * fonksiyon/yorum "doğrulandı" ifadesini kullanmaz.
 *
 * GÜVENLİK: bu dosyadaki fonksiyonlar SAF'tır (DB/IO/ağ YOK) — kimlik numarası hiçbir
 * `localStorage`/`sessionStorage`/URL/analitik olayına YAZILMAZ ([DPI] §6 madde 4).
 */

const TC_KIMLIK_NO_PATTERN = /^[1-9]\d{10}$/;
/** [DPI] §2.4 madde 4 — ilk 10 hanesi aynı olan değerler algoritmayı GEÇER ama tahsis edilmez. */
const TC_KIMLIK_NO_REPDIGIT_PATTERN = /^(\d)\1{9}\d$/;
const PASSPORT_PATTERN = /^[A-Z0-9]{6,20}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** `backend/src/lib/identity.ts::isValidTurkishIdentityNumber` İLE BİREBİR AYNI algoritma. */
export function isValidTurkishIdentityNumber(value: string): boolean {
  if (!TC_KIMLIK_NO_PATTERN.test(value)) return false;
  if (TC_KIMLIK_NO_REPDIGIT_PATTERN.test(value)) return false;

  const digits = value.split("").map(Number);
  const oddSum = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
  const evenSum = digits[1]! + digits[3]! + digits[5]! + digits[7]!;

  const expectedTenth = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
  if (expectedTenth !== digits[9]) return false;

  const firstTenSum = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0);
  const expectedEleventh = firstTenSum % 10;
  return expectedEleventh === digits[10];
}

/** `backend/src/lib/identity.ts::isValidPassportNumber` İLE AYNI — sağlama algoritması UYGULANMAZ. */
export function isValidPassportNumber(value: string): boolean {
  return PASSPORT_PATTERN.test(value);
}

export function isValidIdentityCountryCode(value: string): boolean {
  return COUNTRY_CODE_PATTERN.test(value) && value !== "TR";
}

export type BookingCitizenshipType = "TR" | "FOREIGN";

/** `backend/src/lib/identity.ts::normalizeIdentityNumber` İLE AYNI — TR rakam, FOREIGN BÜYÜK harf. */
export function normalizeIdentityNumber(citizenshipType: BookingCitizenshipType, rawNumber: string): string {
  const stripped = rawNumber.replace(/[\s-]/g, "");
  return citizenshipType === "TR" ? stripped : stripped.toUpperCase();
}

export const MIN_IDENTITY_AGE_YEARS = 18;
export const MAX_IDENTITY_AGE_YEARS = 120;

/** `backend/src/lib/identity.ts::calculateAgeYears` İLE AYNI — UTC-safe yaş hesabı. */
export function calculateAgeYears(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
}

/**
 * [DPI] §2.4 — `YYYY-MM-DD` bileşenlerinden DAİMA `new Date("<YYYY-MM-DD>T00:00:00.000Z")` ile
 * ayrıştırır (yerel-saat kurucuları YASAK). Geçersiz/gelecek/120 yaştan büyük bir tarih için `null`.
 */
export function parseIdentityBirthDateParts(year: number, month: number, day: number, now: Date = new Date()): Date | null {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  if (parsed.getTime() > now.getTime()) return null;
  const minAllowedBirth = Date.UTC(now.getUTCFullYear() - MAX_IDENTITY_AGE_YEARS, now.getUTCMonth(), now.getUTCDate());
  if (parsed.getTime() < minAllowedBirth) return null;
  return parsed;
}

/** [DPI] §2.2/§2.4 — `@db.Date` gidiş-dönüşü için DAİMA `.toISOString().slice(0, 10)`. */
export function serializeIdentityBirthDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
