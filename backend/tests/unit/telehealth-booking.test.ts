import { describe, expect, it } from "vitest";
import { generateMeetingRoomName, isWithinJoinWindow, JOIN_WINDOW_AFTER_END_MS, JOIN_WINDOW_BEFORE_START_MS } from "../../src/modules/telehealth/lib/booking";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.5 — SAF katılım penceresi yardımcısı.
 * Bu modülün uçları BU fonksiyonu KULLANMAZ (integration-agent'ın `meeting-token` ucu kullanır) —
 * ama backend-agent yazar ve test eder (bkz. görev notu madde 5/8).
 */
describe("modules/telehealth/lib/booking", () => {
  describe("isWithinJoinWindow", () => {
    const startsAt = new Date("2025-01-06T09:00:00.000Z");
    const endsAt = new Date("2025-01-06T09:30:00.000Z");

    it("randevu başlamadan tam 5 dk önce (dahil) TRUE döner", () => {
      const now = new Date(startsAt.getTime() - JOIN_WINDOW_BEFORE_START_MS);
      expect(isWithinJoinWindow(now, startsAt, endsAt)).toBe(true);
    });

    it("randevu başlamadan 5 dk 1 saniye önce FALSE döner", () => {
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
});
