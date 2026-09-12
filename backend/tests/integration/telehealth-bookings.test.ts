import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { runBookingExpirySweep } from "../../src/lib/booking-expiry";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7 "TADİLAT TURU 2" — çoklu slot booking,
 * `PENDING_PAYMENT` yaşam döngüsü/süre dolumu, sağlık verisi (intake + belge) yetki matrisi,
 * `/admin/telehealth/bookings` RBAC'i ve `mark-paid`. AYRI `describe`/`app` blokları —
 * `POST /appointments/bookings`'in 5/dk route-level hız sınırı tek bir app örneğinde birikip
 * testleri 429 ile çökertir (`telehealth.test.ts` İLE AYNI, bu depoda YERLEŞİK çözüm).
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-booking-user-${crypto.randomUUID()}@example.com`,
      name: "Test Kullanıcı",
      passwordHash,
      role,
      status: "ACTIVE",
    },
  });
}

async function loginAs(app: FastifyInstance, email: string, password = "Sifre12345!"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

/** Europe/Istanbul, Pazartesi 09:00-17:00, 30dk seans (varsayılan) — her çağrıda YENİ bir doktor/uzmanlık. */
async function createDoctorWithAvailability(app: FastifyInstance, sessionPriceCents = 50000) {
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
  await app.prisma.doctorAvailability.create({
    data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true },
  });
  return { doctor, specialty };
}

/** Bugünden itibaren GELECEKTEKİ ilk Pazartesi'nin 09:00 Europe/Istanbul (= 06:00 UTC) anı. */
function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

function bookingPayload(doctorSlug: string, slots: Date[], patientEmail = `hasta-${crypto.randomUUID()}@example.com`) {
  return {
    doctorSlug,
    slots: slots.map((s) => s.toISOString()),
    patientName: "Test Hasta",
    patientEmail,
    consent: true,
  };
}

describe("telehealth booking — çoklu slot rezervasyon (§9.7.2 KARAR H)", () => {
  let app: FastifyInstance;

  // `POST /appointments/bookings`'in 5/dk route-level hız sınırı (bkz. görev notu üstü) —
  // bu describe'daki bazı testler BİRDEN FAZLA çağrı yapar; paylaşılan tek bir app örneği
  // toplam çağrı sayısını 5'i AŞARDI (`telehealth.test.ts`'in AYRI describe/app deseninin
  // TEK bir describe İÇİNDE, HER `it` için TAZE app ile eşdeğeri).
  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("2 slot → 201, totalCents = 2×unitPriceCents SUNUCUDA hesaplanır; PENDING_PAYMENT ile başlar", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 75000);
    const startsAt = nextMondayNineAmUtc();
    const secondSlot = new Date(startsAt.getTime() + 30 * 60 * 1000);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt, secondSlot]),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.slotCount).toBe(2);
    expect(body.unitPriceCents).toBe(75000);
    expect(body.totalCents).toBe(150000);
    expect(body.paymentStatus).toBe("PENDING");
    expect(body.appointments).toHaveLength(2);
    expect(body.appointments.every((a: { status: string }) => a.status === "PENDING_PAYMENT")).toBe(true);
    expect(typeof body.accessToken).toBe("string");
  });

  it("istemcinin gönderdiği totalCents/unitPriceCents YOK SAYILIR (şema zaten kabul etmez)", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 10000);
    const startsAt = nextMondayNineAmUtc();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: { ...bookingPayload(doctor.slug, [startsAt]), totalCents: 1, unitPriceCents: 1 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.totalCents).toBe(10000);
  });

  it("5 slot (MAX_BOOKING_SLOTS aşımı) → 422", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const slots = Array.from({ length: 5 }, (_, i) => new Date(startsAt.getTime() + i * 30 * 60 * 1000));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, slots),
    });
    expect(res.statusCode).toBe(422);
  });

  it("farklı takvim günlerine ait slotlar → 422, HİÇBİR randevu oluşmaz", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const nextWeek = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt, nextWeek]),
    });
    expect(res.statusCode).toBe(422);

    const count = await app.prisma.appointment.count({ where: { doctorId: doctor.id } });
    expect(count).toBe(0);
  });

  it("slotlardan biri DOLUYSA HİÇBİRİ oluşmaz (409 SLOT_TAKEN, kısmi rezervasyon YOK)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const secondSlot = new Date(startsAt.getTime() + 30 * 60 * 1000);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [secondSlot]),
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt, secondSlot]),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("SLOT_TAKEN");

    // İlk slot (startsAt) İÇİN hiçbir randevu oluşmamış olmalı (kısmi rezervasyon YOK).
    const firstSlotCount = await app.prisma.appointment.count({ where: { doctorId: doctor.id, startsAt } });
    expect(firstSlotCount).toBe(0);
  });
});

describe("telehealth booking — iptal (§9.7.3, POST .../cancel)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: `telehealth-booking-cancel-admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("PENDING booking iptali — randevu satırları SİLİNİR, booking EXPIRED olur, slot SERBEST kalır", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    const { bookingId, accessToken } = created.json().data;

    const cancelRes = await app.inject({ method: "POST", url: `/api/v1/appointments/bookings/${bookingId}/cancel?t=${accessToken}`, payload: {} });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.paymentStatus).toBe("EXPIRED");
    expect(cancelRes.json().data.appointments).toHaveLength(0);

    const appointmentCount = await app.prisma.appointment.count({ where: { bookingId } });
    expect(appointmentCount).toBe(0);

    const rebook = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(rebook.statusCode).toBe(201);
  });

  it("PAID booking iptali — §4.3 AYNEN GEÇERLİDİR: randevular CANCELLED olur, slot KAPALI kalır (yeniden alınamaz)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    const { bookingId } = created.json().data;

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(adminToken),
      payload: { reason: "test" },
    });

    // NOT: `mark-paid`, hastanın ham token'ını hiçbir yerde bilmediği için booking'in
    // magic-link'ini ROTATE eder (bkz. `lib/booking.ts::confirmBookingPayment` yorumu) — bu
    // yüzden ödeme SONRASI iptal ADMIN oturumuyla doğrulanır (`?t=` ile DEĞİL).
    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/cancel`,
      headers: authHeader(adminToken),
      payload: {},
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.paymentStatus).toBe("PAID");
    expect(cancelRes.json().data.appointments.every((a: { status: string }) => a.status === "CANCELLED")).toBe(true);

    const rebook = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(rebook.statusCode).toBe(409);
    expect(rebook.json().error.code).toBe("SLOT_TAKEN");

    const secondCancel = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/cancel`,
      headers: authHeader(adminToken),
      payload: {},
    });
    expect(secondCancel.statusCode).toBe(409);
  });

  it("yanlış/eksik token ile iptal edilemez (404, IDOR)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    const { bookingId } = created.json().data;

    const noToken = await app.inject({ method: "POST", url: `/api/v1/appointments/bookings/${bookingId}/cancel`, payload: {} });
    expect(noToken.statusCode).toBe(404);
  });
});

describe("telehealth booking — süre dolumu süpürücüsü (§9.7.3 KARAR I)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("expiresAt geçmiş PENDING booking → randevu satırları HARD DELETE, booking EXPIRED, slot yeniden GET /slots'ta available", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(created.statusCode).toBe(201);
    const bookingId = created.json().data.bookingId;

    await app.prisma.appointmentBooking.update({ where: { id: bookingId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const sweepResult = await runBookingExpirySweep(app);
    expect(sweepResult.expiredBookings).toBe(1);
    expect(sweepResult.deletedAppointments).toBe(1);

    const booking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.paymentStatus).toBe("EXPIRED");

    const appointmentCount = await app.prisma.appointment.count({ where: { bookingId } });
    expect(appointmentCount).toBe(0);

    const fromStr = startsAt.toISOString().slice(0, 10);
    const slots = await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}/slots?from=${fromStr}&to=${fromStr}` });
    const slotBody = slots.json().data as { startsAt: string; available: boolean }[];
    expect(slotBody.find((s) => s.startsAt === startsAt.toISOString())?.available).toBe(true);
  });

  it("ödenmiş (PAID) bir booking'e süpürücü DOKUNMAZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const admin = await registerTestUser(app, { email: `telehealth-expiry-admin-${crypto.randomUUID()}@example.com` });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    const bookingId = created.json().data.bookingId;

    const markPaid = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(admin.accessToken),
      payload: { reason: "Test" },
    });
    expect(markPaid.statusCode).toBe(200);

    await app.prisma.appointmentBooking.update({ where: { id: bookingId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await runBookingExpirySweep(app);

    const booking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.paymentStatus).toBe("PAID");
    const appointmentCount = await app.prisma.appointment.count({ where: { bookingId } });
    expect(appointmentCount).toBe(1);
  });
});

describe("telehealth booking — mark-paid (§9.7.1 madde 7) + fatura (§9.7.0 madde 11)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: `telehealth-markpaid-admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("MANAGER mark-paid ÇAĞIRAMAZ (403) — para hareketi beyanı yalnızca ADMIN'e verilir", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    const bookingId = created.json().data.bookingId;

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(managerToken),
      payload: { reason: "deneme" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("reason ZORUNLU (422); ADMIN mark-paid → booking PAID, TÜM randevular SCHEDULED, audit log yazılır", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    const bookingId = created.json().data.bookingId;

    const missingReason = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(adminToken),
      payload: {},
    });
    expect(missingReason.statusCode).toBe(422);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(adminToken),
      payload: { reason: "Ofis içi nakit ödeme" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.paymentStatus).toBe("PAID");
    expect(body.paidBy).toBe("manual");
    expect(body.appointments.every((a: { status: string }) => a.status === "SCHEDULED")).toBe(true);

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.booking.marked_paid", targetId: bookingId } });
    expect(audit).not.toBeNull();

    // Zaten ödenmiş bir booking'i tekrar mark-paid → 409.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(adminToken),
      payload: { reason: "tekrar" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("GET .../invoice — yalnızca PAID booking için 200 döner, PENDING iken 409 BOOKING_NOT_PAYABLE", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 60000);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    const bookingId = created.json().data.bookingId;
    const accessToken = created.json().data.accessToken;

    const beforePaid = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/invoice?t=${accessToken}` });
    expect(beforePaid.statusCode).toBe(409);
    expect(beforePaid.json().error.code).toBe("BOOKING_NOT_PAYABLE");

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${bookingId}/mark-paid`,
      headers: authHeader(adminToken),
      payload: { reason: "test" },
    });

    // NOT: ADMIN'in manuel `mark-paid` ucu, hasta ham token'ını hiçbir yerde bilmediği için
    // (yalnızca hash saklanır) `lib/booking.ts::confirmBookingPayment` YENİ bir magic-link
    // token'ı ÜRETİR/ROTATE eder (`resend-link` İLE AYNI ilke — bkz. o fonksiyonun yorumu);
    // bu yüzden ADMIN sonrasında erişimi KENDİ oturumuyla doğrular (`?t=` ile DEĞİL).
    const afterPaid = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/invoice`,
      headers: authHeader(adminToken),
    });
    expect(afterPaid.statusCode).toBe(200);
    const invoice = afterPaid.json().data;
    expect(invoice.totalCents).toBe(60000);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.disclaimer).toEqual(expect.stringContaining("resmi bir fatura"));
  });
});

describe("telehealth booking — /admin/telehealth/bookings RBAC (§8.4)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: `telehealth-admin-bookings-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("EDITOR 403, ADMIN/MANAGER 200 (EDITOR dışlanır — hasta PII'si)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });

    const editorRes = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/bookings", headers: authHeader(editorToken) });
    expect(editorRes.statusCode).toBe(403);

    const managerRes = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/bookings", headers: authHeader(managerToken) });
    expect(managerRes.statusCode).toBe(200);
    expect(Array.isArray(managerRes.json().data)).toBe(true);

    const adminRes = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/bookings", headers: authHeader(adminToken) });
    expect(adminRes.statusCode).toBe(200);
  });
});

describe("telehealth booking — sağlık verisi yetki matrisi (§9.7.5 KARAR J, ENGELLEYİCİ)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: `telehealth-health-admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function createBookingDirect() {
    const { doctor } = await createDoctorWithAvailability(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    expect(created.statusCode).toBe(201);
    return { doctor, bookingId: created.json().data.bookingId as string, accessToken: created.json().data.accessToken as string };
  }

  it("healthDataConsent olmadan PUT .../intake → 422 HEALTH_CONSENT_REQUIRED; belge yükleme de RIZA OLMADAN reddedilir", async () => {
    const { bookingId, accessToken } = await createBookingDirect();

    const noConsent = await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}`,
      payload: { note: "Baş ağrısı şikayeti", healthDataConsent: false },
    });
    expect(noConsent.statusCode).toBe(422);
    expect(noConsent.json().error.code).toBe("HEALTH_CONSENT_REQUIRED");

    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}`,
      payload: Buffer.from("%PDF-1.4 test"),
      headers: { "content-type": "multipart/form-data; boundary=----x" },
    });
    // Rıza (intake) hiç verilmediği için (malformed multipart olsa da) reddedilmeli — rıza
    // kontrolü dosya ayrıştırmadan ÖNCE yapılır.
    expect(upload.statusCode).toBe(422);
  });

  it("rıza VERİLDİKTEN sonra not yazılabilir/okunabilir/silinebilir; yetki matrisi (hasta/doktor/ADMIN ✓, MANAGER ✗, EDITOR ✗)", async () => {
    const { doctor, bookingId, accessToken } = await createBookingDirect();

    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}`,
      payload: { note: "Baş ağrısı şikayeti", healthDataConsent: true },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.note).toBe("Baş ağrısı şikayeti");

    // DB'de düz metin YOK — yalnızca şifreli ciphertext.
    const rawIntake = await app.prisma.appointmentIntake.findUniqueOrThrow({ where: { bookingId } });
    expect(rawIntake.noteCiphertext).not.toBeNull();
    expect(rawIntake.noteCiphertext).not.toContain("Baş ağrısı");

    const patientGet = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}` });
    expect(patientGet.statusCode).toBe(200);
    expect(patientGet.json().data.note).toBe("Baş ağrısı şikayeti");

    // Erişim denetim kaydı yazılmış olmalı.
    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.intake_note.accessed", targetId: bookingId } });
    expect(audit).not.toBeNull();

    // Doktorun bağlı User'ı → erişebilir.
    const doctorUser = await createUserDirect(app, "USER");
    const doctorUserToken = await loginAs(app, doctorUser.email);
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/doctors/${doctor.id}`,
      headers: authHeader(adminToken),
      payload: { userId: doctorUser.id },
    });
    const doctorGet = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/intake`,
      headers: authHeader(doctorUserToken),
    });
    expect(doctorGet.statusCode).toBe(200);

    // ADMIN erişebilir.
    const adminGet = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/intake`, headers: authHeader(adminToken) });
    expect(adminGet.statusCode).toBe(200);

    // MANAGER İÇERİĞE ERİŞEMEZ (§9.7.5 madde 7, ENGELLEYİCİ).
    const managerGet = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/intake`, headers: authHeader(managerToken) });
    expect(managerGet.statusCode).toBe(404);

    // EDITOR hiç erişemez.
    const editorGet = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/intake`, headers: authHeader(editorToken) });
    expect(editorGet.statusCode).toBe(404);

    // Hasta kendi notunu SİLEBİLİR (KVKK md.11) — ciphertext null'lanır, rıza kanıtı KORUNUR.
    const del = await app.inject({ method: "DELETE", url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}` });
    expect(del.statusCode).toBe(204);
    const afterDelete = await app.prisma.appointmentIntake.findUniqueOrThrow({ where: { bookingId } });
    expect(afterDelete.noteCiphertext).toBeNull();
    expect(afterDelete.healthDataConsentAt).not.toBeNull();
  });

  it("belge yükleme: SVG/sahte-uzantı REDDEDİLİR (422); PDF kabul edilir; /uploads/** üzerinden ERİŞİLEMEZ; 6. belge 409", async () => {
    const { bookingId, accessToken } = await createBookingDirect();

    await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}`,
      payload: { healthDataConsent: true },
    });

    const svgBuffer = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const svgForm = buildMultipartBody("file.svg", "image/png", svgBuffer);
    const svgRes = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}`,
      payload: svgForm.body,
      headers: { "content-type": svgForm.contentType },
    });
    expect(svgRes.statusCode).toBe(422);
    expect(svgRes.json().error.code).toBe("UNSUPPORTED_DOCUMENT_TYPE");

    const pdfBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(64)]);
    const pdfForm = buildMultipartBody("tahlil.pdf", "application/pdf", pdfBuffer);
    const pdfRes = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}`,
      payload: pdfForm.body,
      headers: { "content-type": pdfForm.contentType },
    });
    expect(pdfRes.statusCode).toBe(201);
    const documentId = pdfRes.json().data.id;
    expect(pdfRes.json().data.mimeType).toBe("application/pdf");

    // Sızıntı testi (ENGELLEYİCİ, §9.7.11 madde 25) — belge `/uploads/**` altından ERİŞİLEMEZ.
    const storagePath = (await app.prisma.appointmentDocument.findUniqueOrThrow({ where: { id: documentId } })).storagePath;
    const leaked = await app.inject({ method: "GET", url: `/api/v1/../uploads/${storagePath}` });
    expect(leaked.statusCode).not.toBe(200);
    const leakedDirect = await app.inject({ method: "GET", url: `/uploads/${storagePath}` });
    expect(leakedDirect.statusCode).toBe(404);

    // Kapılı akıştan doğru indirme — header'lar ve içerik.
    const content = await app.inject({ method: "GET", url: `/api/v1/appointments/documents/${documentId}/content?t=${accessToken}` });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-disposition"]).toContain("attachment");
    expect(content.headers["cache-control"]).toBe("no-store");

    const auditDownload = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.intake_document.accessed", targetId: documentId } });
    expect(auditDownload).not.toBeNull();

    // 5 belge tavanı zaten 1 tane var — 4 tane daha ekleyip 6.'da 409 bekleniyor.
    for (let i = 0; i < 4; i++) {
      const extra = buildMultipartBody(`ekstra-${i}.pdf`, "application/pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(16)]));
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}`,
        payload: extra.body,
        headers: { "content-type": extra.contentType },
      });
      expect(res.statusCode).toBe(201);
    }
    const sixth = buildMultipartBody("altinci.pdf", "application/pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(16)]));
    const sixthRes = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}`,
      payload: sixth.body,
      headers: { "content-type": sixth.contentType },
    });
    expect(sixthRes.statusCode).toBe(409);
    expect(sixthRes.json().error.code).toBe("DOCUMENT_LIMIT_REACHED");

    // Hasta kendi belgesini silebilir; silinen belge listede/`GET /admin/media`de GÖRÜNMEZ.
    const del = await app.inject({ method: "DELETE", url: `/api/v1/appointments/documents/${documentId}?t=${accessToken}` });
    expect(del.statusCode).toBe(204);

    const adminMedia = await app.inject({ method: "GET", url: "/api/v1/admin/media", headers: authHeader(adminToken) });
    expect(adminMedia.statusCode).toBe(200);
    expect(adminMedia.json().data).toEqual([]);
  });

  it("GET .../documents (metadata) — hasta/doktor/ADMIN görür, MANAGER GÖREMEZ (yalnızca sayı görür)", async () => {
    const { bookingId, accessToken } = await createBookingDirect();
    await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}`,
      payload: { healthDataConsent: true },
    });
    const upload = buildMultipartBody("belge.pdf", "application/pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(16)]));
    await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}`,
      payload: upload.body,
      headers: { "content-type": upload.contentType },
    });

    const patientList = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/documents?t=${accessToken}` });
    expect(patientList.statusCode).toBe(200);
    expect(patientList.json().data).toHaveLength(1);

    const managerList = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}/documents`, headers: authHeader(managerToken) });
    expect(managerList.statusCode).toBe(404);

    // MANAGER, booking görünümü üzerinden yalnızca SAYIYI görür.
    const managerBookingView = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}`, headers: authHeader(managerToken) });
    expect(managerBookingView.statusCode).toBe(200);
    expect(managerBookingView.json().data.documentCount).toBe(1);
    expect(managerBookingView.json().data.hasIntakeNote).toBe(true);
  });
});

describe("telehealth — doktor/hasta portalları (§9.7.7 KARAR K)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("GET /doctor/me — DoctorProfile'ı OLMAYAN kullanıcı 403 NOT_A_DOCTOR alır", async () => {
    const user = await registerTestUser(app, { email: `telehealth-portal-notdoctor-${crypto.randomUUID()}@example.com` });
    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: authHeader(user.accessToken) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_DOCTOR");
  });

  it("GET /doctor/me — DoctorProfile VAR ama 2FA KAPALI → 403 TWO_FACTOR_REQUIRED; 2FA AÇIKKEN 200", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const doctorUser = await createUserDirect(app, "USER");
    const doctorUserToken = await loginAs(app, doctorUser.email);
    await app.prisma.doctorProfile.update({ where: { id: doctor.id }, data: { userId: doctorUser.id } });

    const withoutTwoFactor = await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: authHeader(doctorUserToken) });
    expect(withoutTwoFactor.statusCode).toBe(403);
    expect(withoutTwoFactor.json().error.code).toBe("TWO_FACTOR_REQUIRED");

    await app.prisma.user.update({ where: { id: doctorUser.id }, data: { twoFactorEnabled: true } });
    const withTwoFactor = await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: authHeader(doctorUserToken) });
    expect(withTwoFactor.statusCode).toBe(200);
    expect(withTwoFactor.json().data.doctorProfile.id).toBe(doctor.id);
    expect(withTwoFactor.json().data.twoFactorEnabled).toBe(true);
  });

  it("GET /doctor/bookings — yalnızca KENDİ rezervasyonlarını döner (doctorId sorgu parametresi YOK)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const doctorUser = await createUserDirect(app, "USER");
    // NOT: giriş, 2FA açılmadan ÖNCE yapılır — aksi hâlde `/auth/login` `requiresTwoFactor`
    // döner (bkz. yukarıdaki 2FA testi İLE AYNI sıra). Access token'ın kendisi 2FA durumunu
    // TAŞIMAZ; `/doctor/*` kapısı her istekte DB'den TAZE okur (bkz. telehealth.portal.routes.ts).
    const doctorUserToken = await loginAs(app, doctorUser.email);
    await app.prisma.user.update({ where: { id: doctorUser.id }, data: { twoFactorEnabled: true } });
    await app.prisma.doctorProfile.update({ where: { id: doctor.id }, data: { userId: doctorUser.id } });

    await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/bookings", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].doctorId).toBe(doctor.id);
  });

  it("GET /patient/bookings — 2FA GEREKTİRMEZ, yalnızca oturum sahibinin rezervasyonlarını döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const patient = await registerTestUser(app, { email: `telehealth-portal-patient-${crypto.randomUUID()}@example.com` });

    await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      headers: authHeader(patient.accessToken),
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()], patient.email),
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/patient/bookings", headers: authHeader(patient.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].patientUserId).toBe(patient.userId);
  });
});

/** `multipart/form-data` gövdesini elle inşa eder (tek dosya alanı, `file`) — test yardımcı fonksiyonu. */
function buildMultipartBody(filename: string, contentType: string, buffer: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----testboundary${crypto.randomBytes(8).toString("hex")}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, buffer, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}
