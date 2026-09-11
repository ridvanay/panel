import { describe, expect, it } from "vitest";
import {
  generateAvailableSlots,
  isBookableSlotStart,
  isoDayOfWeekFromJsDay,
  jsDayFromIsoDayOfWeek,
  parseIsoCalendarDate,
  SLOT_BOOKING_BUFFER_MS,
} from "../../src/modules/telehealth/lib/availability";

describe("modules/telehealth/lib/availability", () => {
  describe("ISO(1-7) ↔ JS(0-6) dayOfWeek dönüşümü", () => {
    it("Pazar sınırı: ISO 7 (Pazar) ↔ JS 0", () => {
      expect(jsDayFromIsoDayOfWeek(7)).toBe(0);
      expect(isoDayOfWeekFromJsDay(0)).toBe(7);
    });

    it("Pazartesi-Cumartesi (1-6) değişmeden eşlenir", () => {
      for (let day = 1; day <= 6; day++) {
        expect(jsDayFromIsoDayOfWeek(day)).toBe(day);
        expect(isoDayOfWeekFromJsDay(day)).toBe(day);
      }
    });

    it("round-trip: her ISO gün için jsDayFromIso→isoDayOfWeekFromJs orijinali verir", () => {
      for (let iso = 1; iso <= 7; iso++) {
        expect(isoDayOfWeekFromJsDay(jsDayFromIsoDayOfWeek(iso))).toBe(iso);
      }
    });
  });

  describe("parseIsoCalendarDate", () => {
    it("\"YYYY-MM-DD\" → {year,month,day}", () => {
      expect(parseIsoCalendarDate("2025-01-06")).toEqual({ year: 2025, month: 1, day: 6 });
    });
  });

  const FAR_PAST_NOW = new Date("2020-01-01T00:00:00Z"); // testlerde "şimdi"nin ASLA slotlarla çakışmaması için.

  describe("generateAvailableSlots — temel üretim", () => {
    it("Europe/Istanbul, Pazartesi 09:00-12:00, 60dk seans → 3 slot, doğru UTC anlar", () => {
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: true }],
        fromDate: { year: 2025, month: 1, day: 6 }, // Pazartesi
        toDate: { year: 2025, month: 1, day: 6 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });

      expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
        "2025-01-06T06:00:00.000Z", // 09:00 +3
        "2025-01-06T07:00:00.000Z",
        "2025-01-06T08:00:00.000Z",
      ]);
      expect(slots.every((s) => s.available)).toBe(true);
      expect(slots[0]!.endsAt.toISOString()).toBe("2025-01-06T07:00:00.000Z");
    });

    it("isActive:false kural HİÇ slot üretmez", () => {
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: false }],
        fromDate: { year: 2025, month: 1, day: 6 },
        toDate: { year: 2025, month: 1, day: 6 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });
      expect(slots).toEqual([]);
    });

    it("son slot tam pencereye sığmıyorsa üretilmez (30dk artık, 30dk seans tam sığar)", () => {
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 40,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }], // 09:00-10:00, 60dk pencere
        fromDate: { year: 2025, month: 1, day: 6 },
        toDate: { year: 2025, month: 1, day: 6 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });
      // 09:00-09:40 sığar, 09:40-10:20 pencereyi AŞAR → üretilmez. Tek slot beklenir.
      expect(slots).toHaveLength(1);
      expect(slots[0]!.startsAt.toISOString()).toBe("2025-01-06T06:00:00.000Z");
    });
  });

  describe("generateAvailableSlots — doktor dilimi ≠ sunucu dilimi (Node her zaman UTC varsayılır)", () => {
    it("America/New_York doktoru, 09:00-10:00 yerel → 13:00 UTC (EDT dönemi)", () => {
      const slots = generateAvailableSlots({
        timeZone: "America/New_York",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }],
        fromDate: { year: 2024, month: 6, day: 10 }, // Pazartesi, EDT
        toDate: { year: 2024, month: 6, day: 10 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });
      expect(slots.map((s) => s.startsAt.toISOString())).toEqual(["2024-06-10T13:00:00.000Z"]);
    });
  });

  describe("generateAvailableSlots — GÜN SINIRI (doktorun yerel takvim günü ile UTC günü FARKLI olabilir)", () => {
    it("Asia/Tokyo doktoru, Pazartesi 00:00-01:00 yerel kuralı → UTC'de PAZAR gününe düşen bir an üretir", () => {
      // 2025-01-06 doktorun (Tokyo) takviminde Pazartesi'dir (ISO dayOfWeek=1); o günün
      // 00:00 yerel saati UTC'de BİR ÖNCEKİ gün (Pazar, 2025-01-05 15:00 UTC)'e denk gelir.
      // Bu test, gün iterasyonunun DOKTORUN takvimine göre yapıldığını (UTC/sunucu gününe göre
      // DEĞİL) doğrular — aksi halde bu slot ya hiç üretilmez ya da yanlış ISO güne atanır.
      const slots = generateAvailableSlots({
        timeZone: "Asia/Tokyo",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 0, endMinute: 60, isActive: true }],
        fromDate: { year: 2025, month: 1, day: 6 },
        toDate: { year: 2025, month: 1, day: 6 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });
      expect(slots.map((s) => s.startsAt.toISOString())).toEqual(["2025-01-05T15:00:00.000Z"]);
    });
  });

  describe("generateAvailableSlots — DST (ilkbahar/sonbahar) entegrasyonu", () => {
    it("ilkbahar geçişi penceresine denk gelen slot ÜRETİLMEZ (America/New_York, 2024-03-10 02:00-03:00 boşlukta)", () => {
      const slots = generateAvailableSlots({
        timeZone: "America/New_York",
        sessionDurationMin: 30,
        rules: [{ dayOfWeek: 7, startMinute: 60, endMinute: 240, isActive: true }], // 2024-03-10 Pazar
        fromDate: { year: 2024, month: 3, day: 10 },
        toDate: { year: 2024, month: 3, day: 10 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });
      // 01:00-04:00 penceresinde 30dk'lık slotlar: 01:00,01:30(mevcut),02:00/02:30(BOŞLUKTA,
      // üretilmez),03:00,03:30 — boşluktakiler eksik olmalı, TOPLAM slot sayısı 6'dan AZ olmalı.
      const localHours = slots.map((s) => s.startsAt.toISOString());
      expect(localHours).not.toContain(undefined);
      expect(slots.length).toBeLessThan(6);
      expect(slots.length).toBeGreaterThan(0);
    });

    it("sonbahar geçişinde ÇİFT geçen duvar saati YALNIZCA BİR slot üretir", () => {
      const slots = generateAvailableSlots({
        timeZone: "America/New_York",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 7, startMinute: 60, endMinute: 120, isActive: true }], // 2024-11-03 Pazar, 01:00-02:00 yerel (ÇİFT yaşanır)
        fromDate: { year: 2024, month: 11, day: 3 },
        toDate: { year: 2024, month: 11, day: 3 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set(),
      });
      expect(slots).toHaveLength(1);
      expect(slots[0]!.startsAt.toISOString()).toBe("2024-11-03T05:00:00.000Z"); // İLK (DST'li/EDT) örnek.
    });
  });

  describe("generateAvailableSlots — rezervasyon tamponu + doluluk", () => {
    it("`now`'a göre 2 saatten YAKIN slotlar available:false döner", () => {
      const startsAt = new Date("2025-01-06T06:00:00.000Z"); // 09:00 Istanbul
      const now = new Date(startsAt.getTime() - SLOT_BOOKING_BUFFER_MS + 60_000); // tam tampon sınırının 1dk İÇİNDE
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }],
        fromDate: { year: 2025, month: 1, day: 6 },
        toDate: { year: 2025, month: 1, day: 6 },
        now,
        bookedStartTimesMs: new Set(),
      });
      expect(slots).toHaveLength(1);
      expect(slots[0]!.available).toBe(false);
    });

    it("tam tampon sınırındaki (2 saat sonrası) slot MÜSAİTTİR (>= karşılaştırması)", () => {
      const startsAt = new Date("2025-01-06T06:00:00.000Z");
      const now = new Date(startsAt.getTime() - SLOT_BOOKING_BUFFER_MS);
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }],
        fromDate: { year: 2025, month: 1, day: 6 },
        toDate: { year: 2025, month: 1, day: 6 },
        now,
        bookedStartTimesMs: new Set(),
      });
      expect(slots[0]!.available).toBe(true);
    });

    it("geçmişteki bir slot available:false döner", () => {
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }],
        fromDate: { year: 2020, month: 1, day: 6 }, // geçmiş bir Pazartesi
        toDate: { year: 2020, month: 1, day: 6 },
        now: new Date(), // "şimdi" bu tarihten çok sonra.
        bookedStartTimesMs: new Set(),
      });
      expect(slots[0]!.available).toBe(false);
    });

    it("`bookedStartTimesMs` içindeki bir an available:false döner", () => {
      const startsAt = new Date("2025-01-06T06:00:00.000Z");
      const slots = generateAvailableSlots({
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 60,
        rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }],
        fromDate: { year: 2025, month: 1, day: 6 },
        toDate: { year: 2025, month: 1, day: 6 },
        now: FAR_PAST_NOW,
        bookedStartTimesMs: new Set([startsAt.getTime()]),
      });
      expect(slots[0]!.available).toBe(false);
    });
  });

  describe("isBookableSlotStart", () => {
    const params = {
      timeZone: "Europe/Istanbul",
      sessionDurationMin: 60,
      rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600, isActive: true }],
      now: FAR_PAST_NOW,
    };

    it("gerçek bir slot başlangıcı için true döner", () => {
      expect(isBookableSlotStart(new Date("2025-01-06T06:00:00.000Z"), params)).toBe(true);
    });

    it("1 dakika kaymış bir an için false döner (yapısal olarak slot DEĞİL)", () => {
      expect(isBookableSlotStart(new Date("2025-01-06T06:01:00.000Z"), params)).toBe(false);
    });

    it("var olmayan bir haftanın günü/dışı saat için false döner", () => {
      expect(isBookableSlotStart(new Date("2025-01-07T06:00:00.000Z"), params)).toBe(false); // Salı, kural yok.
    });

    it("tampon içindeki (çok yakın) bir slot için false döner", () => {
      const startsAt = new Date("2025-01-06T06:00:00.000Z");
      expect(isBookableSlotStart(startsAt, { ...params, now: new Date(startsAt.getTime() - 60_000) })).toBe(false);
    });
  });
});
