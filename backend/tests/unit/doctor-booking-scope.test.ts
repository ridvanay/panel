import { describe, expect, it } from "vitest";
import { BOOKINGS_WITH_APPOINTMENTS_FILTER, buildDoctorBookingScopeFilter } from "../../src/modules/telehealth/lib/doctor-booking-scope";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 2 §2.3 (bağlayıcı) —
 * `telehealth.portal.routes.ts::GET /bookings?scope=...`'ten ÇIKARILAN SAF where-clause üretimi.
 * `GET /bookings` VE `GET /doctor/overview` (İstek 2 §2.2) BU TEK kaynağı kullanır.
 */
describe("lib/doctor-booking-scope.ts::buildDoctorBookingScopeFilter", () => {
  const now = new Date("2026-03-16T12:00:00.000Z"); // Pazartesi (Europe/Istanbul'da 15:00)

  it("scope=undefined (all) → undefined döner (filtre YOK)", () => {
    expect(buildDoctorBookingScopeFilter(undefined, { now })).toBeUndefined();
  });

  it("scope='upcoming' → `startsAt > now` VE `status IN [SCHEDULED, IN_PROGRESS]` (PENDING_PAYMENT KASITLI OLARAK HARİÇ)", () => {
    const filter = buildDoctorBookingScopeFilter("upcoming", { now });
    expect(filter).toEqual({
      appointments: { some: { startsAt: { gt: now }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } },
    });
  });

  it("scope='completed' → `status=COMPLETED`", () => {
    const filter = buildDoctorBookingScopeFilter("completed", { now });
    expect(filter).toEqual({ appointments: { some: { status: "COMPLETED" } } });
  });

  it("scope='today' → `timeZone` ZORUNLUDUR, verilmezse throw eder", () => {
    expect(() => buildDoctorBookingScopeFilter("today", { now })).toThrow();
  });

  it("scope='today' → doktorun DUVAR SAATİNDEKİ takvim günü aralığı, `PENDING_PAYMENT` HARİÇ", () => {
    const filter = buildDoctorBookingScopeFilter("today", { now, timeZone: "Europe/Istanbul" }) as {
      appointments: { some: { startsAt: { gte: Date; lt: Date }; status: { not: string } } };
    };
    // Europe/Istanbul (+03:00) — 2026-03-16 00:00 yerel = 2026-03-15T21:00:00.000Z.
    expect(filter.appointments.some.startsAt.gte.toISOString()).toBe("2026-03-15T21:00:00.000Z");
    expect(filter.appointments.some.startsAt.lt.toISOString()).toBe("2026-03-16T21:00:00.000Z");
    expect(filter.appointments.some.status.not).toBe("PENDING_PAYMENT");
  });

  it("BOOKINGS_WITH_APPOINTMENTS_FILTER — 'hayalet' (appointmentsiz) booking'leri dışlayan sabit filtre", () => {
    expect(BOOKINGS_WITH_APPOINTMENTS_FILTER).toEqual({ appointments: { some: {} } });
  });
});
