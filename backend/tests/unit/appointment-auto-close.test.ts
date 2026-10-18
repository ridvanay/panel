import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@prisma/client";
import { planGroupTransitions } from "../../src/lib/appointment-auto-close";

/**
 * Paket A2 (2026-10-18) — otomatik kapatma kararının saf kuralları: IN_PROGRESS → COMPLETED,
 * SCHEDULED (kanıt yok) → NO_SHOW, 15 dk tolerans sınırı, booking bazlı kesim/kanıt, ödenmemiş
 * booking'in atlanması. DB'li davranış (idempotentlik, dokunulmayan alanlar, audit) entegrasyon
 * testindedir (`tests/integration/appointment-auto-close.test.ts`).
 */

const END = new Date("2026-03-01T10:30:00.000Z");
const MIN = 60_000;

function slot(overrides: Partial<{ id: string; status: AppointmentStatus; startsAt: Date; endsAt: Date; startedAt: Date | null; endedAt: Date | null }> = {}) {
  const endsAt = overrides.endsAt ?? END;
  return {
    id: "apt-1",
    bookingId: "booking-1",
    doctorId: "doctor-1",
    status: "SCHEDULED" as AppointmentStatus,
    startsAt: new Date(endsAt.getTime() - 30 * MIN),
    endsAt,
    startedAt: null,
    endedAt: null,
    priceCents: 50000,
    currency: "TRY",
    ...overrides,
  };
}

describe("planGroupTransitions", () => {
  it("IN_PROGRESS (startedAt dolu) → COMPLETED, start_evidence", () => {
    const now = new Date(END.getTime() + 16 * MIN);
    const { transitions } = planGroupTransitions([slot({ status: "IN_PROGRESS", startedAt: new Date(END.getTime() - 20 * MIN) })], "PAID", now);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ fromStatus: "IN_PROGRESS", toStatus: "COMPLETED", reason: "start_evidence" });
    expect(transitions[0]!.plannedEndsAt).toEqual(END);
  });

  it("SCHEDULED, hiç başlamamış → NO_SHOW", () => {
    const now = new Date(END.getTime() + 16 * MIN);
    const { transitions } = planGroupTransitions([slot()], "PAID", now);
    expect(transitions).toEqual([expect.objectContaining({ fromStatus: "SCHEDULED", toStatus: "NO_SHOW", reason: "no_start_evidence" })]);
  });

  it("tolerans sınırı: bitiş + 15 dk ANINDA kapatmaz, 1 ms sonra kapatır", () => {
    const boundary = new Date(END.getTime() + 15 * MIN);
    expect(planGroupTransitions([slot()], "PAID", boundary).transitions).toHaveLength(0);
    expect(planGroupTransitions([slot()], "PAID", new Date(boundary.getTime() + 1)).transitions).toHaveLength(1);
  });

  it("çoklu slot: kesim booking'in SON slotuna göre hesaplanır", () => {
    const first = slot({ id: "s1", status: "IN_PROGRESS", startedAt: new Date(END.getTime() - 25 * MIN) });
    const second = slot({ id: "s2", endsAt: new Date(END.getTime() + 30 * MIN) });
    // İlk slot bitişinden 20 dk sonra — ikinci slotun penceresi hâlâ açık.
    expect(planGroupTransitions([first, second], "PAID", new Date(END.getTime() + 20 * MIN)).transitions).toHaveLength(0);
  });

  it("çoklu slot: ilk slotta kanıt varsa 2. slot da COMPLETED olur (NO_SHOW değil)", () => {
    const first = slot({ id: "s1", status: "IN_PROGRESS", startedAt: new Date(END.getTime() - 25 * MIN) });
    const second = slot({ id: "s2", endsAt: new Date(END.getTime() + 30 * MIN) });
    const { transitions } = planGroupTransitions([first, second], "PAID", new Date(END.getTime() + 46 * MIN));
    expect(transitions.map((t) => [t.appointmentId, t.toStatus])).toEqual([
      ["s1", "COMPLETED"],
      ["s2", "COMPLETED"],
    ]);
  });

  it("zaten kapalı (COMPLETED/CANCELLED/NO_SHOW) slotlar için geçiş üretmez; COMPLETED kanıt sayılır", () => {
    const done = slot({ id: "s1", status: "COMPLETED", endedAt: END });
    const cancelled = slot({ id: "s2", status: "CANCELLED" });
    const open = slot({ id: "s3" });
    const { transitions } = planGroupTransitions([done, cancelled, open], "PAID", new Date(END.getTime() + 16 * MIN));
    expect(transitions).toEqual([expect.objectContaining({ appointmentId: "s3", toStatus: "COMPLETED" })]);
  });

  it("ödenmemiş booking atlanır ve anomali olarak işaretlenir", () => {
    for (const paymentStatus of ["PENDING", "FAILED", "EXPIRED", "REFUNDED"] as const) {
      const plan = planGroupTransitions([slot()], paymentStatus, new Date(END.getTime() + 60 * MIN));
      expect(plan.transitions).toHaveLength(0);
      expect(plan.skippedUnpaid).toBe(true);
    }
  });

  it("booking'e bağlı olmayan tekil randevu kendi endsAt + 15 dk kesimiyle kapanır", () => {
    const single = { ...slot(), bookingId: null };
    expect(planGroupTransitions([single], null, new Date(END.getTime() + 15 * MIN)).transitions).toHaveLength(0);
    expect(planGroupTransitions([single], null, new Date(END.getTime() + 16 * MIN)).transitions).toEqual([
      expect.objectContaining({ toStatus: "NO_SHOW", bookingId: null }),
    ]);
  });
});

describe("appointment-auto-close modülü yan etki üretmez", () => {
  it("e-posta, outbound webhook ve revalidate modüllerini import etmez", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../src/lib/appointment-auto-close.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/notifications|mail|email|webhook|revalidate/);
  });
});
