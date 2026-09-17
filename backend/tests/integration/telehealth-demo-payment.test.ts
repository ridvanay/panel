import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";
import { buildTestApp } from "../helpers/build-test-app";
import { registerTestUser } from "../helpers/auth";
import { hashToken } from "../../src/lib/tokens";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 (BAĞLAYICI) —
 * `POST /appointments/bookings/{bookingId}/demo-pay`. Üç katmanlı gating'in HER BİRİ ayrı
 * doğrulanır: (1) env (`ENABLE_DEMO_PAYMENTS` boot koruması — bkz. AYRICA
 * `tests/unit/env-demo-payments-boot-guard.test.ts`), (2) register-time gizleme (`app.ts`),
 * (3) handler'ın kendi runtime kontrolü (defense-in-depth).
 */

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

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

function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };

function bookingPayload(doctorSlug: string, slots: Date[], patientEmail = `hasta-${crypto.randomUUID()}@example.com`) {
  return {
    doctorSlug,
    slots: slots.map((s) => s.toISOString()),
    patientName: "Test Hasta",
    patientEmail,
    identity: VALID_TEST_IDENTITY,
    consent: true,
  };
}

async function createBooking(app: FastifyInstance, doctorSlug: string, slots: Date[], headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/appointments/bookings",
    headers,
    payload: bookingPayload(doctorSlug, slots),
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { bookingId: string; accessToken: string };
}

describe("telehealth demo-pay — KATMAN 2 (register-time gizleme, bayrak/prod varsayılan KAPALI)", () => {
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

  it("varsayılan test ortamında (`ENABLE_DEMO_PAYMENTS` tanımsız → false) uç HİÇ register edilmez → 404", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("telehealth demo-pay — KATMAN 3 (runtime defense-in-depth, register-time gizleme BYPASS edilse dahi)", () => {
  it("route MANUEL olarak (app.ts'in koşulunu ATLAYARAK) register edilse bile handler'ın İLK satırı 404 fırlatır", async () => {
    // `buildTestApp()` KULLANILMAZ — o `app.ready()`'i ÇAĞIRIR (Fastify plugin ağacını
    // "boot" eder, sonrasında YENİ bir plugin register EDİLEMEZ, "Root plugin has already
    // booted"). Bu yüzden `buildApp()` DOĞRUDAN kullanılır — ekstra route `ready()`'DEN ÖNCE
    // register edilir.
    const { buildApp } = await import("../../src/app");
    const app = buildApp(); // isDemoPaymentsEnabled=false (varsayılan test env)

    const { telehealthDemoPaymentRoutes } = await import("../../src/modules/telehealth/telehealth.demo-payment.routes");
    // `app.ts`'deki `if (isDemoPaymentsEnabled) api.register(...)` koşulu BİLİNÇLİ OLARAK
    // ATLANARAK route BURADA manuel register edilir — tek geriye kalan savunma, handler'ın
    // kendi `if (!isDemoPaymentsEnabled) throw new NotFoundError()` satırıdır.
    await app.register(telehealthDemoPaymentRoutes, { prefix: "/api/v1" });

    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);

    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(404);

    // Handler'ın 404'ü DB'ye HİÇ DOKUNMADAN (kendi guard'ında) döndüğünün kanıtı — booking HÂLÂ PENDING.
    const stillPending = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(stillPending.paymentStatus).toBe("PENDING");

    await resetDatabase(app.prisma);
    await app.close();
  });
});

describe("telehealth demo-pay — prod-benzeri konfigürasyon (NODE_ENV=production) → uç register edilmez", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  // backend-agent (2026-09-17) — `config/env.ts`'in YENİ `FRONTEND_URL` fail-closed boot koruması
  // (bkz. `env-frontend-url-boot-guard.test.ts`), `.env.test`'in `FRONTEND_URL=http://localhost:3000`
  // değeriyle (hostname LİTERAL "localhost") birleşince, aşağıdaki `NODE_ENV=production` (İŞLEM
  // İÇİNDE, subprocess YOK) simülasyonunda `process.exit(1)` ile TÜM vitest worker'ını öldürürdü —
  // `PUBLIC_URL` İÇİN zaten `siteadi.localhost` trick'i (bkz. .env.test'teki not) uygulanmıştı, ama
  // `.env.test`'in KENDİSİNİ değiştirmek çok sayıda BAŞKA testi (email/magic-link/revalidate URL'leri
  // `http://localhost:3000` LİTERAL string'ini bekliyor) kırardı. Bu yüzden `PUBLIC_URL` yerine
  // yalnızca BU test bloğu için `FRONTEND_URL`'i geçici olarak gerçek bir domain'e override ediyoruz.
  const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://wmhealthistanbul.com";
    delete process.env.ENABLE_DEMO_PAYMENTS; // fail-closed boot korumasını TETİKLEMEMEK için false kalır.
    vi.resetModules();
    ({ buildApp } = await import("../../src/app"));
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
    vi.resetModules();
  });

  it("`NODE_ENV=production` iken (bayrak kapalı/varsayılan) demo-pay `404` döner — üretimde bu uç YOKTUR", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(404);
  });

  /**
   * REGRESYON TESTİ (architect'in istediği, `.claude/security-review-demo-payment-toggle.md`
   * Madde 1/kontrol listesi madde 9(c)) — DB bayrağının env korumasını BYPASS EDEMEDİĞİNİN
   * kanıtı: env kapalıyken (prod simülasyonu) `SiteSettings.demoPaymentsEnabled` DB'de `true`
   * olsa BİLE uç YİNE `404` döner (`403 DEMO_PAYMENTS_DISABLED` DEĞİL) — çünkü register-time
   * gizleme (katman 2) zaten bu isteği yakalar, katman 4'e (DB kontrolü) hiç ULAŞILMAZ.
   */
  it("REGRESYON: env kapalıyken DB `demoPaymentsEnabled=true` olsa BİLE demo-pay YİNE `404` döner (DB env'i bypass EDEMEZ)", async () => {
    await app.prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", demoPaymentsEnabled: true },
      update: { demoPaymentsEnabled: true },
    });

    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("telehealth demo-pay — BAYRAK AÇIKKEN (ENABLE_DEMO_PAYMENTS=true, NODE_ENV=test)", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_DEMO_PAYMENTS = "true";
    vi.resetModules();
    ({ buildApp } = await import("../../src/app"));
  });

  // `POST /appointments/bookings`'in 5/dk route-level hız sınırı VE demo-pay'in kendi 10/dk
  // hız sınırı (`BOOKING_CHECKOUT_SESSION_RATE_LIMIT` yeniden kullanılır) — `telehealth-checkout.test.ts`
  // İLE AYNI gerekçe: HER test TAZE bir app alır (rate-limit sayaçları sıfırlanır).
  beforeEach(async () => {
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  afterAll(() => {
    delete process.env.ENABLE_DEMO_PAYMENTS;
    vi.resetModules();
  });

  it("misafir (`?t=`) hasta demo ödemesi yapar → booking PAID, tüm randevular SCHEDULED, `paidBy: 'demo'`, Stripe alanları `null`, ham token ROTATE EDİLMEZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app, 80000);
    const startsAt = nextMondayNineAmUtc();
    const booking = await createBooking(app, doctor.slug, [startsAt]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.paymentStatus).toBe("PAID");
    expect(body.paidBy).toBe("demo");
    expect(body.appointments.every((a: { status: string }) => a.status === "SCHEDULED")).toBe(true);

    const dbBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(dbBooking.paymentStatus).toBe("PAID");
    expect(dbBooking.paidBy).toBe("demo");
    expect(dbBooking.stripePaymentIntentId).toBeNull();
    expect(dbBooking.stripeCheckoutSessionId).toBeNull();
    expect(dbBooking.paidAt).not.toBeNull();
    // Misafir `?t=` YOLU — ham token ROTATE EDİLMEZ, orijinal `accessToken` HÂLÂ ÇALIŞIR.
    expect(dbBooking.accessTokenHash).toBe(hashToken(booking.accessToken));

    const dbAppointments = await app.prisma.appointment.findMany({ where: { bookingId: booking.bookingId } });
    expect(dbAppointments.every((a) => a.status === "SCHEDULED")).toBe(true);

    // Aynı (rotate edilmemiş) token ile booking detayına ERİŞİLEBİLİR olmalı.
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${booking.bookingId}?t=${booking.accessToken}`,
    });
    expect(detail.statusCode).toBe(200);
  });

  it("oturumlu hasta (`Bearer`, `?t=` OLMADAN) demo ödemesi yapar → booking'in erişim token'ı ROTATE EDİLİR (mark-paid İLE AYNI davranış)", async () => {
    const patient = await registerTestUser(app, { email: `demo-pay-patient-${crypto.randomUUID()}@example.com` });
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()], { authorization: `Bearer ${patient.accessToken}` });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay`,
      headers: { authorization: `Bearer ${patient.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.paidBy).toBe("demo");

    const dbBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    // Oturumlu akışta `knownRawAccessToken` verilmedi → `confirmBookingPayment` YENİ bir token
    // üretir (rotate) — orijinal booking oluşturma anındaki token ARTIK eşleşmez.
    expect(dbBooking.accessTokenHash).not.toBe(hashToken(booking.accessToken));
  });

  it("booking sahibi OLMAYAN bir hasta (yanlış `?t=`) 404 alır (IDOR — `403` DEĞİL)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const wrongToken = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=yanlis-token-degeri`,
    });
    expect(wrongToken.statusCode).toBe(404);

    const noToken = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay`,
    });
    expect(noToken.statusCode).toBe(404);

    const stillPending = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(stillPending.paymentStatus).toBe("PENDING");
  });

  it("ADMIN bu ucu KULLANAMAZ (yalnızca hasta — `checkout-session` İLE AYNI eşik, `ADMIN`'in zaten `mark-paid` ucu vardır)", async () => {
    const admin = await registerTestUser(app, { email: `demo-pay-admin-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("booking zaten PAID ise 409 BOOKING_NOT_PAYABLE döner (tekrar demo-pay çağrısı no-op DEĞİL, reddedilir)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("BOOKING_NOT_PAYABLE");
  });

  it("booking'in slot tutma süresi (`expiresAt`) dolmuşsa 409 BOOKING_EXPIRED döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    await app.prisma.appointmentBooking.update({
      where: { id: booking.bookingId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("BOOKING_EXPIRED");
  });

  it("modül KAPALIYKEN 404 döner (bayrak açık olsa dahi `requireModuleEnabled` önceliklidir)", async () => {
    await setTelehealthModuleEnabled(app, false);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings/00000000-0000-0000-0000-000000000000/demo-pay",
    });
    expect(res.statusCode).toBe(404);
  });

  /**
   * Katman 4 (2026-09-15, `.claude/security-review-demo-payment-toggle.md` Madde 5) — env
   * kapısı AÇIK olduğu halde admin panelden `SiteSettings.demoPaymentsEnabled = false`
   * yapılmışsa `403 DEMO_PAYMENTS_DISABLED` (404 DEĞİL). DB okuması cache'siz/her istekte
   * taze olduğu için booking DB'den okunmadan ÖNCE reddedilir (booking hâlâ PENDING kalır).
   */
  it("env AÇIK ama DB `demoPaymentsEnabled=false` (admin kapatmış) → `403 DEMO_PAYMENTS_DISABLED`, booking DB'ye HİÇ dokunulmadan reddedilir", async () => {
    await app.prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", demoPaymentsEnabled: false },
      update: { demoPaymentsEnabled: false },
    });

    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("DEMO_PAYMENTS_DISABLED");

    const stillPending = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(stillPending.paymentStatus).toBe("PENDING");
  });

  it("DB satırı hiç yoksa (taze kurulum, ham varsayılan `true`) env AÇIKKEN demo-pay NORMAL çalışır (200)", async () => {
    const row = await app.prisma.siteSettings.findUnique({ where: { id: "singleton" } });
    expect(row).toBeNull();

    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("DB'de admin ÖNCE kapatıp SONRA tekrar açarsa demo-pay yeniden 200 döner (cache'siz, anında yansır)", async () => {
    await app.prisma.siteSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", demoPaymentsEnabled: false },
      update: { demoPaymentsEnabled: false },
    });

    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createBooking(app, doctor.slug, [nextMondayNineAmUtc()]);

    const disabled = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(disabled.statusCode).toBe(403);

    await app.prisma.siteSettings.update({ where: { id: "singleton" }, data: { demoPaymentsEnabled: true } });

    const enabled = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${booking.bookingId}/demo-pay?t=${booking.accessToken}`,
    });
    expect(enabled.statusCode).toBe(200);
  });
});
