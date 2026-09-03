import { describe, expect, it } from "vitest";
import { resolveEffectivePrice, resolveUnitPriceCents } from "../../src/lib/product-pricing";

/**
 * §1.5 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — fiyat çözümleme matrisi:
 * `variant.priceCents`: null = MİRAS, dolu = MUTLAK (delta DEĞİL). `discountPriceCents` AYNI
 * mantıkla ama BAĞIMSIZ çözülür.
 */
describe("resolveEffectivePrice", () => {
  const product = { priceCents: 10000, discountPriceCents: 8000 };

  it("variant yoksa (null) ürünün fiyat çiftini aynen döner", () => {
    expect(resolveEffectivePrice(product, null)).toEqual({ priceCents: 10000, discountPriceCents: 8000 });
  });

  it("variant.priceCents null ise ürünün priceCents'i MİRAS ALINIR", () => {
    const variant = { priceCents: null, discountPriceCents: null };
    expect(resolveEffectivePrice(product, variant)).toEqual({ priceCents: 10000, discountPriceCents: 8000 });
  });

  it("variant.priceCents doluysa MUTLAK fiyattır (ürünün fiyatı YOK SAYILIR, delta DEĞİL)", () => {
    const variant = { priceCents: 15000, discountPriceCents: null };
    // discountPriceCents variant'ta null → üründen miras alınır (BAĞIMSIZ çözülür).
    expect(resolveEffectivePrice(product, variant)).toEqual({ priceCents: 15000, discountPriceCents: 8000 });
  });

  it("variant kendi discountPriceCents'ine sahipse o kullanılır (priceCents miras alınsa bile)", () => {
    const variant = { priceCents: null, discountPriceCents: 7000 };
    expect(resolveEffectivePrice(product, variant)).toEqual({ priceCents: 10000, discountPriceCents: 7000 });
  });

  it("variant hem priceCents hem discountPriceCents'i override edebilir (ikisi BAĞIMSIZ)", () => {
    const variant = { priceCents: 20000, discountPriceCents: 17500 };
    expect(resolveEffectivePrice(product, variant)).toEqual({ priceCents: 20000, discountPriceCents: 17500 });
  });

  it("ürünün discountPriceCents'i yoksa (null) ve variant de override etmiyorsa null kalır", () => {
    const productNoDiscount = { priceCents: 10000, discountPriceCents: null };
    const variant = { priceCents: 12000, discountPriceCents: null };
    expect(resolveEffectivePrice(productNoDiscount, variant)).toEqual({ priceCents: 12000, discountPriceCents: null });
  });
});

describe("resolveUnitPriceCents", () => {
  const product = { priceCents: 10000, discountPriceCents: 8000 };

  it("indirim varsa (miras ya da mutlak) indirim fiyatını döner", () => {
    expect(resolveUnitPriceCents(product, null)).toBe(8000);
  });

  it("indirim yoksa liste fiyatını döner", () => {
    const productNoDiscount = { priceCents: 10000, discountPriceCents: null };
    expect(resolveUnitPriceCents(productNoDiscount, null)).toBe(10000);
  });

  it("variant mutlak fiyat + kendi indirimiyle satılacak tek sayıyı üretir", () => {
    const variant = { priceCents: 15000, discountPriceCents: 12000 };
    expect(resolveUnitPriceCents(product, variant)).toBe(12000);
  });

  it("variant fiyatı miras alır ama kendi indirimini uygular", () => {
    const variant = { priceCents: null, discountPriceCents: 6000 };
    expect(resolveUnitPriceCents(product, variant)).toBe(6000);
  });

  it("variant mutlak fiyatlıdır (15000) ama kendi indirimi yoktur → ürünün indirimi (8000) MİRAS ALINIR", () => {
    // Not: discountPriceCents BAĞIMSIZ çözülür — variant kendi discountPriceCents'ini
    // belirtmemişse (null) ürünün discountPriceCents'i miras alınır ve nihai satılan fiyatı
    // (indirim > liste fiyatı önceliği) belirler; variant'ın mutlak priceCents'i (15000) bu
    // durumda satılan fiyata YANSIMAZ — bu, §1.5'teki "delta değil, bağımsız" kuralının
    // kritik/şaşırtıcı sonucudur.
    const variant = { priceCents: 15000, discountPriceCents: null };
    expect(resolveUnitPriceCents(product, variant)).toBe(8000);
  });
});
