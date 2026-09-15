import { describe, expect, it } from "vitest";
import {
  buildPatientBookingScopeCountFilters,
  buildPatientBookingScopeFilter,
} from "../../src/modules/telehealth/lib/patient-booking-scope";

/**
 * `.claude/architect-scope-telehealth-template.md` [KHP] §9.8.4 KARAR O — `telehealth.portal.
 * routes.ts::telehealthPatientPortalRoutes::GET /bookings`'ten ÇIKARILAN SAF where-clause üretimi.
 * `lib/doctor-booking-scope.ts::buildDoctorBookingScopeFilter` İLE AYNI İSİM/YAPI deseni, ama
 * semantik hastanın bakış açısına göre KASITLI OLARAK FARKLIDIR (§9.8.7 test 29-32'nin birim
 * karşılığı).
 */
describe("lib/patient-booking-scope.ts::buildPatientBookingScopeFilter", () => {
  const now = new Date("2026-03-16T12:00:00.000Z");

  it("scope=undefined (all) → undefined döner (filtre YOK)", () => {
    expect(buildPatientBookingScopeFilter(undefined, { now })).toBeUndefined();
  });

  it("scope='all' → undefined döner (filtre YOK, mevcut davranış korunur)", () => {
    expect(buildPatientBookingScopeFilter("all", { now })).toBeUndefined();
  });

  it("scope='upcoming' → gelecekteki SCHEDULED/IN_PROGRESS VEYA PENDING ödemeli gelecekteki PENDING_PAYMENT (doktordan FARKLI — PENDING_PAYMENT DAHİL)", () => {
    const filter = buildPatientBookingScopeFilter("upcoming", { now });
    expect(filter).toEqual({
      OR: [
        { appointments: { some: { startsAt: { gt: now }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } } },
        { paymentStatus: "PENDING", appointments: { some: { startsAt: { gt: now }, status: "PENDING_PAYMENT" } } },
      ],
    });
  });

  it("scope='past' → endsAt<=now VE status IN [COMPLETED, NO_SHOW, SCHEDULED, IN_PROGRESS] (SCHEDULED DAHİL, kaybolma regresyonu), upcoming İLE ÖRTÜŞMEZ", () => {
    const filter = buildPatientBookingScopeFilter("past", { now }) as {
      AND: [{ appointments: { some: { endsAt: { lte: Date }; status: { in: string[] } } } }, { NOT: unknown }];
    };
    expect(filter.AND[0]).toEqual({
      appointments: { some: { endsAt: { lte: now }, status: { in: ["COMPLETED", "NO_SHOW", "SCHEDULED", "IN_PROGRESS"] } } },
    });
    expect(filter.AND[1]).toEqual({ NOT: buildPatientBookingScopeFilter("upcoming", { now }) });
  });

  it("scope='cancelled' → CANCELLED randevusu VEYA paymentStatus IN [EXPIRED, REFUNDED] VEYA hiç randevusu olmayan ('hayalet') booking", () => {
    const filter = buildPatientBookingScopeFilter("cancelled", { now });
    expect(filter).toEqual({
      OR: [
        { appointments: { some: { status: "CANCELLED" } } },
        { paymentStatus: { in: ["EXPIRED", "REFUNDED"] } },
        { appointments: { none: {} } },
      ],
    });
  });
});

describe("lib/patient-booking-scope.ts::buildPatientBookingScopeCountFilters", () => {
  const now = new Date("2026-03-16T12:00:00.000Z");

  it("4 sekmenin TAMAMI için filtre döner — `all` HER ZAMAN filtresizdir ({})", () => {
    const filters = buildPatientBookingScopeCountFilters(now);
    expect(filters.all).toEqual({});
    expect(filters.upcoming).toEqual(buildPatientBookingScopeFilter("upcoming", { now }));
    expect(filters.past).toEqual(buildPatientBookingScopeFilter("past", { now }));
    expect(filters.cancelled).toEqual(buildPatientBookingScopeFilter("cancelled", { now }));
  });
});
