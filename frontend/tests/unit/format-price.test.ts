import { describe, expect, it } from "vitest";
import { formatPriceFromCents } from "@/lib/format-price";

describe("formatPriceFromCents", () => {
  it("kuruş cinsinden fiyatı TL gösterimine çevirir", () => {
    expect(formatPriceFromCents(150000, "TRY")).toBe("₺1.500,00");
  });

  it("0 kuruşu doğru biçimlendirir", () => {
    expect(formatPriceFromCents(0, "TRY")).toBe("₺0,00");
  });

  it("başka bir para birimi (USD) ile de çalışır", () => {
    expect(formatPriceFromCents(999, "USD")).toBe("$9,99");
  });
});
