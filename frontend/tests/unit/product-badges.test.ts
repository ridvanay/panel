import { describe, expect, it } from "vitest";
import { BESTSELLER_BADGE_THRESHOLD, NEW_BADGE_MAX_AGE_DAYS, isBestsellerProduct, isNewProduct } from "@/lib/product-badges";

const NOW = new Date("2026-09-04T00:00:00.000Z");

describe("isNewProduct", () => {
  it("publishedAt null iken false döner", () => {
    expect(isNewProduct(null, NOW)).toBe(false);
  });

  it(`publishedAt tam olarak eşik gün önce ise true döner (≤${NEW_BADGE_MAX_AGE_DAYS} gün dahil)`, () => {
    const boundary = new Date(NOW.getTime() - NEW_BADGE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(isNewProduct(boundary, NOW)).toBe(true);
  });

  it("eşiği 1 gün aşan publishedAt için false döner", () => {
    const past = new Date(NOW.getTime() - (NEW_BADGE_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(isNewProduct(past, NOW)).toBe(false);
  });

  it("geçersiz tarih string'i için false döner (çökme YOK)", () => {
    expect(isNewProduct("not-a-date", NOW)).toBe(false);
  });
});

describe("isBestsellerProduct", () => {
  it(`salesCount eşiğin (${BESTSELLER_BADGE_THRESHOLD}) ALTINDA false döner`, () => {
    expect(isBestsellerProduct(BESTSELLER_BADGE_THRESHOLD - 1)).toBe(false);
  });

  it("salesCount eşiğe EŞİT veya ÜSTÜNDE true döner", () => {
    expect(isBestsellerProduct(BESTSELLER_BADGE_THRESHOLD)).toBe(true);
    expect(isBestsellerProduct(BESTSELLER_BADGE_THRESHOLD + 100)).toBe(true);
  });
});
