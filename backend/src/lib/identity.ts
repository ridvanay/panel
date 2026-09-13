import crypto from "node:crypto";
import { env } from "../config/env";
import { encryptSecret, decryptSecret } from "./crypto";
import { ValidationError, IdentityMinorNotSupportedError } from "./errors";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.3-2.5 +
 * `.claude/security-review-doctor-identity.md` (5 ENGELLEYİCİ madde) — hasta kimlik bilgisi
 * (T.C. Kimlik No / pasaport no) için TEK yardımcı dosya: format denetimi (algoritma), normalize,
 * hash (HMAC-SHA-256, HKDF-türetilmiş alt anahtar), maskeleme, şifreleme (mevcut `lib/crypto.ts`
 * sarmalanır), doğum tarihi denetimi.
 *
 * **BİLİNÇLİ OLARAK KULLANILMAYANLAR (security-review + [DPI] §2.3/§2.4/§6):**
 * - `lib/tokens.ts::hashToken` (çıplak SHA-256) — T.C. Kimlik No uzayı (~10^9) tuzsuz hash için
 *   kaba kuvvete açıktır; bu dosya bunun yerine ANAHTARLI HMAC kullanır.
 * - `lib/tr-identity.ts::isValidTcKimlikNo` — checkout/orders modülünün (`billing.nationalId`)
 *   yardımcısıdır, REPDIGIT REDDİ YAPMAZ ve pasaport/18-yaş/maskeleme gibi telehealth'e özgü
 *   kuralları taşımaz. İki modülün gereksinimleri farklılaştığı için AYRI dosyadır (security-review
 *   §7 — "haklı bir ayrım").
 *
 * Bu dosyada tanımlı hatalar (`ValidationError`, `IdentityMinorNotSupportedError`) SABİT/JENERİK
 * mesajlar taşır — girilen numara/normalize edilmiş hâli/doğum tarihi HİÇBİR hata gövdesine
 * enjekte EDİLMEZ (security-review ENGELLEYİCİ madde 3).
 *
 * **"Doğrulama" DEĞİL — algoritmik FORMAT DENETİMİ** ([DPI] §2.5, bağlayıcı dil kuralı). Bu
 * dosyadaki hiçbir fonksiyon/yorum "kimlik doğrulandı" ifadesini kullanmaz.
 */

// ---------------------------------------------------------------------------
// T.C. Kimlik No / pasaport format denetimi (SAF fonksiyonlar, DB/IO YOK).
// ---------------------------------------------------------------------------

const TC_KIMLIK_NO_PATTERN = /^[1-9]\d{10}$/;
/** [DPI] §2.4 madde 4 — ilk 10 hanesi aynı olan değerler algoritmayı GEÇER ama tahsis edilmez. */
const TC_KIMLIK_NO_REPDIGIT_PATTERN = /^(\d)\1{9}\d$/;
const PASSPORT_PATTERN = /^[A-Z0-9]{6,20}$/;

/**
 * [DPI] §2.4 (bağlayıcı, tek yardımcı) — resmî T.C. Kimlik No sağlama algoritması + repdigit
 * reddi. `lib/tr-identity.ts::isValidTcKimlikNo` İLE AYNI checksum formülünü uygular (çapraz
 * doğrulanmıştır, security-review §7) ama BURADA EK OLARAK repdigit'i reddeder.
 */
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

/**
 * [DPI] §2.4 — pasaport numarası biçimsel denetimi. Sağlama algoritması UYGULANMAZ (ülkeden
 * ülkeye değişir) — yalnızca temizlenmiş/büyük harfe çevrilmiş girdinin `^[A-Z0-9]{6,20}$`
 * kalıbına uyup uymadığına bakılır (çağıran taraf `normalizeIdentityNumber` ile önce normalize
 * ETMELİDİR).
 */
export function isValidPassportNumber(value: string): boolean {
  return PASSPORT_PATTERN.test(value);
}

export type BookingCitizenshipType = "TR" | "FOREIGN";

/** Boşluk/tire temizlenir; `TR` için değiştirilmez (rakam), `FOREIGN` için BÜYÜK harfe çevrilir. */
export function normalizeIdentityNumber(citizenshipType: BookingCitizenshipType, rawNumber: string): string {
  const stripped = rawNumber.replace(/[\s-]/g, "");
  return citizenshipType === "TR" ? stripped : stripped.toUpperCase();
}

// ---------------------------------------------------------------------------
// Doğum tarihi — DAİMA UTC-safe. [DPI] §2.4/§2.2 (bağlayıcı).
// ---------------------------------------------------------------------------

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** [DPI] §2.4 — 120 yaştan büyük beyan → 422 (gerçekçi olmayan bir doğum tarihi). */
const MAX_IDENTITY_AGE_YEARS = 120;
const MIN_IDENTITY_AGE_YEARS = 18;

const GENERIC_BIRTH_DATE_MESSAGE = "Geçersiz doğum tarihi.";

/**
 * [DPI] §2.4 (bağlayıcı) — ayrıştırma DAİMA `new Date("<YYYY-MM-DD>T00:00:00.000Z")` ile yapılır
 * (yerel-saat kurucuları YASAK — sunucu TZ'si UTC olmayan bir ortamda doğum gününü bir gün
 * oynatır). Takvim taşması (ör. `2024-02-30`) `Date`'in sessiz normalizasyonuyla KAÇMASIN diye
 * round-trip ile doğrulanır. Gelecekte bir tarih VEYA 120 yaştan büyük → `ValidationError`
 * (jenerik mesaj — girilen değer ASLA yansıtılmaz).
 */
export function parseIdentityBirthDate(value: string, now: Date = new Date()): Date {
  if (!ISO_DATE_ONLY_PATTERN.test(value)) {
    throw new ValidationError(GENERIC_BIRTH_DATE_MESSAGE, { birthDate: [GENERIC_BIRTH_DATE_MESSAGE] });
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(GENERIC_BIRTH_DATE_MESSAGE, { birthDate: [GENERIC_BIRTH_DATE_MESSAGE] });
  }

  if (parsed.getTime() > now.getTime()) {
    throw new ValidationError(GENERIC_BIRTH_DATE_MESSAGE, { birthDate: [GENERIC_BIRTH_DATE_MESSAGE] });
  }

  const minAllowedBirth = Date.UTC(now.getUTCFullYear() - MAX_IDENTITY_AGE_YEARS, now.getUTCMonth(), now.getUTCDate());
  if (parsed.getTime() < minAllowedBirth) {
    throw new ValidationError(GENERIC_BIRTH_DATE_MESSAGE, { birthDate: [GENERIC_BIRTH_DATE_MESSAGE] });
  }

  return parsed;
}

/** [DPI] §2.2/§2.4 — `@db.Date` gidiş-dönüşü için DAİMA `.toISOString().slice(0, 10)`. */
export function serializeIdentityBirthDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calculateAgeYears(birthDate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
}

/**
 * [DPI] §2.4/§2.5 (bağlayıcı) — beyan edilen doğum tarihine göre hesaplanan yaş < 18 →
 * `IdentityMinorNotSupportedError` (422 `IDENTITY_MINOR_NOT_SUPPORTED`). Veli/vasi rızası akışı
 * bu turun kapsamı DIŞINDADIR (backlog: `feature/telehealth-guardian-consent`). Bu bir "yaş
 * doğrulaması" DEĞİLDİR — beyanın biçimsel/mantıksal bir denetimidir.
 */
export function assertIdentityNotMinor(birthDate: Date, now: Date = new Date()): void {
  if (calculateAgeYears(birthDate, now) < MIN_IDENTITY_AGE_YEARS) {
    throw new IdentityMinorNotSupportedError();
  }
}

// ---------------------------------------------------------------------------
// Girdi orkestrasyonu — Zod şeması (telehealth.schemas.ts::BookingIdentityInputSchema) yalnızca
// YÜZEYSEL şekli (uzunluk/regex) doğrular; TCKN checksum'u, pasaport biçimi, ülke kodu kuralları
// ve 18 yaş sınırı BURADA, DERİN denetim olarak yapılır.
// ---------------------------------------------------------------------------

export interface BookingIdentityRawInput {
  citizenshipType: BookingCitizenshipType;
  identityNumber: string;
  countryCode?: string | null;
  birthDate: string;
}

export interface ValidatedBookingIdentity {
  citizenshipType: BookingCitizenshipType;
  countryCode: string;
  normalizedNumber: string;
  birthDate: Date;
}

const GENERIC_TR_IDENTITY_MESSAGE = "Geçersiz T.C. Kimlik Numarası formatı.";
const GENERIC_PASSPORT_MESSAGE = "Geçersiz pasaport numarası formatı.";
const GENERIC_COUNTRY_CODE_MESSAGE = "Geçersiz ülke kodu.";
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * [DPI] §2.4/§2.6 — `POST /appointments/bookings` ve `PUT .../identity` TARAFINDAN PAYLAŞILAN
 * TEK derin doğrulama orkestratörü. Hata mesajları SABİT/JENERİKTİR; `input.identityNumber`/
 * `input.birthDate` hiçbir hata gövdesine (mesaj/`details`) enjekte EDİLMEZ (security-review
 * ENGELLEYİCİ madde 3).
 */
export function validateBookingIdentityInput(input: BookingIdentityRawInput, now: Date = new Date()): ValidatedBookingIdentity {
  let countryCode: string;
  let normalizedNumber: string;

  if (input.citizenshipType === "TR") {
    normalizedNumber = normalizeIdentityNumber("TR", input.identityNumber);
    if (!isValidTurkishIdentityNumber(normalizedNumber)) {
      throw new ValidationError(GENERIC_TR_IDENTITY_MESSAGE, { identityNumber: [GENERIC_TR_IDENTITY_MESSAGE] });
    }
    countryCode = input.countryCode?.trim().toUpperCase() || "TR";
    if (countryCode !== "TR") {
      throw new ValidationError(GENERIC_COUNTRY_CODE_MESSAGE, { countryCode: [GENERIC_COUNTRY_CODE_MESSAGE] });
    }
  } else {
    normalizedNumber = normalizeIdentityNumber("FOREIGN", input.identityNumber);
    if (!isValidPassportNumber(normalizedNumber)) {
      throw new ValidationError(GENERIC_PASSPORT_MESSAGE, { identityNumber: [GENERIC_PASSPORT_MESSAGE] });
    }
    countryCode = input.countryCode?.trim().toUpperCase() ?? "";
    if (!COUNTRY_CODE_PATTERN.test(countryCode) || countryCode === "TR") {
      throw new ValidationError(GENERIC_COUNTRY_CODE_MESSAGE, { countryCode: [GENERIC_COUNTRY_CODE_MESSAGE] });
    }
  }

  const birthDate = parseIdentityBirthDate(input.birthDate, now);
  assertIdentityNotMinor(birthDate, now);

  return { citizenshipType: input.citizenshipType, countryCode, normalizedNumber, birthDate };
}

// ---------------------------------------------------------------------------
// Maskeleme — [DPI] §2.4, TEK yardımcı.
// ---------------------------------------------------------------------------

/**
 * [DPI] §2.4 (bağlayıcı, TEK yardımcı) — `TR` → ilk 3 + yıldızlar + son 2 (`123******89`).
 * `FOREIGN`/`FOREIGN_RESIDENT` → ilk 2 + yıldızlar + son 2. Her iki durumda da EN FAZLA 5 gerçek
 * karakter açığa çıkar; 6 karakterden kısa girdi TAMAMEN maskelenir.
 */
export function maskIdentityNumber(citizenshipType: BookingCitizenshipType, normalizedNumber: string): string {
  const length = normalizedNumber.length;

  if (citizenshipType === "TR") {
    // TCKN, `validateBookingIdentityInput`'tan geçmiş olduğu için HER ZAMAN 11 hanedir; yine de
    // savunma amaçlı `Math.max` ile alt sınır korunur.
    const starCount = Math.max(length - 5, 0);
    return `${normalizedNumber.slice(0, 3)}${"*".repeat(starCount)}${normalizedNumber.slice(-2)}`;
  }

  if (length < 6) return "*".repeat(length);
  return `${normalizedNumber.slice(0, 2)}${"*".repeat(length - 4)}${normalizedNumber.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Şifreleme — mevcut `lib/crypto.ts::encryptSecret/decryptSecret`'i SARAR. Yeni bir şifreleme
// yardımcısı YAZILMAZ ([DPI] §2.3, "KESİNLİKLE YAPMA" listesi).
// ---------------------------------------------------------------------------

export function encryptIdentityNumber(normalizedNumber: string): string {
  return encryptSecret(normalizedNumber);
}

export function decryptIdentityNumber(ciphertext: string): string {
  return decryptSecret(ciphertext);
}

// ---------------------------------------------------------------------------
// Hash — HKDF-türetilmiş alt anahtar + HMAC-SHA-256. [DPI] §2.3 (ENGELLEYİCİ, security-review).
// `lib/tokens.ts::hashToken` (çıplak SHA-256) BİLİNÇLİ OLARAK KULLANILMAZ.
// ---------------------------------------------------------------------------

/**
 * security-review ENGELLEYİCİ madde 1 — `salt`/`info` string literalleri TEK YERDE (burada)
 * `const` olarak tanımlanır, ikinci bir kopyası AÇILMAZ. `info` sonundaki `v1`: `ENCRYPTION_KEY`
 * rotasyonu bu hash'leri geçersiz kılar (şifreli değer çözülüp yeniden hash'lenerek
 * KURTARILABİLİR — bkz. documentation-agent notu); ileride algoritma değişirse `v2` açılır.
 */
const IDENTITY_HASH_HKDF_SALT = "telehealth-identity-hash";
const IDENTITY_HASH_HKDF_INFO = "identity-number-hmac-v1";
const IDENTITY_HASH_SUBKEY_LENGTH_BYTES = 32;

/**
 * security-review ENGELLEYİCİ madde 1 — `subKey`, `lib/crypto.ts::encryptionKey` deseniyle AYNI
 * şekilde MODÜL YÜKLEME ANINDA BİR KEZ hesaplanıp sabitlenir (her çağrıda yeniden `hkdfSync`
 * ÇALIŞTIRILMAZ). `crypto.hkdfSync` bir `ArrayBuffer` döner, `Buffer` DEĞİL — `crypto.createHmac`'e
 * geçirmeden önce `Buffer.from(...)` ile sarmalanır (aksi hâlde tip/çalışma zamanı uyumsuzluğu).
 */
const identityHashSubKey = Buffer.from(
  crypto.hkdfSync(
    "sha256",
    Buffer.from(env.ENCRYPTION_KEY, "base64"),
    IDENTITY_HASH_HKDF_SALT,
    IDENTITY_HASH_HKDF_INFO,
    IDENTITY_HASH_SUBKEY_LENGTH_BYTES
  )
);

/**
 * [DPI] §2.3 (bağlayıcı) — kanonik girdi `${citizenshipType}:${countryCode}:${normalizedNumber}`
 * (pasaport numarası yalnızca veren ülke içinde tekildir, ülke kodu girdiye DAHİLDİR). HMAC
 * ANAHTARLI olduğu için saldırgan `identityHashSubKey`'i (dolayısıyla `ENCRYPTION_KEY`'i)
 * bilmeden çevrimdışı hiçbir tarama yapamaz — T.C. Kimlik No uzayının düşük entropisi (~10^9)
 * bu yüzden önemsizdir (security-review §1).
 */
export function hashIdentityNumber(citizenshipType: BookingCitizenshipType, countryCode: string, normalizedNumber: string): string {
  const canonicalInput = `${citizenshipType}:${countryCode}:${normalizedNumber}`;
  return crypto.createHmac("sha256", identityHashSubKey).update(canonicalInput).digest("hex");
}
