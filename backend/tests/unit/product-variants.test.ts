import { describe, expect, it } from "vitest";
import {
  assertOptionValuesMatchAxes,
  assertVariantCountWithinLimit,
  buildVariantLabel,
  deriveOptionValueSlugs,
  deriveVariantKey,
  MAX_VARIANTS_PER_PRODUCT,
  ProductVariantOptionSchema,
  ProductVariantOptionsSchema,
} from "../../src/modules/products/lib/variants";
import { ValidationError } from "../../src/lib/errors";
import { ProductVariantOptionSchema as ResponseProductVariantOptionSchema } from "../../src/schemas/entities";

const AXES = [
  {
    name: "Renk",
    type: "SWATCH" as const,
    values: [
      { value: "Antrasit", swatchHex: "#333333" },
      { value: "Beyaz", swatchHex: "#ffffff" },
    ],
  },
  {
    name: "Beden",
    type: "TEXT" as const,
    values: [{ value: "L" }, { value: "S" }],
  },
];

describe("deriveVariantKey", () => {
  it("eksen adlarını slugify edip alfabetik sıralar (deterministik)", () => {
    expect(deriveVariantKey({ Renk: "Antrasit", Beden: "L" })).toBe("beden:l|renk:antrasit");
  });

  it("giriş sırası DEĞİŞSE bile aynı anahtarı üretir", () => {
    const a = deriveVariantKey({ Renk: "Antrasit", Beden: "L" });
    const b = deriveVariantKey({ Beden: "L", Renk: "Antrasit" });
    expect(a).toBe(b);
  });

  it("Türkçe karakterleri ve boşlukları slugify eder", () => {
    expect(deriveVariantKey({ Renk: "Kırmızı", "Ayak Numarası": "42" })).toBe("ayak-numarasi:42|renk:kirmizi");
  });

  it("farklı kombinasyonlar farklı anahtar üretir", () => {
    const key1 = deriveVariantKey({ Renk: "Antrasit", Beden: "L" });
    const key2 = deriveVariantKey({ Renk: "Beyaz", Beden: "S" });
    expect(key1).not.toBe(key2);
  });
});

/**
 * §2.2 (.claude/architect-scope-products-catalog.md, bağlayıcı) — `optionValueSlugs`, TAM OLARAK
 * `deriveVariantKey(optionValues).split("|")` olmalı; ikinci bir normalizasyon mantığı YOK.
 */
describe("deriveOptionValueSlugs ↔ deriveVariantKey tutarlılığı", () => {
  it("deriveVariantKey'in `|` ile ayrılmış hâlini üretir", () => {
    expect(deriveOptionValueSlugs({ Renk: "Antrasit", Beden: "L" })).toEqual(["beden:l", "renk:antrasit"]);
  });

  it("her zaman deriveVariantKey(optionValues).split(\"|\") ile BİREBİR aynıdır", () => {
    const optionValues = { Renk: "Kırmızı", "Ayak Numarası": "42" };
    expect(deriveOptionValueSlugs(optionValues)).toEqual(deriveVariantKey(optionValues).split("|"));
  });

  it("tek eksenli bir kombinasyonda tek elemanlı dizi döner", () => {
    expect(deriveOptionValueSlugs({ Ölçü: "120 cm" })).toEqual(["olcu:120-cm"]);
  });

  it("giriş sırası DEĞİŞSE bile aynı diziyi (alfabetik sıralı) üretir", () => {
    const a = deriveOptionValueSlugs({ Renk: "Antrasit", Beden: "L" });
    const b = deriveOptionValueSlugs({ Beden: "L", Renk: "Antrasit" });
    expect(a).toEqual(b);
  });
});

describe("assertOptionValuesMatchAxes", () => {
  it("geçerli bir kombinasyonda hata fırlatmaz", () => {
    expect(() => assertOptionValuesMatchAxes({ Renk: "Antrasit", Beden: "L" }, AXES)).not.toThrow();
  });

  it("eksik eksen varsa 422 ValidationError fırlatır", () => {
    expect(() => assertOptionValuesMatchAxes({ Renk: "Antrasit" }, AXES)).toThrow(ValidationError);
  });

  it("tanımsız (fazla) bir eksen varsa 422 ValidationError fırlatır", () => {
    expect(() => assertOptionValuesMatchAxes({ Renk: "Antrasit", Beden: "L", Malzeme: "Pamuk" }, AXES)).toThrow(ValidationError);
  });

  it("eksende tanımsız bir değer varsa 422 ValidationError fırlatır", () => {
    expect(() => assertOptionValuesMatchAxes({ Renk: "Mavi", Beden: "L" }, AXES)).toThrow(ValidationError);
  });

  it("hata detaylarında `optionValues` alanı doldurulur", () => {
    try {
      assertOptionValuesMatchAxes({ Renk: "Antrasit" }, AXES);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details?.optionValues?.length).toBeGreaterThan(0);
    }
  });
});

describe("buildVariantLabel", () => {
  it("eksen SIRASINA göre (alfabetik DEĞİL) \"değer / değer\" üretir", () => {
    // AXES sırası: Renk ÖNCE, Beden SONRA (tanım sırası) — alfabetik olsaydı Beden önce gelirdi.
    expect(buildVariantLabel({ Renk: "Antrasit", Beden: "L" }, AXES)).toBe("Antrasit / L");
  });

  it("eksik bir eksen değeri varsa onu atlar", () => {
    expect(buildVariantLabel({ Renk: "Antrasit" }, AXES)).toBe("Antrasit");
  });
});

describe("assertVariantCountWithinLimit", () => {
  it("limit altındaysa hata fırlatmaz", () => {
    expect(() => assertVariantCountWithinLimit(MAX_VARIANTS_PER_PRODUCT - 1)).not.toThrow();
  });

  it("limite ULAŞTIYSA (bir sonraki ekleme tavanı aşacaksa) 422 fırlatır", () => {
    expect(() => assertVariantCountWithinLimit(MAX_VARIANTS_PER_PRODUCT)).toThrow(ValidationError);
  });
});

describe("ProductVariantOptionSchema (SWATCH/TEXT swatchHex kuralları)", () => {
  it("SWATCH tipinde her değer için swatchHex ZORUNLUDUR", () => {
    const result = ProductVariantOptionSchema.safeParse({
      name: "Renk",
      type: "SWATCH",
      values: [{ value: "Antrasit" }],
    });
    expect(result.success).toBe(false);
  });

  it("TEXT tipinde swatchHex gönderilirse REDDEDİLİR", () => {
    const result = ProductVariantOptionSchema.safeParse({
      name: "Beden",
      type: "TEXT",
      values: [{ value: "L", swatchHex: "#ffffff" }],
    });
    expect(result.success).toBe(false);
  });

  it("aynı eksende tekrar eden değer REDDEDİLİR", () => {
    const result = ProductVariantOptionSchema.safeParse({
      name: "Beden",
      type: "TEXT",
      values: [{ value: "L" }, { value: "L" }],
    });
    expect(result.success).toBe(false);
  });

  it("geçerli SWATCH/TEXT eksenleri kabul edilir", () => {
    expect(ProductVariantOptionSchema.safeParse(AXES[0]).success).toBe(true);
    expect(ProductVariantOptionSchema.safeParse(AXES[1]).success).toBe(true);
  });
});

describe("ProductVariantOptionsSchema (ürün seviyesi tavanlar)", () => {
  it("en fazla 2 eksen kabul eder, 3. eksen REDDEDİLİR", () => {
    const result = ProductVariantOptionsSchema.safeParse([
      ...AXES,
      { name: "Malzeme", type: "TEXT", values: [{ value: "Pamuk" }] },
    ]);
    expect(result.success).toBe(false);
  });

  it("eksen adları benzersiz olmalıdır", () => {
    const result = ProductVariantOptionsSchema.safeParse([
      { name: "Renk", type: "TEXT", values: [{ value: "A" }] },
      { name: "Renk", type: "TEXT", values: [{ value: "B" }] },
    ]);
    expect(result.success).toBe(false);
  });

  it("eksen başına en fazla 12 değer kabul eder", () => {
    const values = Array.from({ length: 13 }, (_, i) => ({ value: `V${i}` }));
    const result = ProductVariantOptionsSchema.safeParse([{ name: "Beden", type: "TEXT", values }]);
    expect(result.success).toBe(false);
  });
});

/**
 * REGRESYON (qa-agent bulgusu) — YAZMA şeması (yukarıdaki `ProductVariantOptionSchema`,
 * `modules/products/lib/variants.ts`) `TEXT` eksenlerinde `swatchHex`'in HİÇ gönderilmemesine
 * izin verir (superRefine `TEXT` + `swatchHex` dolu ise REDDEDER, ama `swatchHex` YOKSA kabul
 * eder) — dolayısıyla DB'ye `{"value":"120 cm"}` gibi `swatchHex` alanı OLMAYAN bir obje yazılır
 * (bkz. `templates/ecommerce-pro.ts`'teki "Modüler Raf Sistemi" ürününün "Ölçü" ekseni, gerçek
 * tetikleyici veri). OKUMA şeması (`schemas/entities.ts::ProductVariantOptionSchema`) BU
 * durumu `.optional()` OLMADAN modelleseydi, `Product` DTO'sunu döndüren HER uç (`GET
 * /admin/products`, `GET /products`, `GET /products/{slug}`) response serialization'ında
 * `500 FST_ERR_RESPONSE_SERIALIZATION` ile KALICI olarak kırılırdı (o ürün var olduğu sürece —
 * admin panelinden düzeltme/silme dahi imkansız, çünkü liste ucu da 500 döner). Bu test iki
 * şemanın (yazma/okuma) UYUMLU kaldığını doğrudan doğrular: yazma şemasının ÜRETEBİLECEĞİ HER
 * şekil, okuma şemasından da GEÇMELİDİR.
 */
describe("REGRESYON — yazma şeması (variants.ts) ile okuma şeması (entities.ts) TEXT eksen swatchHex tutarlılığı", () => {
  it("TEXT ekseninde swatchHex'i hiç göndermeyen bir değer YAZMA şemasından geçer (mevcut davranış, DEĞİŞMEDİ)", () => {
    const writeResult = ProductVariantOptionSchema.safeParse({
      name: "Ölçü",
      type: "TEXT",
      values: [{ value: "120 cm" }, { value: "180 cm" }],
    });
    expect(writeResult.success).toBe(true);
  });

  it("YAZMA şemasının ürettiği (swatchHex alanı OLMAYAN) TEXT değer objesi OKUMA şemasından da geçer", () => {
    // Gerçek DB round-trip'i simüle eder: JSON.parse(JSON.stringify(...)) — Prisma Json
    // kolonundan okunan obje de swatchHex anahtarını TAŞIMAZ (yazılmadıysa serialize edilmez).
    const writeParsed = ProductVariantOptionSchema.parse({
      name: "Ölçü",
      type: "TEXT",
      values: [{ value: "120 cm" }, { value: "180 cm" }],
    });
    const roundTripped = JSON.parse(JSON.stringify(writeParsed));
    expect(roundTripped.values[0]).not.toHaveProperty("swatchHex");

    const readResult = ResponseProductVariantOptionSchema.safeParse(roundTripped);
    if (!readResult.success) {
      // Başarısız olursa hangi issue'nun patladığını görünür kılar (debug kolaylığı).
      expect(readResult.error.issues).toEqual([]);
    }
    expect(readResult.success).toBe(true);
  });

  it("SWATCH ekseninde swatchHex hâlâ ZORUNLU şekilde YAZMA şemasından geçmez (regresyon TEXT'e ÖZGÜ, SWATCH kuralı gevşetilmedi)", () => {
    const result = ProductVariantOptionSchema.safeParse({
      name: "Renk",
      type: "SWATCH",
      values: [{ value: "Antrasit" }],
    });
    expect(result.success).toBe(false);
  });

  it("OKUMA şeması SWATCH eksenlerinde dolu bir swatchHex'i de (mevcut davranış) aynen kabul eder", () => {
    const result = ResponseProductVariantOptionSchema.safeParse({
      name: "Renk",
      type: "SWATCH",
      values: [{ value: "Antrasit", swatchHex: "#333333" }],
    });
    expect(result.success).toBe(true);
  });
});
