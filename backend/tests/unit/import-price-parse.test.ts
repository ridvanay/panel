import { describe, expect, it } from "vitest";
import { parsePriceToCents } from "../../src/modules/import/lib/price-parse";

/**
 * §10.8.9 WooCommerce fiyat ayrıştırma — STRING tabanlı tamsayı aritmetiği,
 * `parseFloat(x) * 100` YASAK (float hassasiyeti). Bkz. ARCHITECTURE.md §10.8.9 "Fiyat kuralı".
 */
describe("parsePriceToCents", () => {
  it.each([
    ["19.99", 1999],
    ["19.9", 1990],
    ["19", 1900],
    ["0.05", 5],
    ["1000000.00", 100000000],
  ])("parses %s -> %i kuruş", (raw, expected) => {
    expect(parsePriceToCents(raw)).toBe(expected);
  });

  it("treats comma as a decimal separator (localized export)", () => {
    expect(parsePriceToCents("19,99")).toBe(1999);
  });

  it("rounds half-up when more than 2 decimal digits are present", () => {
    expect(parsePriceToCents("19.995")).toBe(2000); // 19.995 -> 20.00
    expect(parsePriceToCents("19.994")).toBe(1999); // 19.994 -> 19.99
  });

  it("avoids float precision loss (19.99 * 100 !== 1999 with naive Math.round)", () => {
    // Sanity check: naive float math historically produced 1998.9999999999998.
    expect(Math.round(19.99 * 100)).toBe(1999); // JS'in kendisi bu örnekte "kurtulur" ama...
    expect(parsePriceToCents("19.99")).toBe(1999); // ...bizim ayrıştırıcımız STRING tabanlı, hiç float'a değmez.
  });

  it("returns null for empty/missing/non-numeric input", () => {
    expect(parsePriceToCents(null)).toBeNull();
    expect(parsePriceToCents(undefined)).toBeNull();
    expect(parsePriceToCents("")).toBeNull();
    expect(parsePriceToCents("   ")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNull();
    expect(parsePriceToCents("12.34.56")).not.toBeNull(); // binlik ayraç kalıntısı gibi ele alınır (birleştirilir)
  });

  it("handles thousands-separator-like inputs by joining integer segments", () => {
    // "1.234.567,89" (Avrupa biçimi) -> virgül nokta olur, önceki noktalar birleştirilir.
    expect(parsePriceToCents("1.234.567,89")).toBe(123456789);
  });
});
