import { describe, expect, it } from "vitest";
import { computeShipping } from "../../src/lib/shipping";

/**
 * §3.3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — kargo hesabı. Eşik
 * sınır testleri: 1 kuruş altı / tam eşiğe eşit / eşiksiz / kargo hiç yapılandırılmamış.
 */
describe("computeShipping", () => {
  it("shippingFlatFeeCents null ise kargo hiç hesaplanmaz (configured: false)", () => {
    const result = computeShipping(100000, { shippingFlatFeeCents: null, freeShippingThresholdCents: 50000 });
    expect(result).toEqual({ configured: false, feeCents: 0, thresholdCents: null, remainingCents: null, isFree: false });
  });

  it("eşik null iken bedel HER ZAMAN uygulanır (subtotal ne olursa olsun)", () => {
    const result = computeShipping(1_000_000, { shippingFlatFeeCents: 1500, freeShippingThresholdCents: null });
    expect(result).toEqual({ configured: true, feeCents: 1500, thresholdCents: null, remainingCents: null, isFree: false });
  });

  it("eşiğin 1 kuruş altında: bedel uygulanır, remainingCents 1'dir", () => {
    const result = computeShipping(4999, { shippingFlatFeeCents: 1000, freeShippingThresholdCents: 5000 });
    expect(result).toEqual({ configured: true, feeCents: 1000, thresholdCents: 5000, remainingCents: 1, isFree: false });
  });

  it("eşiğe TAM EŞİT: bedel 0'a düşer (>= karşılaştırması, EŞİT dahil)", () => {
    const result = computeShipping(5000, { shippingFlatFeeCents: 1000, freeShippingThresholdCents: 5000 });
    expect(result).toEqual({ configured: true, feeCents: 0, thresholdCents: 5000, remainingCents: 0, isFree: true });
  });

  it("eşiğin üstünde: bedel 0, remainingCents negatife değil 0'a KIRPILIR", () => {
    const result = computeShipping(7500, { shippingFlatFeeCents: 1000, freeShippingThresholdCents: 5000 });
    expect(result).toEqual({ configured: true, feeCents: 0, thresholdCents: 5000, remainingCents: 0, isFree: true });
  });

  it("subtotal 0 ve eşik doluyken: tam bedel uygulanır, remainingCents eşiğin tamamıdır", () => {
    const result = computeShipping(0, { shippingFlatFeeCents: 2000, freeShippingThresholdCents: 30000 });
    expect(result).toEqual({ configured: true, feeCents: 2000, thresholdCents: 30000, remainingCents: 30000, isFree: false });
  });
});
