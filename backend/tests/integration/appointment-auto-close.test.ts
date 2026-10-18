import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type AppointmentStatus, type BookingPaymentStatus } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";
import { APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION, runAppointmentAutoClose } from "../../src/lib/appointment-auto-close";

/**
 * Paket A2 (2026-10-18) — otomatik kapatmanın gerçek DB davranışı ve tek seferlik
 * `scripts/close-stale-appointments.ts` (dry-run hiçbir şey yazmaz; gerçek modda yalnızca hedef
 * kayıtlar değişir). Script, `add-home-journey-faq-blocks-script.test.ts` deseniyle ayrı bir alt
 * process'te (`tsx`) çalıştırılır.
 */

const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/close-stale-appointments.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const MIN = 60_000;

function runScript(args: string[] = []) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env },
    encoding: "utf8",
  });
}

describe("appointment-auto-close (DB)", () => {
  const prisma = new PrismaClient();
  let doctorId: string;

  beforeEach(async () => {
    await resetDatabase(prisma);
    const doctor = await prisma.doctorProfile.create({
      data: {
        title: "Dr.",
        fullName: "Test Doktor",
        slug: `test-doktor-${crypto.randomUUID()}`,
        bio: "Test",
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "TRY",
        isActive: true,
      },
    });
    doctorId = doctor.id;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function createBooking(paymentStatus: BookingPaymentStatus) {
    return prisma.appointmentBooking.create({
      data: {
        bookingNumber: `B-${crypto.randomUUID()}`,
        doctorId,
        patientName: "Test Hasta",
        patientEmail: "hasta@example.com",
        slotCount: 1,
        unitPriceCents: 50000,
        subtotalCents: 50000,
        totalCents: 50000,
        paymentStatus,
        paidAt: paymentStatus === "PAID" ? new Date() : null,
        expiresAt: new Date(),
        consentAt: new Date(),
        consentVersion: "v1",
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: crypto.randomBytes(32).toString("hex"),
      },
    });
  }

  async function createAppointment(input: {
    endsAt: Date;
    status: AppointmentStatus;
    bookingId?: string | null;
    startedAt?: Date | null;
    note?: string | null;
  }) {
    return prisma.appointment.create({
      data: {
        doctorId,
        patientName: "Test Hasta",
        patientEmail: "hasta@example.com",
        startsAt: new Date(input.endsAt.getTime() - 30 * MIN),
        endsAt: input.endsAt,
        status: input.status,
        priceCents: 50000,
        meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
        accessTokenHash: crypto.randomBytes(32).toString("hex"),
        bookingId: input.bookingId ?? null,
        startedAt: input.startedAt ?? null,
        consultationNoteCiphertext: input.note ?? null,
      },
    });
  }

  it("IN_PROGRESS → COMPLETED (endedAt = planlanan bitiş), SCHEDULED → NO_SHOW; ödeme ve not verisi değişmez; audit yazılır", async () => {
    const past = new Date(Date.now() - 2 * 60 * MIN);
    const paidA = await createBooking("PAID");
    const paidB = await createBooking("PAID");
    const started = await createAppointment({ endsAt: past, status: "IN_PROGRESS", bookingId: paidA.id, startedAt: new Date(past.getTime() - 20 * MIN), note: "iv:tag:cipher" });
    const neverStarted = await createAppointment({ endsAt: new Date(past.getTime() - 60 * MIN), status: "SCHEDULED", bookingId: paidB.id });

    const result = await runAppointmentAutoClose(prisma, { source: "sweeper" });

    expect(result.transitions).toHaveLength(2);
    const startedRow = await prisma.appointment.findUniqueOrThrow({ where: { id: started.id } });
    expect(startedRow.status).toBe("COMPLETED");
    expect(startedRow.endedAt).toEqual(past);
    expect(startedRow.consultationNoteCiphertext).toBe("iv:tag:cipher");
    expect(startedRow.priceCents).toBe(50000);

    const noShowRow = await prisma.appointment.findUniqueOrThrow({ where: { id: neverStarted.id } });
    expect(noShowRow.status).toBe("NO_SHOW");
    expect(noShowRow.endedAt).toBeNull();

    const bookings = await prisma.appointmentBooking.findMany({ where: { id: { in: [paidA.id, paidB.id] } } });
    expect(bookings.every((b) => b.paymentStatus === "PAID" && b.totalCents === 50000)).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { action: APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION }, orderBy: { seq: "asc" } });
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.actorId === null)).toBe(true);
    expect(audits.map((a) => (a.metadata as { actor: string; source: string }).actor)).toEqual(["system", "system"]);
  });

  it("idempotent: ikinci tur hiçbir şey değiştirmez, audit tekrarlanmaz", async () => {
    const booking = await createBooking("PAID");
    await createAppointment({ endsAt: new Date(Date.now() - 60 * MIN), status: "SCHEDULED", bookingId: booking.id });

    const first = await runAppointmentAutoClose(prisma, { source: "sweeper" });
    const second = await runAppointmentAutoClose(prisma, { source: "sweeper" });

    expect(first.transitions).toHaveLength(1);
    expect(second.transitions).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION } })).toBe(1);
  });

  it("tolerans içindeki, gelecekteki, ödenmemiş ve zaten kapalı randevulara dokunmaz", async () => {
    const paid = await createBooking("PAID");
    const unpaid = await createBooking("PENDING");
    const withinGrace = await createAppointment({ endsAt: new Date(Date.now() - 10 * MIN), status: "IN_PROGRESS", bookingId: paid.id, startedAt: new Date() });
    const unpaidRow = await createAppointment({ endsAt: new Date(Date.now() - 60 * MIN), status: "SCHEDULED", bookingId: unpaid.id });
    const cancelled = await createAppointment({ endsAt: new Date(Date.now() - 60 * MIN), status: "CANCELLED" });

    const result = await runAppointmentAutoClose(prisma, { source: "sweeper" });

    expect(result.transitions).toHaveLength(0);
    expect(result.skippedUnpaid).toEqual([expect.objectContaining({ bookingId: unpaid.id, paymentStatus: "PENDING" })]);
    for (const [id, status] of [
      [withinGrace.id, "IN_PROGRESS"],
      [unpaidRow.id, "SCHEDULED"],
      [cancelled.id, "CANCELLED"],
    ] as const) {
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe(status);
    }
  });

  it("booking'e bağlı olmayan tekil randevu kendi bitiş + 15 dk kesimiyle kapanır", async () => {
    const stale = await createAppointment({ endsAt: new Date(Date.now() - 20 * MIN), status: "SCHEDULED" });
    const graceSingle = await createAppointment({ endsAt: new Date(Date.now() - 5 * MIN), status: "SCHEDULED" });

    const result = await runAppointmentAutoClose(prisma, { source: "sweeper" });

    expect(result.transitions.map((t) => t.appointmentId)).toEqual([stale.id]);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("NO_SHOW");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: graceSingle.id } })).status).toBe("SCHEDULED");
  });

  it("çoklu slot: ilk slotta kanıt varsa 2. slot da COMPLETED, CANCELLED slota dokunulmaz", async () => {
    const booking = await createBooking("PAID");
    const base = Date.now() - 3 * 60 * MIN;
    const first = await createAppointment({ endsAt: new Date(base), status: "IN_PROGRESS", bookingId: booking.id, startedAt: new Date(base - 25 * MIN) });
    const second = await createAppointment({ endsAt: new Date(base + 30 * MIN), status: "SCHEDULED", bookingId: booking.id });
    const cancelled = await createAppointment({ endsAt: new Date(base + 60 * MIN), status: "CANCELLED", bookingId: booking.id });

    await runAppointmentAutoClose(prisma, { source: "sweeper" });

    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("COMPLETED");
    const secondRow = await prisma.appointment.findUniqueOrThrow({ where: { id: second.id } });
    expect(secondRow.status).toBe("COMPLETED");
    expect(secondRow.startedAt).toBeNull();
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: cancelled.id } })).status).toBe("CANCELLED");
  });

  it("doktorun önceden tamamladığı randevuya ve endedAt'ine dokunmaz (yarışta /complete kazanır)", async () => {
    const booking = await createBooking("PAID");
    const doctorEndedAt = new Date(Date.now() - 2 * 60 * MIN);
    const done = await prisma.appointment.update({
      where: { id: (await createAppointment({ endsAt: new Date(Date.now() - 2 * 60 * MIN), status: "IN_PROGRESS", bookingId: booking.id, startedAt: new Date() })).id },
      data: { status: "COMPLETED", endedAt: doctorEndedAt },
    });

    const result = await runAppointmentAutoClose(prisma, { source: "sweeper" });

    expect(result.transitions).toHaveLength(0);
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: done.id } });
    expect(row.endedAt).toEqual(doctorEndedAt);
    expect(await prisma.auditLog.count({ where: { action: APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION } })).toBe(0);
  });

  it("script --dry-run hiçbir şey yazmaz; gerçek modda yalnızca hedef kayıtlar değişir", async () => {
    const booking = await createBooking("PAID");
    const stale = await createAppointment({ endsAt: new Date(Date.now() - 3 * 60 * MIN), status: "IN_PROGRESS", bookingId: booking.id, startedAt: new Date(Date.now() - 4 * 60 * MIN) });
    const future = await createAppointment({ endsAt: new Date(Date.now() + 24 * 60 * MIN), status: "SCHEDULED" });

    const dry = runScript(["--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("[dry-run] 1 randevu: 1 COMPLETED, 0 NO_SHOW.");
    expect(dry.stdout).toContain(stale.id);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("IN_PROGRESS");
    expect(await prisma.auditLog.count()).toBe(0);

    const real = runScript();
    expect(real.status, real.stderr).toBe(0);
    expect(real.stdout).toContain("[uygulandı] 1 randevu: 1 COMPLETED, 0 NO_SHOW.");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("COMPLETED");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("SCHEDULED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: APPOINTMENT_AUTO_CLOSED_AUDIT_ACTION } });
    expect((audit.metadata as { source: string }).source).toBe("backfill_script");
  });
});
