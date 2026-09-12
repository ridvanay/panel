import { describe, expect, it } from "vitest";
import {
  generateBookingNumber,
  generateMeetingRoomName,
  getBookingJoinWindow,
  isWithinJoinWindow,
  JOIN_WINDOW_AFTER_END_MS,
  JOIN_WINDOW_BEFORE_START_MS,
  MAX_BOOKING_SLOTS,
} from "../../src/modules/telehealth/lib/booking";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.5/§9.7.6 — SAF katılım penceresi
 * yardımcısı. Bu modülün uçları BU fonksiyonu KULLANMAZ (integration-agent'ın `meeting-token`
 * ucu kullanır) — ama backend-agent yazar ve test eder (bkz. görev notu madde 5/8).
 * [TCT] §9.7.6 madde 1 (TADİLAT) — pencere başlangıcı `startsAt - 5dk` → `startsAt - 10dk`.
 */
describe("modules/telehealth/lib/booking", () => {
  describe("isWithinJoinWindow", () => {
    const startsAt = new Date("2025-01-06T09:00:00.000Z");
    const endsAt = new Date("2025-01-06T09:30:00.000Z");

    it("randevu başlamadan tam 10 dk önce (dahil) TRUE döner", () => {
      const now = new Date(startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS);
      expect(isWithinJoinWindow(now, startsAt, endsAt)).toBe(true);
    });

    it("randevu başlamadan 10 dk 1 saniye önce FALSE döner", () => {
      const now = new Date(startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS - 1000);
      expect(isWithinJoinWindow(now, startsAt, endsAt)).toBe(false);
    });

    it("randevu bitişinden tam 15 dk sonra (dahil) TRUE döner", () => {
      const now = new Date(endsAt.getTime() + JOIN_WINDOW_AFTER_END_MS);
      expect(isWithinJoinWindow(now, startsAt, endsAt)).toBe(true);
    });

    it("randevu bitişinden 15 dk 1 saniye sonra FALSE döner", () => {
      const now = new Date(endsAt.getTime() + JOIN_WINDOW_AFTER_END_MS + 1000);
      expect(isWithinJoinWindow(now, startsAt, endsAt)).toBe(false);
    });

    it("randevu ORTASINDA TRUE döner", () => {
      const now = new Date(startsAt.getTime() + 5 * 60 * 1000);
      expect(isWithinJoinWindow(now, startsAt, endsAt)).toBe(true);
    });
  });

  describe("generateMeetingRoomName", () => {
    it("\"room_\" + 32 hex karakter üretir, TAHMİN EDİLEMEZ (her çağrıda farklı)", () => {
      const a = generateMeetingRoomName();
      const b = generateMeetingRoomName();
      expect(a).toMatch(/^room_[0-9a-f]{32}$/);
      expect(b).toMatch(/^room_[0-9a-f]{32}$/);
      expect(a).not.toBe(b);
    });
  });

  describe("generateBookingNumber", () => {
    it("\"BKG-\" ön ekiyle başlar ve her çağrıda benzersizdir", () => {
      const a = generateBookingNumber();
      const b = generateBookingNumber();
      expect(a).toMatch(/^BKG-[0-9A-Z]+-[0-9A-F]{4}$/);
      expect(a).not.toBe(b);
    });
  });

  describe("MAX_BOOKING_SLOTS", () => {
    it("[TCT] §9.7.2 KARAR H — 4'tür (bağlayıcı tavan)", () => {
      expect(MAX_BOOKING_SLOTS).toBe(4);
    });
  });

  describe("getBookingJoinWindow", () => {
    const appointments = [
      { startsAt: new Date("2025-01-06T09:00:00.000Z"), endsAt: new Date("2025-01-06T09:30:00.000Z") },
      { startsAt: new Date("2025-01-06T10:00:00.000Z"), endsAt: new Date("2025-01-06T10:30:00.000Z") },
    ];

    it("[TCT] §9.7.6 madde 4 — paymentStatus PAID DEĞİLSE joinableFrom/joinableUntil null döner", () => {
      expect(getBookingJoinWindow(appointments, "PENDING")).toEqual({ joinableFrom: null, joinableUntil: null });
      expect(getBookingJoinWindow(appointments, "EXPIRED")).toEqual({ joinableFrom: null, joinableUntil: null });
    });

    it("[TCT] §9.7.6 madde 2/3 — PAID iken booking AÇIKLIĞI (min(startsAt)-10dk … max(endsAt)+15dk) döner", () => {
      const { joinableFrom, joinableUntil } = getBookingJoinWindow(appointments, "PAID");
      expect(joinableFrom).toEqual(new Date(appointments[0]!.startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS));
      expect(joinableUntil).toEqual(new Date(appointments[1]!.endsAt.getTime() + JOIN_WINDOW_AFTER_END_MS));
    });

    it("randevu listesi BOŞSA null/null döner", () => {
      expect(getBookingJoinWindow([], "PAID")).toEqual({ joinableFrom: null, joinableUntil: null });
    });
  });
});
