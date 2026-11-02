import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";

/**
 * Paket AG (Is 2) - her randevuda admin bildirimi. `sendMail` spy (matcher.test.ts deseni) + `sendTemplateEmail` mock
 * (hasta e-postasi bu dosyanin konusu degil). Tetikleyiciler: Stripe webhook, admin mark-paid, ucretsiz seans, demo odeme;
 * iptal (randevu + booking), saat degisikligi; ayar (`""`, `null`, coklu, gecersiz); gizlilik; baglanti; SMTP hatasi + sweeper.
 */
const sendTemplateEmailMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/modules/email-templates/email-templates.service", () => ({
  sendTemplateEmail: sendTemplateEmailMock,
}));
const mailSpy = vi.hoisted(() => vi.fn());
let mailShouldFail = false;
/** Yalnızca bu adreslere gönderim başarısız olur (kısmi red simülasyonu). */
const failFor = new Set<string>();
/** Doluysa sendMail bu promise çözülene kadar bekler (isteğin SMTP'yi beklemediğini kanıtlamak için). */
let mailGate: Promise<void> | null = null;
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  const { EmailDeliveryError } = await import("../../src/lib/errors");
  return {
    ...actual,
    sendMail: async (...args: unknown[]) => {
      if (mailGate) await mailGate;
      const to = (args[1] as { to: string }).to;
      if (mailShouldFail || failFor.has(to)) throw new EmailDeliveryError("E-posta gönderilemedi, lütfen daha sonra tekrar deneyin.");
      mailSpy(...args);
      return { messageId: "test" };
    },
  };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { stripe } from "../../src/lib/stripe";
import { env } from "../../src/config/env";
import { runAdminNotificationSweep, waitForAdminNotifications } from "../../src/modules/telehealth/lib/admin-booking-notifications";

/** Bildirim gönderimi istek dışında (arka planda) çalışır: yanıttan sonra deterministik olarak beklenir. */
let drain: () => Promise<void> = waitForAdminNotifications;
async function inject(app: FastifyInstance, opts: InjectOptions) {
  const res = await app.inject(opts);
  await drain();
  return res;
}

const PATIENT_NAME = "Zeynep Yilmaz Ozkan";
const PATIENT_EMAIL_PREFIX = "zeynep.ozkan";
const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
const sent = (): SentMail[] => mailSpy.mock.calls.map((c) => c[1] as SentMail);

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled }, update: { enabled } });
}

async function createDoctorWithAvailability(app: FastifyInstance, sessionPriceCents: number | null = 50000) {
  const specialty = await app.prisma.specialty.create({
    data: { name: `Kardiyoloji ${crypto.randomUUID()}`, slug: `kardiyoloji-${crypto.randomUUID()}`, icon: "heart-pulse" },
  });
  const doctor = await app.prisma.doctorProfile.create({
    data: {
      title: "Dr.",
      fullName: `Test Doktor ${crypto.randomUUID()}`,
      slug: `test-doktor-${crypto.randomUUID()}`,
      bio: "Test amaçlı doktor profili.",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: specialty.id,
      sessionDurationMin: 30,
      sessionPriceCents,
      currency: "TRY",
      isActive: true,
    },
  });
  await app.prisma.doctorAvailability.create({ data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true } });
  return { doctor, specialty };
}

function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

async function createBooking(app: FastifyInstance, doctorSlug: string, slots: Date[]) {
  const res = await inject(app, {
    method: "POST",
    url: "/api/v1/appointments/bookings",
    payload: {
      doctorSlug,
      slots: slots.map((s) => s.toISOString()),
      patientName: PATIENT_NAME,
      patientEmail: `${PATIENT_EMAIL_PREFIX}-${crypto.randomUUID()}@example.com`,
      patientTimeZone: "Europe/Berlin",
      locale: "tr",
      identity: VALID_TEST_IDENTITY,
      consent: true,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { bookingId: string; bookingNumber: string; accessToken: string; paymentStatus: string; appointments: { id: string }[] };
}

async function createAdmin(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "USER" = "ADMIN") {
  const { hashPassword } = await import("../../src/lib/password");
  const user = await app.prisma.user.create({
    data: {
      email: `ag-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: "AG Kullanici",
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  const res = await inject(app, { method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
  expect(res.statusCode).toBe(200);
  return { id: user.id, token: res.json().data.tokens.accessToken as string };
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function checkoutEvent(bookingId: string) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${crypto.randomUUID()}`,
        object: "checkout.session",
        mode: "payment",
        payment_intent: `pi_test_${crypto.randomUUID()}`,
        metadata: { kind: "telehealth_booking", bookingId },
      },
    },
  };
}

describe("admin randevu bildirimi (Paket AG, Is 2)", () => {
  let app: FastifyInstance;

  async function postWebhook(eventBody: unknown) {
    const payloadString = JSON.stringify(eventBody);
    return inject(app, {
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: env.STRIPE_WEBHOOK_SECRET }),
      },
      payload: payloadString,
    });
  }

  async function paidScheduledBooking(opts: { admin: { token: string }; interpreterLanguage?: string }) {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    if (opts.interpreterLanguage) {
      await app.prisma.interpreterRequest.create({ data: { bookingId: booking.bookingId, language: opts.interpreterLanguage } });
    }
    const res = await postWebhook(checkoutEvent(booking.bookingId));
    expect(res.statusCode).toBe(200);
    return { booking, doctor };
  }

  beforeEach(async () => {
    mailShouldFail = false;
    failFor.clear();
    mailGate = null;
    mailSpy.mockClear();
    sendTemplateEmailMock.mockClear();
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    await waitForAdminNotifications();
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("Stripe webhook: tek e-posta, varsayilan alici (ayar null), konu/baglanti dogru, hasta verisi YOK; ayni webhook tekrarinda ikinci e-posta YOK", async () => {
    const admin = await createAdmin(app);
    const { booking } = await paidScheduledBooking({ admin, interpreterLanguage: "ar" });

    expect(sent()).toHaveLength(1);
    const mail = sent()[0]!;
    expect(mail.to).toBe("admin@wmhealthistanbul.com");
    expect(mail.subject).toMatch(new RegExp(`^New appointment #${booking.bookingNumber} \u2014 Dr\\. .+ \u2014 \\d{4}-\\d{2}-\\d{2} 09:00 \\(Europe/Istanbul\\)$`));
    expect(mail.html).toContain(`${env.FRONTEND_URL.replace(/\/$/, "")}/admin/telehealth/bookings/${booking.bookingId}`);
    expect(mail.text).toContain("Interpreter: yes (Arabic (ar))");
    expect(mail.text).toContain("Paid (card)");
    expect(mail.text).toContain("Duration: 30 min");
    expect(mail.text).toContain("Berlin");
    // Gizlilik: hasta adi/e-postasi hicbir yerde yok.
    for (const body of [mail.subject, mail.html, mail.text]) {
      expect(body).not.toContain("Zeynep");
      expect(body).not.toContain("Ozkan");
      expect(body).not.toContain(PATIENT_EMAIL_PREFIX);
      expect(body).not.toContain("example.com");
    }

    const again = await postWebhook(checkoutEvent(booking.bookingId));
    expect(again.statusCode).toBe(200);
    expect(sent()).toHaveLength(1);
    const rows = await app.prisma.adminNotification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventKey: `booking:${booking.bookingId}:confirmed`, status: "sent", attempts: 1 });
  });

  it("tercuman yoksa 'Interpreter: no' ve hastanin site dili yazilir", async () => {
    const admin = await createAdmin(app);
    await paidScheduledBooking({ admin });
    const mail = sent()[0]!;
    expect(mail.text).toContain("Interpreter: no");
    expect(mail.text).toContain("Patient's site language: Turkish (tr)");
  });

  it("ucretsiz seans: tek e-posta ('Free session')", async () => {
    const { doctor } = await createDoctorWithAvailability(app, null);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    expect(booking.paymentStatus).toBe("PAID");
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.text).toContain("Free session");
  });

  it("admin mark-paid: tek e-posta ('Paid (manual)'); resend-link e-posta TETIKLEMEZ", async () => {
    const admin = await createAdmin(app);
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    expect(sent()).toHaveLength(0);

    const paid = await inject(app, {
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${booking.bookingId}/mark-paid`,
      headers: bearer(admin.token),
      payload: { reason: "test odemesi" },
    });
    expect(paid.statusCode).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.text).toContain("Paid (manual)");

    const resend = await inject(app, { method: "POST", url: `/api/v1/appointments/bookings/${booking.bookingId}/resend-link` });
    expect(resend.statusCode).toBe(202);
    expect(sent()).toHaveLength(1);
    expect(await app.prisma.adminNotification.count()).toBe(1);
  });

  it("randevu iptali: 'Appointment #no cancelled'; tekrar iptal 409 ve ikinci e-posta yok", async () => {
    const admin = await createAdmin(app);
    const { booking } = await paidScheduledBooking({ admin });
    mailSpy.mockClear();

    const res = await inject(app, { method: "POST", url: `/api/v1/appointments/${booking.appointments[0]!.id}/cancel`, headers: bearer(admin.token), payload: { reason: "hasta istedi" } });
    expect(res.statusCode).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.subject).toBe(`Appointment #${booking.bookingNumber} cancelled`);
    expect(sent()[0]!.html).toContain(`/admin/telehealth/bookings/${booking.bookingId}`);
    expect(sent()[0]!.text).not.toContain("hasta istedi");

    const second = await inject(app, { method: "POST", url: `/api/v1/appointments/${booking.appointments[0]!.id}/cancel`, headers: bearer(admin.token) });
    expect(second.statusCode).toBe(409);
    expect(sent()).toHaveLength(1);
    expect(await app.prisma.adminNotification.findFirst({ where: { eventKey: `appointment:${booking.appointments[0]!.id}:cancelled` } })).not.toBeNull();
  });

  it("booking iptali: odenmis booking -> iptal e-postasi; odenmemis (PENDING) booking iptali -> e-posta YOK", async () => {
    const admin = await createAdmin(app);
    const { booking } = await paidScheduledBooking({ admin });
    mailSpy.mockClear();
    const res = await inject(app, { method: "POST", url: `/api/v1/appointments/bookings/${booking.bookingId}/cancel`, headers: bearer(admin.token) });
    expect(res.statusCode).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.subject).toBe(`Appointment #${booking.bookingNumber} cancelled`);
    expect(await app.prisma.adminNotification.findFirst({ where: { eventKey: `booking:${booking.bookingId}:cancelled` } })).not.toBeNull();

    mailSpy.mockClear();
    const { doctor } = await createDoctorWithAvailability(app);
    const pending = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    const cancelPending = await inject(app, { method: "POST", url: `/api/v1/appointments/bookings/${pending.bookingId}/cancel?t=${pending.accessToken}` });
    expect(cancelPending.statusCode).toBe(200);
    expect(sent()).toHaveLength(0);
  });

  it("admin saat degisikligi: 'rescheduled' e-postasi (eski + yeni saat); saat degismeyen istek e-posta uretmez", async () => {
    const admin = await createAdmin(app);
    const { booking } = await paidScheduledBooking({ admin });
    mailSpy.mockClear();
    const appointmentId = booking.appointments[0]!.id;

    const res = await inject(app, {
      method: "PATCH",
      url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`,
      headers: bearer(admin.token),
      payload: { newDate: nextMondayNineAmUtc().toISOString().slice(0, 10), newStartTime: "11:00", reason: "ozel neden" },
    });
    expect(res.statusCode).toBe(200);
    expect(sent()).toHaveLength(1);
    const mail = sent()[0]!;
    expect(mail.subject).toBe(`Appointment #${booking.bookingNumber} rescheduled`);
    expect(mail.text).toContain("Previous date and time");
    expect(mail.text).toContain("New date and time");
    expect(mail.text).toContain("11:00");
    expect(mail.text).not.toContain("ozel neden");
    expect(mail.html).toContain(`/admin/telehealth/bookings/${booking.bookingId}`);

    const row = await app.prisma.adminNotification.findFirst({ where: { kind: "rescheduled" } });
    expect(row?.eventKey).toMatch(new RegExp(`^appointment:${appointmentId}:rescheduled:`));
    expect(row?.status).toBe("sent");
  });

  describe("alici ayari", () => {
    it('ayar "" (bilerek bos) -> e-posta GITMEZ, kayit skipped', async () => {
      const admin = await createAdmin(app);
      const patch = await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: "" } });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.bookingNotificationRecipients).toBe("");
      expect(patch.json().data.bookingNotificationRecipientsEffective).toEqual([]);

      await paidScheduledBooking({ admin });
      expect(sent()).toHaveLength(0);
      expect((await app.prisma.adminNotification.findMany()).map((r) => r.status)).toEqual(["skipped"]);
    });

    it("coklu adres: normalize edilir (kucuk harf, tekrarsiz) ve hepsine gider; null -> varsayilana doner", async () => {
      const admin = await createAdmin(app);
      const patch = await inject(app, {
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: bearer(admin.token),
        payload: { bookingNotificationRecipients: " Ops@Example.com, ops@example.com ,, koordinator@example.com " },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.bookingNotificationRecipients).toBe("ops@example.com, koordinator@example.com");
      expect(patch.json().data.bookingNotificationRecipientsEffective).toEqual(["ops@example.com", "koordinator@example.com"]);

      await paidScheduledBooking({ admin });
      // Alıcı başına AYRI e-posta (tek `to` adresi).
      expect(sent().map((m) => m.to).sort()).toEqual(["koordinator@example.com", "ops@example.com"]);
      expect((await app.prisma.adminNotification.findFirstOrThrow()).status).toBe("sent");

      const reset = await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: null } });
      expect(reset.json().data.bookingNotificationRecipients).toBeNull();
      expect(reset.json().data.bookingNotificationRecipientsEffective).toEqual(["admin@wmhealthistanbul.com"]);

      // Audit'e adresler YAZILMAZ, yalniz adet.
      const audit = await app.prisma.auditLog.findMany({ where: { action: "settings.update" } });
      expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain("@");
    });

    it("gecersiz adres -> 422 (alan bookingNotificationRecipients, hangi adres) ve deger KAYDEDILMEZ", async () => {
      const admin = await createAdmin(app);
      const res = await inject(app, {
        method: "PATCH",
        url: "/api/v1/admin/settings",
        headers: bearer(admin.token),
        payload: { bookingNotificationRecipients: "gecerli@example.com, bozuk-adres" },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(JSON.stringify(body)).toContain("bookingNotificationRecipients");
      expect(JSON.stringify(body)).toContain("bozuk-adres");
      const row = await app.prisma.siteSettings.findUnique({ where: { id: "singleton" } });
      expect(row?.bookingNotificationRecipients ?? null).toBeNull();
    });

    it("11 adres -> 422; public GET /settings alici listesini SIZDIRMAZ, admin GET doner", async () => {
      const admin = await createAdmin(app);
      const many = Array.from({ length: 11 }, (_, i) => `a${i}@example.com`).join(",");
      const res = await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: many } });
      expect(res.statusCode).toBe(422);

      await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: "gizli@example.com" } });
      const pub = await inject(app, { method: "GET", url: "/api/v1/settings" });
      expect(pub.statusCode).toBe(200);
      expect(JSON.stringify(pub.json())).not.toContain("gizli@example.com");
      expect(pub.json().data).not.toHaveProperty("bookingNotificationRecipients");
      const adm = await inject(app, { method: "GET", url: "/api/v1/admin/settings", headers: bearer(admin.token) });
      expect(adm.json().data.bookingNotificationRecipients).toBe("gizli@example.com");
    });

    it("yalnizca ADMIN ayari degistirebilir (MANAGER 403)", async () => {
      const manager = await createAdmin(app, "MANAGER");
      const res = await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(manager.token), payload: { bookingNotificationRecipients: "x@example.com" } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("guvenilirlik: SMTP hatasi randevuyu bozmaz, kayit pending, sweeper yeniden dener", () => {
    it("SMTP hatasinda webhook 200 ve odeme onayli; kayit pending(attempts 1); sweeper ikinci denemede sent; sonra tekrar gonderim yok", async () => {
      const admin = await createAdmin(app);
      mailShouldFail = true;
      const { doctor } = await createDoctorWithAvailability(app);
      const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
      const res = await postWebhook(checkoutEvent(booking.bookingId));
      expect(res.statusCode).toBe(200);

      const dbBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(dbBooking.paymentStatus).toBe("PAID");
      const row = await app.prisma.adminNotification.findFirstOrThrow();
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(row.nextAttemptAt).not.toBeNull();
      expect(row.lastError).not.toContain("@");
      expect(sent()).toHaveLength(0);

      // Vadesi gelmeden sweeper dokunmaz.
      expect((await runAdminNotificationSweep(app, new Date())).retried).toBe(0);

      mailShouldFail = false;
      const result = await runAdminNotificationSweep(app, new Date(Date.now() + 10 * 60_000));
      expect(result).toMatchObject({ retried: 1, sent: 1 });
      expect(sent()).toHaveLength(1);
      expect((await app.prisma.adminNotification.findFirstOrThrow()).status).toBe("sent");

      expect((await runAdminNotificationSweep(app, new Date(Date.now() + 60 * 60_000))).retried).toBe(0);
      expect(sent()).toHaveLength(1);
      void admin;
    });

    it("4 basarisiz denemeden sonra failed (yeniden deneme durur)", async () => {
      mailShouldFail = true;
      const { doctor } = await createDoctorWithAvailability(app);
      const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
      await postWebhook(checkoutEvent(booking.bookingId));
      let clock = Date.now();
      for (let i = 0; i < 5; i += 1) {
        clock += 20 * 60_000;
        await runAdminNotificationSweep(app, new Date(clock));
      }
      const row = await app.prisma.adminNotification.findFirstOrThrow();
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(4);
      expect(row.nextAttemptAt).toBeNull();
    });
  });

  describe("istek bloklanmaz, alici basina gonderim, saklama, rol gorunurlugu", () => {
    it("SMTP askidayken webhook YANITI beklemez (kayit senkron yazilir, gonderim arka planda); kapi acilinca gonderilir", async () => {
      const { doctor } = await createDoctorWithAvailability(app);
      const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
      let release!: () => void;
      mailGate = new Promise<void>((resolve) => (release = resolve));

      const payloadString = JSON.stringify(checkoutEvent(booking.bookingId));
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload: payloadString, secret: env.STRIPE_WEBHOOK_SECRET }) },
        payload: payloadString,
      });
      // Yanit SMTP kapisi KAPALIYKEN dondu; kayit hazir, e-posta henuz gitmedi.
      expect(res.statusCode).toBe(200);
      expect(sent()).toHaveLength(0);
      expect(await app.prisma.adminNotification.count({ where: { eventKey: `booking:${booking.bookingId}:confirmed` } })).toBe(1);

      release();
      await waitForAdminNotifications();
      expect(sent()).toHaveLength(1);
      expect((await app.prisma.adminNotification.findFirstOrThrow()).status).toBe("sent");
    });

    it("kismi red: basarili alici payload.deliveredTo'ya yazilir; retry YALNIZ basarisiz aliciya gider (cift gonderim yok)", async () => {
      const admin = await createAdmin(app);
      await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: "a@example.com, b@example.com" } });
      failFor.add("b@example.com");
      await paidScheduledBooking({ admin });

      expect(sent().map((m) => m.to)).toEqual(["a@example.com"]);
      const pending = await app.prisma.adminNotification.findFirstOrThrow();
      expect(pending.status).toBe("pending");
      expect(pending.attempts).toBe(1);
      expect((pending.payload as { deliveredTo: string[] }).deliveredTo).toEqual(["a@example.com"]);

      failFor.clear();
      const result = await runAdminNotificationSweep(app, new Date(Date.now() + 10 * 60_000));
      expect(result).toMatchObject({ retried: 1, sent: 1 });
      expect(sent().map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
      const done = await app.prisma.adminNotification.findFirstOrThrow();
      expect(done.status).toBe("sent");
      expect((done.payload as { deliveredTo: string[] }).deliveredTo.sort()).toEqual(["a@example.com", "b@example.com"]);
    });

    it("A->B->C->B saat degisikligi zincirinde UCUNCU olay da bildirilir (eventKey eski+yeni baslangic icerir)", async () => {
      const admin = await createAdmin(app);
      const { booking } = await paidScheduledBooking({ admin });
      mailSpy.mockClear();
      const appointmentId = booking.appointments[0]!.id;
      const date = nextMondayNineAmUtc().toISOString().slice(0, 10);
      for (const time of ["11:00", "12:00", "11:00"]) {
        const res = await inject(app, { method: "PATCH", url: `/api/v1/admin/telehealth/appointments/${appointmentId}/reschedule`, headers: bearer(admin.token), payload: { newDate: date, newStartTime: time } });
        expect(res.statusCode).toBe(200);
      }
      expect(sent()).toHaveLength(3);
      const keys = (await app.prisma.adminNotification.findMany({ where: { kind: "rescheduled" } })).map((r) => r.eventKey);
      expect(new Set(keys).size).toBe(3);
    });

    it("B-4: 90 gunden eski sent/skipped/failed kayitlar sweeper'da silinir; pending ve yeni kayitlar kalir", async () => {
      const old = new Date(Date.now() - 100 * 24 * 60 * 60_000);
      await app.prisma.adminNotification.createMany({
        data: [
          { eventKey: "k:old-sent", kind: "confirmed", status: "sent", createdAt: old },
          { eventKey: "k:old-skipped", kind: "confirmed", status: "skipped", createdAt: old },
          { eventKey: "k:old-failed", kind: "confirmed", status: "failed", createdAt: old },
          { eventKey: "k:old-pending", kind: "confirmed", status: "pending", createdAt: old, nextAttemptAt: new Date(Date.now() + 3_600_000) },
          { eventKey: "k:new-sent", kind: "confirmed", status: "sent" },
        ],
      });
      await runAdminNotificationSweep(app);
      expect((await app.prisma.adminNotification.findMany({ orderBy: { eventKey: "asc" } })).map((r) => r.eventKey)).toEqual(["k:new-sent", "k:old-pending"]);
    });

    it("GET /admin/settings: alici adresleri yalniz ADMIN'e dolu doner; MANAGER icin null / []", async () => {
      const admin = await createAdmin(app);
      const manager = await createAdmin(app, "MANAGER");
      await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: "gizli@example.com" } });
      const asAdmin = (await inject(app, { method: "GET", url: "/api/v1/admin/settings", headers: bearer(admin.token) })).json().data;
      expect(asAdmin.bookingNotificationRecipients).toBe("gizli@example.com");
      expect(asAdmin.bookingNotificationRecipientsEffective).toEqual(["gizli@example.com"]);
      const asManager = await inject(app, { method: "GET", url: "/api/v1/admin/settings", headers: bearer(manager.token) });
      expect(asManager.statusCode).toBe(200);
      expect(asManager.json().data.bookingNotificationRecipients).toBeNull();
      expect(asManager.json().data.bookingNotificationRecipientsEffective).toEqual([]);
      expect(JSON.stringify(asManager.json())).not.toContain("gizli@example.com");
    });

    it("sikilastirilmis dogrulama: PATCH ':' '(' backslash '|' '%' '!' iceren adresleri 422 ile reddeder", async () => {
      const admin = await createAdmin(app);
      for (const bad of ["a:b@example.com", "a(b)@example.com", "a\\b@example.com", "a|b@example.com", "a%b@example.com", "a!b@example.com", "a..b@example.com"]) {
        const res = await inject(app, { method: "PATCH", url: "/api/v1/admin/settings", headers: bearer(admin.token), payload: { bookingNotificationRecipients: bad } });
        expect(res.statusCode, bad).toBe(422);
      }
    });
  });

  describe("GET /admin/telehealth/bookings/:id (bildirim baglantisinin hedefi)", () => {
    it("ADMIN/MANAGER detayi gorur (tercuman dili dahil); USER 403; oturumsuz 401; olmayan 404", async () => {
      const admin = await createAdmin(app);
      const manager = await createAdmin(app, "MANAGER");
      const user = await createAdmin(app, "USER");
      const { booking } = await paidScheduledBooking({ admin, interpreterLanguage: "ar" });
      const url = `/api/v1/admin/telehealth/bookings/${booking.bookingId}`;

      const ok = await inject(app, { method: "GET", url, headers: bearer(admin.token) });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data).toMatchObject({ id: booking.bookingId, bookingNumber: booking.bookingNumber, interpreterLanguage: "ar", locale: "tr", paymentStatus: "PAID", paidBy: "stripe" });
      expect(ok.json().data.patientName).toBe(PATIENT_NAME);

      expect((await inject(app, { method: "GET", url, headers: bearer(manager.token) })).statusCode).toBe(200);
      expect((await inject(app, { method: "GET", url, headers: bearer(user.token) })).statusCode).toBe(403);
      expect((await inject(app, { method: "GET", url })).statusCode).toBe(401);
      expect((await inject(app, { method: "GET", url: `/api/v1/admin/telehealth/bookings/${crypto.randomUUID()}`, headers: bearer(admin.token) })).statusCode).toBe(404);
    });
  });
});

describe("admin randevu bildirimi - demo odeme yolu (ENABLE_DEMO_PAYMENTS=true)", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_DEMO_PAYMENTS = "true";
    vi.resetModules();
    ({ buildApp } = await import("../../src/app"));
    // resetModules sonrası bildirim modülü YENİ bir örnektir: bekleme fonksiyonu da oradan alınır.
    drain = (await import("../../src/modules/telehealth/lib/admin-booking-notifications")).waitForAdminNotifications;
  });
  beforeEach(async () => {
    mailShouldFail = false;
    mailSpy.mockClear();
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });
  afterEach(async () => {
    await drain();
    await resetDatabase(app.prisma);
    await app.close();
  });
  afterAll(() => {
    drain = waitForAdminNotifications;
    delete process.env.ENABLE_DEMO_PAYMENTS;
    vi.resetModules();
  });

  it("demo odeme: tek e-posta ('Paid (demo)'); ikinci demo odeme 409 ve ek e-posta yok", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);
    const res = await inject(app, { method: "POST", url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}` });
    expect(res.statusCode).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.text).toContain("Paid (demo)");

    const again = await inject(app, { method: "POST", url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}` });
    expect(again.statusCode).toBe(409);
    expect(sent()).toHaveLength(1);
  });
});
