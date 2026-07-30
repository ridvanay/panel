import { describe, expect, it } from "vitest";
import { slugify, slugWithSuffix } from "../../src/lib/slug";

describe("slugify", () => {
  it("lowercases and dasherizes spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips combining-mark diacritics (ü, ç, ğ)", () => {
    // Not: Türkçe noktasız "ı" NFKD ile ayrışmaz (bileşik değil, bağımsız bir harf) —
    // bu yüzden "ı" [a-z0-9] dışı kabul edilip ayraca dönüşür. Bu mevcut/bilinen davranış.
    expect(slugify("Türkçe Karakterler Şık Öğe")).toBe("turkce-karakterler-s-k-oge");
  });

  it("collapses repeated separators and trims leading/trailing dashes", () => {
    expect(slugify("  --Hello!!  World--  ")).toBe("hello-world");
  });

  it("truncates to 48 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long)).toHaveLength(48);
  });

  it("falls back to 'org' when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("org");
    expect(slugify("")).toBe("org");
  });
});

describe("slugWithSuffix", () => {
  it("appends a random 6-char hex suffix to the slugified base", () => {
    const result = slugWithSuffix("My Org");
    expect(result).toMatch(/^my-org-[0-9a-f]{6}$/);
  });

  it("produces different suffixes on repeated calls", () => {
    const a = slugWithSuffix("Same Name");
    const b = slugWithSuffix("Same Name");
    expect(a).not.toBe(b);
  });
});
