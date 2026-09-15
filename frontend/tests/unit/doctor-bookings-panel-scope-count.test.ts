import { describe, expect, it } from "vitest";
import { scopeCount } from "@/components/site/telehealth/doctor-bookings-panel";
import type { DoctorConsoleOverview } from "@/lib/api/types";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 2 (bağlayıcı) — `scopeCount()`
 * artık "upcoming"/"all" için GERÇEK backend toplamlarını (`upcomingBookingTotal`/
 * `allBookingTotal`) okumalı, eskisi gibi `null` (yanıltıcı olmasın diye sayaç gizlenirdi)
 * DÖNMEMELİDİR. "today"/"completed" mantığı DEĞİŞMEDİ.
 */
function makeOverview(overrides: Partial<DoctorConsoleOverview> = {}): DoctorConsoleOverview {
  return {
    timeZone: "Europe/Istanbul",
    today: { date: "2026-09-15", total: 3, scheduled: 2, inProgress: 0, completed: 1, cancelled: 0 },
    completedConsultationTotal: 42,
    distinctPatientTotal: 10,
    pendingDocumentCount: 1,
    nextAppointment: null,
    generatedAt: "2026-09-15T08:00:00.000Z",
    upcomingBookingTotal: 7,
    allBookingTotal: 25,
    ...overrides,
  };
}

describe("scopeCount (doctor-bookings-panel.tsx)", () => {
  it("overview yokken (henüz yüklenmedi) her scope için null döner", () => {
    expect(scopeCount("all", null)).toBeNull();
    expect(scopeCount("upcoming", null)).toBeNull();
    expect(scopeCount("today", null)).toBeNull();
    expect(scopeCount("completed", null)).toBeNull();
  });

  it("'today' için today.total'ı döner", () => {
    expect(scopeCount("today", makeOverview())).toBe(3);
  });

  it("'completed' için completedConsultationTotal'ı döner", () => {
    expect(scopeCount("completed", makeOverview())).toBe(42);
  });

  it("'upcoming' için artık null DEĞİL, upcomingBookingTotal'ı döner", () => {
    expect(scopeCount("upcoming", makeOverview({ upcomingBookingTotal: 7 }))).toBe(7);
  });

  it("'all' için artık null DEĞİL, allBookingTotal'ı döner", () => {
    expect(scopeCount("all", makeOverview({ allBookingTotal: 25 }))).toBe(25);
  });
});
