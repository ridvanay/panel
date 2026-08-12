import { describe, expect, it } from "vitest";
import { contrastRatio, meetsWcagAa, WCAG_AA_CONTRAST_THRESHOLD } from "@/lib/site-settings/contrast";

describe("contrastRatio", () => {
  it("siyah/beyaz için maksimum orana (21:1) yakın bir değer döner", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(21, 0);
  });

  it("aynı renk için oran 1'dir", () => {
    expect(contrastRatio("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });

  it("sıra önemli değildir (simetrik)", () => {
    const a = contrastRatio("#111827", "#ffffff");
    const b = contrastRatio("#ffffff", "#111827");
    expect(a).toBeCloseTo(b!, 10);
  });

  it("geçersiz hex girdisinde null döner", () => {
    expect(contrastRatio("kırmızı", "#ffffff")).toBeNull();
    expect(contrastRatio("#fff", "#ffffff")).toBeNull();
  });
});

describe("meetsWcagAa", () => {
  it("eşik 4.5:1'dir — beyaz üzerine indigo (#4f46e5) AA'yı GEÇER", () => {
    expect(WCAG_AA_CONTRAST_THRESHOLD).toBe(4.5);
    expect(meetsWcagAa("#4f46e5", "#ffffff")).toBe(true);
  });

  it("düşük kontrastlı bir çift (açık gri / beyaz) AA'yı GEÇEMEZ", () => {
    expect(meetsWcagAa("#e5e7eb", "#ffffff")).toBe(false);
  });
});
