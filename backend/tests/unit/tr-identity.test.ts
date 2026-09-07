import { describe, expect, it } from "vitest";
import { isValidTcKimlikNo, isValidTrPostalCode } from "../../src/lib/tr-identity";

describe("isValidTcKimlikNo", () => {
  it("accepts a checksum-valid TCKN (well-known dev/test value)", () => {
    expect(isValidTcKimlikNo("10000000146")).toBe(true);
  });

  it("rejects a TCKN whose last digit fails the checksum", () => {
    expect(isValidTcKimlikNo("10000000145")).toBe(false);
  });

  it("rejects a TCKN whose 10th digit fails the checksum", () => {
    expect(isValidTcKimlikNo("10000000156")).toBe(false);
  });

  it('rejects "00000000000" (all zeros — first digit 0)', () => {
    expect(isValidTcKimlikNo("00000000000")).toBe(false);
  });

  it("rejects an input starting with 0", () => {
    expect(isValidTcKimlikNo("01234567890")).toBe(false);
  });

  it("rejects a 10-digit input (too short)", () => {
    expect(isValidTcKimlikNo("1000000014")).toBe(false);
  });

  it("rejects a 12-digit input (too long)", () => {
    expect(isValidTcKimlikNo("100000001466")).toBe(false);
  });

  it("rejects an input containing letters", () => {
    expect(isValidTcKimlikNo("1000000014A")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidTcKimlikNo("")).toBe(false);
  });
});

describe("isValidTrPostalCode", () => {
  it("accepts a 5-digit postal code", () => {
    expect(isValidTrPostalCode("34000")).toBe(true);
  });

  it("rejects a 4-digit postal code", () => {
    expect(isValidTrPostalCode("3400")).toBe(false);
  });

  it("rejects a 6-digit postal code", () => {
    expect(isValidTrPostalCode("340001")).toBe(false);
  });

  it("rejects a postal code containing letters", () => {
    expect(isValidTrPostalCode("3400A")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidTrPostalCode("")).toBe(false);
  });
});
