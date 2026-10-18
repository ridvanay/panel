import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BookingPaymentStatus } from "@prisma/client";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { PurgeBlockedError, isRealPayment, pruneDemoDoctorPurgeBackups, runDemoDoctorPurge } from "../../src/lib/demo-doctor-purge";
import { computeConfirmKey, parseArchiveSelection, runTestBookingArchive } from "../../src/lib/test-booking-archive";

/**
 * Paket B2/B4 — `scripts/purge-demo-doctors.ts` ve `scripts/archive-test-bookings.ts` çekirdekleri.
 * Dosya silme sahte bir silici ile doğrulanır (gerçek disk/S3'e dokunulmaz).
 */

async function createDoctor(app: FastifyInstance, slug: string, userId: string | null = null) {
  const specialty = await app.prisma.specialty.create({ data: { name: `Uzmanlık ${slug}`, slug: `sp-${slug}`, icon: "heart" } });
  const doctor = await app.prisma.doctorProfile.create({
    data: { title: "Dr.", fullName: `Demo ${slug}`, slug, bio: "Demo", languages: ["en"], userId },
  });
  await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 600 } });
  await app.prisma.doctorAdditionalSpecialty.create({ data: { doctorId: doctor.id, specialtyId: specialty.id } });
  return doctor;
}

async function createBooking(
  app: FastifyInstance,
  doctorId: string,
  opts: { paymentStatus?: BookingPaymentStatus; paidBy?: string | null; startsAt?: Date; status?: "COMPLETED" | "SCHEDULED" | "CANCELLED"; patientUserId?: string }
) {
  const startsAt = opts.startsAt ?? new Date(Date.now() - 7 * 24 * 3600_000 + Math.floor(Math.random() * 1_000_000));
  const booking = await app.prisma.appointmentBooking.create({
    data: {
      bookingNumber: `PB-${crypto.randomUUID().slice(0, 8)}`,
      doctorId,
      patientUserId: opts.patientUserId ?? null,
      patientName: "Demo Hasta",
      patientEmail: `demo-${crypto.randomUUID()}@example.com`,
      slotCount: 1,
      unitPriceCents: 150000,
      subtotalCents: 150000,
      totalCents: 150000,
      currency: "EUR",
      paymentStatus: opts.paymentStatus ?? "PAID",
      paidBy: opts.paidBy === undefined ? "demo" : opts.paidBy,
      expiresAt: startsAt,
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: crypto.randomBytes(32).toString("hex"),
      consentAt: new Date(),
      consentVersion: "test",
    },
  });
  const appointment = await app.prisma.appointment.create({
    data: {
      doctorId,
      patientName: "Demo Hasta",
      patientEmail: booking.patientEmail,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: opts.status ?? "COMPLETED",
      priceCents: 150000,
      currency: "EUR",
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: crypto.randomBytes(32).toString("hex"),
      bookingId: booking.id,
    },
  });
  return { booking, appointment };
}

describe("isRealPayment — demo/ücretsiz ayrımı", () => {
  it("stripe/manual/PaymentIntent/REFUNDED gerçek; demo ve free değil", () => {
    expect(isRealPayment({ paymentStatus: "PAID", paidBy: "stripe", stripePaymentIntentId: null })).toBe(true);
    expect(isRealPayment({ paymentStatus: "PAID", paidBy: "manual", stripePaymentIntentId: null })).toBe(true);
    expect(isRealPayment({ paymentStatus: "PENDING", paidBy: null, stripePaymentIntentId: "pi_123" })).toBe(true);
    expect(isRealPayment({ paymentStatus: "REFUNDED", paidBy: "demo", stripePaymentIntentId: null })).toBe(true);
    expect(isRealPayment({ paymentStatus: "PAID", paidBy: null, stripePaymentIntentId: null })).toBe(true);
    expect(isRealPayment({ paymentStatus: "PAID", paidBy: "demo", stripePaymentIntentId: null })).toBe(false);
    expect(isRealPayment({ paymentStatus: "PAID", paidBy: "free", stripePaymentIntentId: null })).toBe(false);
    expect(isRealPayment({ paymentStatus: "EXPIRED", paidBy: null, stripePaymentIntentId: null })).toBe(false);
  });
});

describe("purge-demo-doctors (Paket B2)", () => {
  let app: FastifyInstance;
  let backupDir: string;
  const fileRemover = { removeDocument: vi.fn(async () => {}), removeRecording: vi.fn(async () => {}) };

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "purge-test-"));
    fileRemover.removeDocument.mockClear();
    fileRemover.removeRecording.mockClear();
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  it("gerçek ödemeli randevu varsa DURUR ve hiçbir şey silinmez", async () => {
    const doctor = await createDoctor(app, "laura-bennett-2");
    await createBooking(app, doctor.id, { paidBy: "manual" });

    await expect(
      runDemoDoctorPurge(app.prisma, { slugs: ["laura-bennett-2"], dryRun: false, backupDir, fileRemover, operator: "test" })
    ).rejects.toMatchObject({ blockers: [expect.objectContaining({ code: "HAS_REAL_PAYMENT" })] });

    expect(await app.prisma.doctorProfile.count({ where: { id: doctor.id } })).toBe(1);
    expect(await app.prisma.appointmentBooking.count({ where: { doctorId: doctor.id } })).toBe(1);
    expect(await fs.readdir(backupDir)).toHaveLength(0);
  });

  it("gerçek ödemeli booking ARŞİVLİ olsa bile durur (compliance kararı)", async () => {
    const doctor = await createDoctor(app, "felix-braun-2");
    const { booking } = await createBooking(app, doctor.id, { paidBy: "stripe" });
    await app.prisma.appointmentBooking.update({ where: { id: booking.id }, data: { archivedAt: new Date(), archivedReason: "test" } });

    await expect(runDemoDoctorPurge(app.prisma, { slugs: ["felix-braun-2"], dryRun: true, backupDir, fileRemover, operator: "test" })).rejects.toBeInstanceOf(
      PurgeBlockedError
    );
    expect(await app.prisma.doctorProfile.count({ where: { id: doctor.id } })).toBe(1);
  });

  it("bağlı kullanıcısı olan doktorda ve bulunamayan slug'da durur; diğer slug'lar da silinmez", async () => {
    const user = await app.prisma.user.create({ data: { email: `dr-${crypto.randomUUID()}@example.com`, name: "Dr", passwordHash: "x" } });
    const linked = await createDoctor(app, "linked-doc", user.id);
    const clean = await createDoctor(app, "clean-doc");

    let error: PurgeBlockedError | null = null;
    try {
      await runDemoDoctorPurge(app.prisma, { slugs: ["linked-doc", "clean-doc", "yok-boyle-biri"], dryRun: false, backupDir, fileRemover, operator: "test" });
    } catch (err) {
      error = err as PurgeBlockedError;
    }
    expect(error?.blockers.map((b) => b.code).sort()).toEqual(["DOCTOR_NOT_FOUND", "HAS_LINKED_USER"]);
    expect(await app.prisma.doctorProfile.count({ where: { id: { in: [linked.id, clean.id] } } })).toBe(2);
  });

  it("gelecekte açık randevu varsa durur", async () => {
    const doctor = await createDoctor(app, "future-doc");
    await createBooking(app, doctor.id, { startsAt: new Date(Date.now() + 3 * 24 * 3600_000), status: "SCHEDULED" });

    await expect(runDemoDoctorPurge(app.prisma, { slugs: ["future-doc"], dryRun: true, backupDir, fileRemover, operator: "test" })).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: "HAS_UPCOMING_APPOINTMENT" })],
    });
  });

  it("ücretsiz (free) seansta klinik kayıt varsa açık gerekçeyle bile durur", async () => {
    const doctor = await createDoctor(app, "free-clinical");
    const { booking } = await createBooking(app, doctor.id, { paidBy: "free" });
    await app.prisma.appointmentIntake.create({ data: { bookingId: booking.id, healthDataConsentAt: new Date(), healthDataConsentVersion: "v1" } });

    await expect(
      runDemoDoctorPurge(app.prisma, {
        slugs: ["free-clinical"],
        dryRun: false,
        backupDir,
        fileRemover,
        operator: "test",
        allowDemoClinicalReason: "deneme",
      })
    ).rejects.toMatchObject({ blockers: [expect.objectContaining({ code: "HAS_CLINICAL_RECORD" })] });
    expect(await app.prisma.doctorProfile.count({ where: { id: doctor.id } })).toBe(1);
  });

  it("--operator boşsa çalışmaz", async () => {
    await createDoctor(app, "op-doc");
    await expect(runDemoDoctorPurge(app.prisma, { slugs: ["op-doc"], dryRun: true, backupDir, fileRemover, operator: " " })).rejects.toThrow(
      /--operator/
    );
  });

  it("30 günden eski yedekler --prune-backups ile imha edilir ve audit'e yazılır", async () => {
    const oldFile = path.join(backupDir, "purge-demo-doctors-old.json");
    const newFile = path.join(backupDir, "purge-demo-doctors-new.json");
    await fs.writeFile(oldFile, "{}");
    await fs.writeFile(newFile, "{}");
    const past = new Date(Date.now() - 31 * 24 * 3600_000);
    await fs.utimes(oldFile, past, past);

    const expired = await pruneDemoDoctorPurgeBackups(app.prisma, { backupDir, operator: "test", dryRun: false });

    expect(expired).toEqual(["purge-demo-doctors-old.json"]);
    expect(await fs.readdir(backupDir)).toEqual(["purge-demo-doctors-new.json"]);
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.doctor.purge_backup_destroyed" } })).toBe(1);
  });

  it("dry-run listeler, hiçbir şey silmez ve yedek yazmaz", async () => {
    const doctor = await createDoctor(app, "dry-doc");
    await createBooking(app, doctor.id, {});

    const result = await runDemoDoctorPurge(app.prisma, { slugs: ["dry-doc"], dryRun: true, backupDir, fileRemover, operator: "test" });

    expect(result.plan.doctors[0]).toMatchObject({ slug: "dry-doc", availabilityCount: 1, additionalSpecialtyCount: 1 });
    expect(result.plan.doctors[0]!.appointments).toHaveLength(1);
    expect(result.plan.doctors[0]!.bookings).toHaveLength(1);
    expect(result.backupFile).toBeNull();
    expect(await app.prisma.doctorProfile.count({ where: { id: doctor.id } })).toBe(1);
    expect(await fs.readdir(backupDir)).toHaveLength(0);
  });

  it("gerçek çalıştırma: önce JSON yedek, sonra tek transaction'da test verisiyle birlikte siler; hasta hesabı ve audit kalır", async () => {
    const patient = await app.prisma.user.create({ data: { email: `p-${crypto.randomUUID()}@example.com`, name: "Hasta", passwordHash: "x" } });
    const doctor = await createDoctor(app, "purge-doc");
    const { booking, appointment } = await createBooking(app, doctor.id, { paidBy: "demo", patientUserId: patient.id });
    await createBooking(app, doctor.id, { paymentStatus: "EXPIRED", paidBy: null });
    await app.prisma.appointmentIntake.create({ data: { bookingId: booking.id, healthDataConsentAt: new Date(), healthDataConsentVersion: "v1" } });
    await app.prisma.appointmentDocument.create({
      data: { bookingId: booking.id, storagePath: "abc.pdf", filename: "tahlil.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "x" },
    });
    const recording = await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "COMPLETED", storagePath: "telehealth-recordings/r.mp4.enc" },
    });
    const preexistingAudit = await app.prisma.auditLog.create({ data: { action: "telehealth.booking.created", targetId: booking.id } });

    // Klinik içerik yalnızca demo booking'te → açık gerekçe olmadan durur, gerekçeyle geçer.
    await expect(
      runDemoDoctorPurge(app.prisma, { slugs: ["purge-doc"], dryRun: true, backupDir, fileRemover, operator: "test" })
    ).rejects.toMatchObject({ blockers: [expect.objectContaining({ code: "HAS_CLINICAL_RECORD" })] });

    const result = await runDemoDoctorPurge(app.prisma, {
      slugs: ["purge-doc"],
      dryRun: false,
      backupDir,
      fileRemover,
      operator: "test",
      allowDemoClinicalReason: "Demo verisi, gerçek hasta yok",
    });

    expect(result.deleted).toEqual({ doctors: 1, appointments: 2, bookings: 2 });
    expect(await app.prisma.doctorProfile.count({ where: { id: doctor.id } })).toBe(0);
    expect(await app.prisma.appointment.count({ where: { doctorId: doctor.id } })).toBe(0);
    expect(await app.prisma.appointmentIntake.count({ where: { bookingId: booking.id } })).toBe(0);
    expect(await app.prisma.appointmentDocument.count({ where: { bookingId: booking.id } })).toBe(0);
    expect(await app.prisma.consultationRecording.count({ where: { id: recording.id } })).toBe(0);
    expect(await app.prisma.doctorAvailability.count({ where: { doctorId: doctor.id } })).toBe(0);
    expect(await app.prisma.doctorAdditionalSpecialty.count({ where: { doctorId: doctor.id } })).toBe(0);

    expect(await app.prisma.user.count({ where: { id: patient.id } })).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { id: preexistingAudit.id } })).toBe(1);
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.doctor.purged" } })).toBe(1);

    expect(fileRemover.removeDocument).toHaveBeenCalledWith("abc.pdf");
    expect(fileRemover.removeRecording).toHaveBeenCalledWith(recording.id, "telehealth-recordings/r.mp4.enc");

    const backup = JSON.parse(await fs.readFile(result.backupFile!, "utf8"));
    expect(backup.doctors[0].slug).toBe("purge-doc");
    expect(backup.doctors[0].appointmentBookings).toHaveLength(2);
    expect(backup.doctors[0].appointmentBookings.some((b: { documents: unknown[] }) => b.documents.length === 1)).toBe(true);
  });
});

describe("archive-test-bookings (Paket B4)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("seçim açık olmalı: filtresiz veya kısmi filtre reddedilir", () => {
    expect(() => parseArchiveSelection({})).toThrow();
    expect(() => parseArchiveSelection({ from: "2026-09-01", to: "2026-10-01" })).toThrow();
    expect(() => parseArchiveSelection({ ids: "not-a-uuid" })).toThrow();
    expect(parseArchiveSelection({ from: "2026-09-01", to: "2026-10-01", doctor: "dr-x" })).toEqual({
      kind: "range",
      from: "2026-09-01",
      to: "2026-10-01",
      doctorSlug: "dr-x",
    });
  });

  it("dry-run tutarlarla listeler ve yazmaz; onay anahtarı olmadan/yanlışken gerçek çalıştırma reddedilir; doğru anahtarla yalnızca archivedAt yazılır", async () => {
    const doctor = await createDoctor(app, "archive-doc");
    const { booking: paid } = await createBooking(app, doctor.id, { paidBy: "manual" });
    const { booking: future } = await createBooking(app, doctor.id, { startsAt: new Date(Date.now() + 3 * 24 * 3600_000), status: "SCHEDULED" });
    const selection = parseArchiveSelection({ ids: `${paid.id},${future.id}` });
    const reason = "Eylül-Ekim test ödemeleri";

    const dry = await runTestBookingArchive(app.prisma, { selection, reason, dryRun: true, operator: "test" });
    expect(dry.plan.toArchive.map((c) => c.id)).toEqual([paid.id]);
    expect(dry.plan.notArchivable.map((c) => c.id)).toEqual([future.id]);
    expect(dry.plan.totalsByCurrency).toEqual({ EUR: 150000 });
    expect(dry.plan.toArchive[0]!.realPayment).toBe(true);
    expect(dry.plan.confirmKey).toBe(computeConfirmKey([paid.id], reason));
    expect((await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: paid.id } })).archivedAt).toBeNull();

    await expect(runTestBookingArchive(app.prisma, { selection, reason, dryRun: false, operator: "test" })).rejects.toThrow(/--confirm/);
    await expect(
      runTestBookingArchive(app.prisma, { selection, reason: "başka gerekçe", dryRun: false, operator: "test", confirmKey: dry.plan.confirmKey })
    ).rejects.toThrow(/eşleşmiyor/);

    const real = await runTestBookingArchive(app.prisma, { selection, reason, dryRun: false, operator: "test", confirmKey: dry.plan.confirmKey });
    expect(real.archivedCount).toBe(1);
    const row = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: paid.id } });
    expect(row.archivedAt).not.toBeNull();
    expect(row.archivedReason).toBe(reason);
    expect(row.paymentStatus).toBe("PAID");
    expect(await app.prisma.appointmentBooking.count()).toBe(2);
    expect((await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: future.id } })).archivedAt).toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.booking.archived", targetId: paid.id } })).toBe(1);
  });

  it("tarih aralığı + doktor filtresi yalnızca o doktorun aralıktaki booking'lerini seçer", async () => {
    const doctor = await createDoctor(app, "range-doc");
    const other = await createDoctor(app, "other-doc");
    const inRange = await createBooking(app, doctor.id, { startsAt: new Date("2026-09-15T10:00:00.000Z") });
    await createBooking(app, doctor.id, { startsAt: new Date("2026-08-15T10:00:00.000Z") });
    await createBooking(app, other.id, { startsAt: new Date("2026-09-15T11:00:00.000Z") });

    const dry = await runTestBookingArchive(app.prisma, {
      selection: parseArchiveSelection({ from: "2026-09-01", to: "2026-10-17", doctor: "range-doc" }),
      reason: "test",
      dryRun: true,
      operator: "test",
    });
    expect(dry.plan.toArchive.map((c) => c.id)).toEqual([inRange.booking.id]);
  });
});
