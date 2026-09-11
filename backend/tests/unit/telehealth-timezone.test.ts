import { describe, expect, it } from "vitest";
import { getWallClockParts, wallTimeToUtc } from "../../src/modules/telehealth/lib/timezone";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.2/§9.4/§10 — DST tuzağı (bağlayıcı):
 * var olmayan duvar saati → slot ÜRETİLMEZ (null); çift geçen duvar saati → İLK (DST'li) örnek.
 * `America/New_York` 2024: ilkbahar geçişi 10 Mart (02:00 → 03:00), sonbahar geçişi 3 Kasım
 * (02:00 EDT → 01:00 EST).
 */
describe("modules/telehealth/lib/timezone", () => {
  describe("wallTimeToUtc — normal (DST'siz) dönüşüm", () => {
    it("Europe/Istanbul (UTC+3, DST YOK) — 09:00 yerel → 06:00 UTC", () => {
      const result = wallTimeToUtc({ year: 2024, month: 6, day: 10, hour: 9, minute: 0 }, "Europe/Istanbul");
      expect(result?.toISOString()).toBe("2024-06-10T06:00:00.000Z");
    });

    it("America/New_York yaz saati (EDT, UTC-4) — 09:00 yerel → 13:00 UTC", () => {
      const result = wallTimeToUtc({ year: 2024, month: 6, day: 10, hour: 9, minute: 0 }, "America/New_York");
      expect(result?.toISOString()).toBe("2024-06-10T13:00:00.000Z");
    });

    it("America/New_York kış saati (EST, UTC-5) — 09:00 yerel → 14:00 UTC", () => {
      const result = wallTimeToUtc({ year: 2024, month: 1, day: 10, hour: 9, minute: 0 }, "America/New_York");
      expect(result?.toISOString()).toBe("2024-01-10T14:00:00.000Z");
    });

    it("round-trip: üretilen anın duvar saati orijinal girdiyle eşleşir", () => {
      const wall = { year: 2024, month: 9, day: 2, hour: 14, minute: 45 };
      const instant = wallTimeToUtc(wall, "America/New_York");
      expect(instant).not.toBeNull();
      expect(getWallClockParts(instant!, "America/New_York")).toEqual(wall);
    });
  });

  describe("wallTimeToUtc — DST ilkbahar geçişi (var olmayan duvar saati)", () => {
    it("America/New_York 2024-03-10 02:30 (boşlukta) → null (slot üretilmemeli)", () => {
      const result = wallTimeToUtc({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 }, "America/New_York");
      expect(result).toBeNull();
    });

    it("geçişten HEMEN ÖNCEKİ (01:59) ve SONRAKİ (03:00) duvar saatleri GEÇERLİDİR", () => {
      const before = wallTimeToUtc({ year: 2024, month: 3, day: 10, hour: 1, minute: 59 }, "America/New_York");
      const after = wallTimeToUtc({ year: 2024, month: 3, day: 10, hour: 3, minute: 0 }, "America/New_York");
      expect(before?.toISOString()).toBe("2024-03-10T06:59:00.000Z");
      expect(after?.toISOString()).toBe("2024-03-10T07:00:00.000Z");
    });
  });

  describe("wallTimeToUtc — DST sonbahar geçişi (çift geçen duvar saati)", () => {
    it("America/New_York 2024-11-03 01:30 iki kez yaşanır — İLK (DST'li/EDT) örnek döner", () => {
      const result = wallTimeToUtc({ year: 2024, month: 11, day: 3, hour: 1, minute: 30 }, "America/New_York");
      // 05:30 UTC = 01:30 EDT (ilk/erken örnek) — 06:30 UTC (01:30 EST, ikinci örnek) DEĞİL.
      expect(result?.toISOString()).toBe("2024-11-03T05:30:00.000Z");
    });
  });

  describe("getWallClockParts", () => {
    it("bir anın verilen dilimdeki duvar saatini doğru döner", () => {
      const instant = new Date("2024-06-10T13:00:00.000Z");
      expect(getWallClockParts(instant, "America/New_York")).toEqual({ year: 2024, month: 6, day: 10, hour: 9, minute: 0 });
      expect(getWallClockParts(instant, "Europe/Istanbul")).toEqual({ year: 2024, month: 6, day: 10, hour: 16, minute: 0 });
    });
  });
});
