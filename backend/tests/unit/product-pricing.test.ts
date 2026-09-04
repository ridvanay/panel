import { describe, expect, it } from "vitest";
import { derivePriceColumns, resolveEffectivePrice, resolveUnitPriceCents } from "../../src/lib/product-pricing";

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

/**
 * §2.3/§2.4 (.claude/architect-scope-products-catalog.md, bağlayıcı) — katalog sıralama/
 * filtreleme kolonlarının TEK üretim noktası: `effectivePriceCents = discountPriceCents ??
 * priceCents`, `discountPercent = round((1 - discountPriceCents/priceCents) * 100)` (indirim
 * yoksa veya `priceCents <= 0` ise `0`).
 */
describe("derivePriceColumns", () => {
  it("indirim yoksa (null) effectivePriceCents = priceCents, discountPercent = 0", () => {
    expect(derivePriceColumns({ priceCents: 10000, discountPriceCents: null })).toEqual({
      effectivePriceCents: 10000,
      discountPercent: 0,
    });
  });

  it("indirim varsa effectivePriceCents = discountPriceCents, discountPercent hesaplanır", () => {
    expect(derivePriceColumns({ priceCents: 10000, discountPriceCents: 8000 })).toEqual({
      effectivePriceCents: 8000,
      discountPercent: 20,
    });
  });

  it("yüzde tam sayıya YUVARLANIR (round)", () => {
    // 1 - 6999/10000 = 0.3001 -> %30.01 -> round -> %30
    expect(derivePriceColumns({ priceCents: 10000, discountPriceCents: 6999 })).toEqual({
      effectivePriceCents: 6999,
      discountPercent: 30,
    });
    // 1 - 6666/10000 = 0.3334 -> %33.34 -> round -> %33
    expect(derivePriceColumns({ priceCents: 10000, discountPriceCents: 6666 })).toEqual({
      effectivePriceCents: 6666,
      discountPercent: 33,
    });
  });

  it("priceCents <= 0 kenar durumunda discountPercent HER ZAMAN 0 döner (bölme hatası YOK)", () => {
    expect(derivePriceColumns({ priceCents: 0, discountPriceCents: 0 })).toEqual({
      effectivePriceCents: 0,
      discountPercent: 0,
    });
    expect(derivePriceColumns({ priceCents: -100, discountPriceCents: -50 })).toEqual({
      effectivePriceCents: -50,
      discountPercent: 0,
    });
  });

  it("indirim priceCents'e çok yakınsa discountPercent 0'a yakın (ama sıfır değil) döner", () => {
    expect(derivePriceColumns({ priceCents: 10000, discountPriceCents: 9999 })).toEqual({
      effectivePriceCents: 9999,
      discountPercent: 0, // round(0.01 * 100) = round(0.99...) hayır: (1-9999/10000)=0.0001 -> %0.01 -> round -> 0
    });
  });
});
