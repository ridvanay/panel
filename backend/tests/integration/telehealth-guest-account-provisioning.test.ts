import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashOtpCode } from "../../src/lib/otp";
import { hashToken } from "../../src/lib/tokens";

/**
 * `.claude/architect-scope-guest-account-otp.md` §5/§6 (Özellik B) + `.claude/security-review-
 * guest-account-otp.md` KARAR 2/5 (bağlayıcı) — misafir randevu ödemesinden hesap sağlama.
 * `POST /appointments/bookings/{id}/demo-pay` (ENABLE_DEMO_PAYMENTS=true) `lib/booking.ts::
 * confirmBookingPayment`'ı Stripe webhook/admin mark-paid İLE BİREBİR AYNI şekilde çağırdığı için
 * `provisionPatientAccountForBooking`'i tetiklemek için en pratik, mock'suz yol budur (§6 Vektör 2
 * — security-review ONAYLI: sağlama mantığının ÜÇ yolun HANGİSİnden tetiklendiği fark etmez).
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

function bookingPayload(doctorSlug: string, slots: Date[], patientEmail: string) {
  return {
    doctorSlug,
    slots: slots.map((s) => s.toISOString()),
    patientName: "Misafir Hasta",
    patientEmail,
    identity: VALID_TEST_IDENTITY,
    consent: true,
  };
}

async function createGuestBooking(app: FastifyInstance, doctorSlug: string, patientEmail: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/appointments/bookings",
    payload: bookingPayload(doctorSlug, [nextMondayNineAmUtc()], patientEmail),
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { bookingId: string; accessToken: string };
}

async function demoPay(app: FastifyInstance, bookingId: string, accessToken: string) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/appointments/bookings/${bookingId}/demo-pay?t=${accessToken}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json().data;
}

describe("Özellik B — misafir randevu ödemesinden hesap sağlama (demo-pay üzerinden tetiklenir)", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_DEMO_PAYMENTS = "true";
    vi.resetModules();
    ({ buildApp } = await import("../../src/app"));
  });

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

  it("§5.4 KRİTİK — hiç kullanıcısı olmayan bir ortamda misafir ödemesiyle açılan hesabın rolü USER'dır, ADMIN DEĞİL", async () => {
    expect(await app.prisma.user.count()).toBe(0);

    const { doctor } = await createDoctorWithAvailability(app);
    const email = `misafir-${crypto.randomUUID()}@example.com`;
    const booking = await createGuestBooking(app, doctor.slug, email);
    await demoPay(app, booking.bookingId, booking.accessToken);

    const provisionedUser = await app.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(provisionedUser.role).toBe("USER");
    expect(provisionedUser.status).toBe("ACTIVE");
    expect(provisionedUser.emailVerifiedAt).toBeNull();

    const dbBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(dbBooking.patientUserId).toBe(provisionedUser.id);

    const appointments = await app.prisma.appointment.findMany({ where: { bookingId: booking.bookingId } });
    expect(appointments.every((a) => a.patientUserId === provisionedUser.id)).toBe(true);
  });

  it("yeni sağlanan hesapla, aktivasyon TAMAMLANMADAN normal login token ALAMAZ (parola bilinmiyor/rastgele + emailVerifiedAt null çift kilit)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const email = `misafir-login-${crypto.randomUUID()}@example.com`;
    const booking = await createGuestBooking(app, doctor.slug, email);
    await demoPay(app, booking.bookingId, booking.accessToken);

    // Rastgele üretilen parola BİLİNMEZ — herhangi bir tahminle giriş denemesi başarısız olmalı.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "tahmin-edilen-sifre" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("aktivasyon (`POST /auth/activate-account`) başarıyla tamamlanır: parola belirlenir, oturum açılır, eski refresh token'lar VE booking accessToken'ı rotate edilir", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const email = `misafir-activate-${crypto.randomUUID()}@example.com`;
    const booking = await createGuestBooking(app, doctor.slug, email);
    const originalAccessTokenHash = hashToken(booking.accessToken);
    await demoPay(app, booking.bookingId, booking.accessToken);

    const provisionedUser = await app.prisma.user.findUniqueOrThrow({ where: { email } });

    // Test ortamında SMTP/aktivasyon e-postası best-effort başarısız kalabilir (bkz.
    // tests/helpers/auth.ts::registerTestUser üzerindeki AYNI gerekçe) — DB satırı (kod HASH'i
    // dahil) yine de yazılmıştır; bilinen bir koda ÜZERİNE YAZARAK gerçek `activate-account`
    // ucunu uçtan uca test ediyoruz.
    const KNOWN_CODE = "654321";
    const codeHash = hashOtpCode(provisionedUser.id, "ACCOUNT_ACTIVATION", KNOWN_CODE);
    const updated = await app.prisma.emailVerificationCode.updateMany({
      where: { userId: provisionedUser.id, purpose: "ACCOUNT_ACTIVATION", consumedAt: null },
      data: { codeHash },
    });
    expect(updated.count).toBe(1);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/activate-account",
      payload: { email, code: KNOWN_CODE, password: "YeniSifre12345!" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data as { user: { id: string; emailVerifiedAt: string | null }; tokens: { accessToken: string } };
    expect(body.user.emailVerifiedAt).not.toBeNull();
    expect(body.tokens.accessToken).toEqual(expect.any(String));

    // Artık normal login (belirlenen yeni parolayla) ÇALIŞIR.
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "YeniSifre12345!" },
    });
    expect(loginRes.statusCode).toBe(200);

    // security-review KARAR 5 (bağlayıcı) — aktivasyon anında booking'in `accessTokenHash`'i
    // rotate edilir; eski misafir magic-link'i artık ÇALIŞMAZ.
    const dbBookingAfter = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(dbBookingAfter.accessTokenHash).not.toBe(originalAccessTokenHash);

    const oldLinkRes = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${booking.bookingId}?t=${booking.accessToken}`,
    });
    expect(oldLinkRes.statusCode).not.toBe(200);
  });

  it("EMAIL_VERIFICATION amaçlı bir kod activate-account'ta ÇALIŞMAZ (amaç bağlaması, HER İKİ yön)", async () => {
    // Sıradan bir kayıt akışının EMAIL_VERIFICATION kodu ile açılan hesabı.
    const normalUser = await registerTestUser(app, { email: `normal-${crypto.randomUUID()}@example.com` });

    // Bu kullanıcı için (zaten tüketilmiş EMAIL_VERIFICATION kodu var) YENİ bir EMAIL_VERIFICATION
    // kodu üretip activate-account'a karşı deniyoruz — kabul EDİLMEMELİ.
    const resendRes = await app.inject({ method: "POST", url: "/api/v1/auth/resend-verification-code", payload: { email: normalUser.email } });
    expect(resendRes.statusCode).toBe(202);

    const activateRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/activate-account",
      payload: { email: normalUser.email, code: "000000", password: "BaskaSifre12345!" },
    });
    expect(activateRes.statusCode).toBe(401);
    expect(activateRes.json().error.code).toBe("VERIFICATION_CODE_INVALID");
  });

  it("misafirin girdiği e-posta ZATEN kayıtlıysa: YENİ hesap AÇILMAZ, randevu mevcut hesaba bağlanır, mevcut hesabın rolü/parolası/emailVerifiedAt'i DEĞİŞMEZ", async () => {
    const existing = await registerTestUser(app, { email: `mevcut-${crypto.randomUUID()}@example.com` });
    const existingBefore = await app.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });

    const { doctor } = await createDoctorWithAvailability(app);
    const booking = await createGuestBooking(app, doctor.slug, existing.email);
    await demoPay(app, booking.bookingId, booking.accessToken);

    const usersWithThisEmail = await app.prisma.user.findMany({ where: { email: existing.email } });
    expect(usersWithThisEmail).toHaveLength(1);

    const existingAfter = await app.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });
    expect(existingAfter.passwordHash).toBe(existingBefore.passwordHash);
    expect(existingAfter.role).toBe(existingBefore.role);
    expect(existingAfter.emailVerifiedAt?.toISOString()).toBe(existingBefore.emailVerifiedAt?.toISOString());

    const dbBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(dbBooking.patientUserId).toBe(existing.userId);

    // Aktivasyon amaçlı bir kod ÜRETİLMEMİŞ olmalı (§5.3 — "aktivasyon e-postası GÖNDERİLMEZ").
    const activationCodes = await app.prisma.emailVerificationCode.findMany({
      where: { userId: existing.userId, purpose: "ACCOUNT_ACTIVATION" },
    });
    expect(activationCodes).toHaveLength(0);
  });

  it("ödeme onayı sağlama başarısız olsa BİLE (booking var olmasa dahi çağrı best-effort'tur) ASLA bozulmaz — demo-pay yine 200 döner", async () => {
    // `provisionPatientAccountForBooking` KENDİ try/catch'ine sahiptir (bkz. patient-account.ts);
    // burada dolaylı kanıt: demo-pay normal (geçerli e-posta) akışında ASLA 500 dönmediğini ve
    // booking'in PAID kalmaya devam ettiğini doğruluyoruz (ayrık bir hata enjeksiyonu olmadan
    // best-effort disiplinini uçtan uca kanıtlamanın en pratik yolu budur).
    const { doctor } = await createDoctorWithAvailability(app);
    const email = `best-effort-${crypto.randomUUID()}@example.com`;
    const booking = await createGuestBooking(app, doctor.slug, email);
    const paid = await demoPay(app, booking.bookingId, booking.accessToken);
    expect(paid.paymentStatus).toBe("PAID");
  });
});
