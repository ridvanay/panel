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

  it("opsiyonel `locale` verilmezse varsayılan `tr-TR` KORUNUR (geriye dönük uyumluluk)", () => {
    expect(formatPriceFromCents(150000, "USD")).toBe(formatPriceFromCents(150000, "USD", "tr-TR"));
  });

  it("`locale` verildiğinde para birimi SEMBOLÜ değil YERELLEŞTİRME değişir (currency her zaman `currency` parametresinden gelir)", () => {
    // `en-US` locale + `TRY` currency → kod öneki + tutar arasına `Intl` NBSP (U+00A0) koyar,
    // düz boşluk DEĞİL — bu yüzden tam eşitlik yerine ondalık/binlik ayraçların TERS döndüğünü
    // (`,`→binlik, `.`→ondalık) doğrulayan bir regex kullanılır.
    expect(formatPriceFromCents(150000, "TRY", "en-US")).toMatch(/^TRY\s1,500\.00$/);
  });

  it("bir doktorun para birimiyle farklı bir locale kombinasyonu (GBP, en-US) doğru biçimlenir", () => {
    expect(formatPriceFromCents(500000, "GBP", "en-US")).toBe("£5,000.00");
  });
});
