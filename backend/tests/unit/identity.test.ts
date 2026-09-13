import { describe, expect, it } from "vitest";
import {
  isValidTurkishIdentityNumber,
  isValidPassportNumber,
  normalizeIdentityNumber,
  maskIdentityNumber,
  hashIdentityNumber,
  encryptIdentityNumber,
  decryptIdentityNumber,
  parseIdentityBirthDate,
  serializeIdentityBirthDate,
  assertIdentityNotMinor,
  validateBookingIdentityInput,
} from "../../src/lib/identity";
import { ValidationError, IdentityMinorNotSupportedError } from "../../src/lib/errors";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §6 madde 2 —
 * TCKN algoritması (geçerli/geçersiz/repdigit), maskeleme, HMAC determinizmi, 18 yaş sınırı,
 * `@db.Date` gidiş-dönüşü birim testleri.
 */

describe("isValidTurkishIdentityNumber", () => {
  it("accepts a checksum-valid TCKN (well-known dev/test value, tr-identity.test.ts ile AYNI)", () => {
    expect(isValidTurkishIdentityNumber("10000000146")).toBe(true);
  });

  it("rejects a TCKN whose last digit fails the checksum", () => {
    expect(isValidTurkishIdentityNumber("10000000145")).toBe(false);
  });

  it("rejects a TCKN whose 10th digit fails the checksum", () => {
    expect(isValidTurkishIdentityNumber("10000000156")).toBe(false);
  });

  it("rejects an input starting with 0", () => {
    expect(isValidTurkishIdentityNumber("01234567890")).toBe(false);
  });

  it("rejects a 10-digit input (too short)", () => {
    expect(isValidTurkishIdentityNumber("1000000014")).toBe(false);
  });

  it("rejects a 12-digit input (too long)", () => {
    expect(isValidTurkishIdentityNumber("100000001466")).toBe(false);
  });

  it("rejects an input containing letters", () => {
    expect(isValidTurkishIdentityNumber("1000000014A")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidTurkishIdentityNumber("")).toBe(false);
  });

  // [DPI] §2.4 madde 4 — repdigit reddi (`lib/tr-identity.ts`'in EKSİK olduğu, bu dosyanın
  // BİLİNÇLİ olarak EKLEDİĞİ kural).
  it('rejects a repdigit that would otherwise pass the checksum ("11111111110")', () => {
    // 11111111110: d1..d9 hepsi 1 → oddSum=5, evenSum=4 → d10=((5*7-4)%10+10)%10=(31%10)=1 ✓;
    // firstTenSum=1*10=10 → d11=10%10=0 ✓ — algoritmayı GEÇER ama repdigit olduğu için REDDEDİLİR.
    expect(isValidTurkishIdentityNumber("11111111110")).toBe(false);
  });

  it('rejects "00000000000" (all zeros — first digit 0, ayrıca repdigit)', () => {
    expect(isValidTurkishIdentityNumber("00000000000")).toBe(false);
  });
});

describe("isValidPassportNumber", () => {
  it("accepts a 6-20 char alphanumeric uppercase value", () => {
    expect(isValidPassportNumber("AB123456")).toBe(true);
  });

  it("rejects a value shorter than 6 characters", () => {
    expect(isValidPassportNumber("AB123")).toBe(false);
  });

  it("rejects a value longer than 20 characters", () => {
    expect(isValidPassportNumber("A".repeat(21))).toBe(false);
  });

  it("rejects lowercase input (normalize edilmemiş)", () => {
    expect(isValidPassportNumber("ab123456")).toBe(false);
  });
});

describe("normalizeIdentityNumber", () => {
  it("strips spaces/hyphens for TR and preserves digit case", () => {
    expect(normalizeIdentityNumber("TR", "100 000-00146")).toBe("10000000146");
  });

  it("strips spaces/hyphens and uppercases for FOREIGN", () => {
    expect(normalizeIdentityNumber("FOREIGN", "ab 123-456")).toBe("AB123456");
  });
});

describe("maskIdentityNumber", () => {
  it("masks a TR TCKN as first3 + 6 stars + last2", () => {
    expect(maskIdentityNumber("TR", "10000000146")).toBe("100******46");
  });

  it("masks a FOREIGN passport as first2 + stars + last2, at most 5 real chars visible", () => {
    const masked = maskIdentityNumber("FOREIGN", "AB123456");
    expect(masked).toBe("AB****56");
    // en fazla 5 gerçek karakter açığa çıkar (2 + 2 = 4 ≤ 5 burada).
    const realChars = masked.replace(/\*/g, "");
    expect(realChars.length).toBeLessThanOrEqual(5);
  });

  it("fully masks a FOREIGN value shorter than 6 characters", () => {
    expect(maskIdentityNumber("FOREIGN", "AB12")).toBe("****");
  });
});

describe("hashIdentityNumber — HMAC determinizmi", () => {
  it("is deterministic for the same canonical input", () => {
    const a = hashIdentityNumber("TR", "TR", "10000000146");
    const b = hashIdentityNumber("TR", "TR", "10000000146");
    expect(a).toBe(b);
  });

  it("produces a different hash for a different number (domain separation still consistent)", () => {
    const a = hashIdentityNumber("TR", "TR", "10000000146");
    const b = hashIdentityNumber("TR", "TR", "10000000147");
    expect(a).not.toBe(b);
  });

  it("produces a 64-char hex digest (SHA-256)", () => {
    const hash = hashIdentityNumber("FOREIGN", "DE", "AB123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sensitive to citizenshipType/countryCode (kanonik girdiye dahil)", () => {
    const a = hashIdentityNumber("TR", "TR", "10000000146");
    const b = hashIdentityNumber("FOREIGN", "DE", "10000000146");
    expect(a).not.toBe(b);
  });
});

describe("encryptIdentityNumber / decryptIdentityNumber", () => {
  it("round-trips a value through lib/crypto.ts::encryptSecret/decryptSecret", () => {
    const ciphertext = encryptIdentityNumber("10000000146");
    expect(ciphertext).not.toBe("10000000146");
    expect(decryptIdentityNumber(ciphertext)).toBe("10000000146");
  });
});

describe("parseIdentityBirthDate / serializeIdentityBirthDate — @db.Date gidiş-dönüşü", () => {
  it("parses a valid YYYY-MM-DD as UTC midnight and round-trips via serialize", () => {
    const parsed = parseIdentityBirthDate("1990-05-20");
    expect(parsed.toISOString()).toBe("1990-05-20T00:00:00.000Z");
    expect(serializeIdentityBirthDate(parsed)).toBe("1990-05-20");
  });

  it("rejects a malformed date string", () => {
    expect(() => parseIdentityBirthDate("20-05-1990")).toThrow(ValidationError);
  });

  it("rejects a calendar-overflow date (ör. 2024-02-30) instead of silently normalizing it", () => {
    expect(() => parseIdentityBirthDate("2024-02-30")).toThrow(ValidationError);
  });

  it("rejects a future date", () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(() => parseIdentityBirthDate(future)).toThrow(ValidationError);
  });

  it("rejects an age over 120 years", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(() => parseIdentityBirthDate("1900-01-01", now)).toThrow(ValidationError);
  });

  it("does not leak the submitted value into the error message/details", () => {
    try {
      parseIdentityBirthDate("not-a-date");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const validationError = err as ValidationError;
      expect(validationError.message).not.toContain("not-a-date");
      expect(JSON.stringify(validationError.details ?? {})).not.toContain("not-a-date");
    }
  });
});

describe("assertIdentityNotMinor — 18 yaş sınırı", () => {
  const now = new Date("2026-09-13T00:00:00.000Z");

  it("accepts an exactly-18-year-old (doğum günü bugün)", () => {
    expect(() => assertIdentityNotMinor(new Date("2008-09-13T00:00:00.000Z"), now)).not.toThrow();
  });

  it("rejects someone who turns 18 tomorrow (still 17 today)", () => {
    expect(() => assertIdentityNotMinor(new Date("2008-09-14T00:00:00.000Z"), now)).toThrow(IdentityMinorNotSupportedError);
  });

  it("rejects a clearly underage birth date", () => {
    expect(() => assertIdentityNotMinor(new Date("2015-01-01T00:00:00.000Z"), now)).toThrow(IdentityMinorNotSupportedError);
  });

  it("accepts a clearly adult birth date", () => {
    expect(() => assertIdentityNotMinor(new Date("1990-01-01T00:00:00.000Z"), now)).not.toThrow();
  });
});

describe("validateBookingIdentityInput — orkestrasyon", () => {
  const now = new Date("2026-09-13T00:00:00.000Z");

  it("validates a well-formed TR identity", () => {
    const result = validateBookingIdentityInput(
      { citizenshipType: "TR", identityNumber: "10000000146", birthDate: "1990-01-01" },
      now
    );
    expect(result.citizenshipType).toBe("TR");
    expect(result.countryCode).toBe("TR");
    expect(result.normalizedNumber).toBe("10000000146");
  });

  it("rejects a TR identity with an invalid checksum", () => {
    expect(() =>
      validateBookingIdentityInput({ citizenshipType: "TR", identityNumber: "10000000145", birthDate: "1990-01-01" }, now)
    ).toThrow(ValidationError);
  });

  it("rejects a TR identity whose countryCode is not TR", () => {
    expect(() =>
      validateBookingIdentityInput(
        { citizenshipType: "TR", identityNumber: "10000000146", countryCode: "DE", birthDate: "1990-01-01" },
        now
      )
    ).toThrow(ValidationError);
  });

  it("validates a well-formed FOREIGN identity with a non-TR country code", () => {
    const result = validateBookingIdentityInput(
      { citizenshipType: "FOREIGN", identityNumber: "ab123456", countryCode: "de", birthDate: "1990-01-01" },
      now
    );
    expect(result.citizenshipType).toBe("FOREIGN");
    expect(result.countryCode).toBe("DE");
    expect(result.normalizedNumber).toBe("AB123456");
  });

  it("rejects a FOREIGN identity whose countryCode is TR", () => {
    expect(() =>
      validateBookingIdentityInput(
        { citizenshipType: "FOREIGN", identityNumber: "AB123456", countryCode: "TR", birthDate: "1990-01-01" },
        now
      )
    ).toThrow(ValidationError);
  });

  it("rejects a FOREIGN identity missing a countryCode", () => {
    expect(() =>
      validateBookingIdentityInput({ citizenshipType: "FOREIGN", identityNumber: "AB123456", birthDate: "1990-01-01" }, now)
    ).toThrow(ValidationError);
  });

  it("rejects an underage applicant with IdentityMinorNotSupportedError (not a generic ValidationError)", () => {
    expect(() =>
      validateBookingIdentityInput({ citizenshipType: "TR", identityNumber: "10000000146", birthDate: "2015-01-01" }, now)
    ).toThrow(IdentityMinorNotSupportedError);
  });
});
