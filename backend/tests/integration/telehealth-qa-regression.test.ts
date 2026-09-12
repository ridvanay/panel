import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { runBookingExpirySweep } from "../../src/lib/booking-expiry";
import { MAGIC_LINK_TOKEN_TTL_MS } from "../../src/lib/telehealth-access";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` §9.7.11 "QA kapsamı — §10'a EK",
 * madde 18, ve security-agent'ın koordinatör aktarımıyla istediği 2 ek regresyon testi.
 *
 * Bu dosya backend-agent'ın `telehealth-bookings.test.ts`/`telehealth-livekit.test.ts`/
 * `telehealth-checkout.test.ts` dosyalarına (KASITLI OLARAK) dokunmaz — o dosyalar zaten
 * madde 14/15/16/17/20'yi ve meeting-token'ın genel IDOR/pencere/hız sınırı matrisini kapsıyor
 * (bkz. `TEST_COVERAGE.md`). Burada yalnızca o taburun KAPSAMADIĞI üç somut boşluk kapatılır:
 *
 * 1. Madde 18 — GERÇEK çoklu-slot booking akışıyla (mark-paid/webhook ÇAĞRILMADAN, hâlâ
 *    `PENDING_PAYMENT`) `meeting-token` isteği. Mevcut testler ya `createAppointmentDirect`
 *    (varsayılan `status: SCHEDULED`, booking'e BAĞLI DEĞİL) ya da `CANCELLED` durumunu
 *    kapsıyordu — "hiç ödenmemiş, booking'e bağlı" durumu (kod yolundaki EN ERKEN 409 dalı,
 *    `telehealth.livekit.routes.ts::appointment.status !== SCHEDULED/IN_PROGRESS`) test
 *    edilmemişti.
 * 2. security-agent'ın nihai kararı ([TCT] §9.7.7 madde 4) olan 30 günlük magic-link TTL'i
 *    (`lib/telehealth-access.ts::MAGIC_LINK_TOKEN_TTL_MS`) — kod VARDI ama HİÇBİR test bu
 *    yolu tetiklemiyordu.
 * 3. security-agent'ın checkout.routes.ts denetiminde bulup backend/integration-agent'ın
 *    düzelttiği `expiresAt` senkronizasyon riski (bkz. `telehealth.checkout.routes.ts`
 *    içindeki uzun yorum, satır ~165) — mevcut `telehealth-checkout.test.ts` yalnızca
 *    `stripeCheckoutSessionId`'in yazıldığını doğruluyordu, `expiresAt`'in GERÇEKTEN
 *    UZATILDIĞINI ve süpürücünün booking'i bu sırada SİLMEDİĞİNİ doğrulamıyordu.
 */

const stripeSessionsCreateMock = vi.hoisted(() => vi.fn());
const stripeSessionsRetrieveMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: stripeSessionsCreateMock,
        retrieve: stripeSessionsRetrieveMock,
      },
    },
  },
}));

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function setTelehealthModuleEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteModule.upsert({
    where: { key: "telehealth" },
    create: { key: "telehealth", enabled },
    update: { enabled },
  });
}

/** Europe/Istanbul, Pazartesi 09:00-17:00, 30dk seans — her çağrıda YENİ bir doktor/uzmanlık. */
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

// ===========================================================================
// 1) Madde 18 — ödenmemiş (PENDING_PAYMENT) booking → meeting-token → 409
// ===========================================================================
describe("[qa] telehealth — ödenmemiş booking'de meeting-token (§9.7.11 madde 18)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "fake-api-key";
    process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
    vi.resetModules();
    const { buildApp } = await import("../../src/app");
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    vi.resetModules();
  });

  it("gerçek çoklu-slot booking akışıyla oluşan, HİÇ ödenmemiş bir randevu için meeting-token 409 APPOINTMENT_NOT_JOINABLE döner (mark-paid/webhook ÇAĞRILMADAN)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json().data as { bookingId: string; accessToken: string; appointments: { id: string; status: string }[] };
    expect(body.appointments[0]!.status).toBe("PENDING_PAYMENT");
    const appointmentId = body.appointments[0]!.id;

    // Booking'in KENDİ token'ı ile (çoklu-slot akışında istemciye dönen TEK token budur).
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/meeting-token?t=${body.accessToken}`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPOINTMENT_NOT_JOINABLE");

    // Regresyon güvencesi — durum GERÇEKTEN hâlâ PENDING_PAYMENT (reddin nedeni pencere DEĞİL, ödeme).
    const dbAppointment = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(dbAppointment.status).toBe("PENDING_PAYMENT");
  });

  it("ADMIN oturumu bile ödenmemiş bir booking randevusunda meeting-token ALAMAZ (ödeme kapısı role bakılmaksızın uygulanır)", async () => {
    const admin = await registerTestUser(app, { email: `telehealth-qa-livekit-admin-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });

    const { doctor } = await createDoctorWithAvailability(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    const body = created.json().data as { appointments: { id: string }[] };

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${body.appointments[0]!.id}/meeting-token`,
      headers: authHeader(admin.accessToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPOINTMENT_NOT_JOINABLE");
  });
});

// ===========================================================================
// 2) security-agent — 30 günlük magic-link TTL'i (MAGIC_LINK_TOKEN_TTL_MS)
// ===========================================================================
describe("[qa] telehealth — magic-link TTL süresi dolmuş token reddi ([TCT] §9.7.7 madde 4)", () => {
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

  async function createBookingWithEndsAt(endsAt: Date) {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json().data as { bookingId: string; accessToken: string };

    // Randevunun `endsAt`'ini doğrudan geriye çekiyoruz — TTL hesaplaması yalnızca "son endsAt"e
    // bakar (bkz. `lib/telehealth-access.ts::isMagicLinkTokenExpired`), booking'in KENDİ oluşturma
    // kısıtlarından (>= 2 saat ileri saat) BAĞIMSIZDIR.
    await app.prisma.appointment.updateMany({ where: { bookingId: body.bookingId }, data: { endsAt } });

    return body;
  }

  it("30 gün sınırının HENÜZ İÇİNDE (birkaç saniye payla — gerçek zamanlı HTTP isteği yürütme süresine karşı sağlam) misafir token'ı HÂLÂ geçerlidir (200)", async () => {
    // Tam sınırda DEĞİL (`isMagicLinkTokenExpired` `Date.now()`'u İSTEK ANINDA okur — bu integration
    // testinde `endsAt` hesaplanışı ile HTTP isteğinin gerçekten yürütülmesi arasında geçen birkaç
    // ms/sn'lik GERÇEK süre, tam sınırda (`unit/telehealth-booking.test.ts::isWithinJoinWindow` İLE
    // AYNI desen, ama SABİT bir `now` yerine GERÇEK saat kullandığı için) kararsızlığa yol açar; bu
    // yüzden burada 30 saniyelik bir pay bırakılır — asıl sınır matematiği zaten `lib/
    // telehealth-access.ts`'in kendi birim testinde AYRICA doğrulanabilir bir SAF fonksiyon değil
    // (dışa aktarılmıyor), bu yüzden tam sınır UÇTAN UCA burada, gerçekçi bir toleransla doğrulanır).
    const endsAt = new Date(Date.now() - MAGIC_LINK_TOKEN_TTL_MS + 30_000);
    const { bookingId, accessToken } = await createBookingWithEndsAt(endsAt);

    const res = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}?t=${accessToken}` });
    expect(res.statusCode).toBe(200);
  });

  it("son randevu bitişinden 30 gün + 1 saniye sonra misafir token'ı REDDEDİLİR (404, IDOR deseniyle AYNI — varlık sızdırılmaz)", async () => {
    const endsAt = new Date(Date.now() - MAGIC_LINK_TOKEN_TTL_MS - 1000);
    const { bookingId, accessToken } = await createBookingWithEndsAt(endsAt);

    const res = await app.inject({ method: "GET", url: `/api/v1/appointments/bookings/${bookingId}?t=${accessToken}` });
    expect(res.statusCode).toBe(404);
  });

  it("TTL SÜRESİ DOLMUŞ token, DOĞRU olsa bile intake/belge uçlarında da reddedilir (health-data kapısı AYNI TTL'i paylaşır)", async () => {
    const endsAt = new Date(Date.now() - MAGIC_LINK_TOKEN_TTL_MS - 1000);
    const { bookingId, accessToken } = await createBookingWithEndsAt(endsAt);

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/intake?t=${accessToken}`,
      payload: { healthDataConsent: true, note: "test" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("oturum açmış (Bearer) hasta erişimi bu TTL'e TABİ DEĞİLDİR — yalnızca ham `?t=` yolu sınırlanır", async () => {
    const patient = await registerTestUser(app, { email: `telehealth-qa-ttl-patient-${crypto.randomUUID()}@example.com` });
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      headers: authHeader(patient.accessToken),
      payload: bookingPayload(doctor.slug, [startsAt], patient.email),
    });
    expect(created.statusCode).toBe(201);
    const { bookingId } = created.json().data as { bookingId: string };

    // Randevu çok eski (TTL çoktan dolmuş) olsa da OTURUMLU erişim etkilenmemeli.
    await app.prisma.appointment.updateMany({
      where: { bookingId },
      data: { endsAt: new Date(Date.now() - MAGIC_LINK_TOKEN_TTL_MS - 30 * 24 * 60 * 60 * 1000) },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}`,
      headers: authHeader(patient.accessToken),
    });
    expect(res.statusCode).toBe(200);
  });
});

// ===========================================================================
// 3) security-agent — checkout-session gecikmesinde booking.expiresAt senkronizasyonu
// ===========================================================================
describe("[qa] telehealth — checkout-session gecikme senaryosunda booking KAYBOLMAZ (expiresAt Stripe'a senkronize edilir)", () => {
  let app: FastifyInstance;
  let buildApp: () => FastifyInstance;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests_only";
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
    stripeSessionsCreateMock.mockReset();
    stripeSessionsRetrieveMock.mockReset();
    await resetDatabase(app.prisma);
    await app.close();
  });

  afterAll(() => {
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();
  });

  it("intake formunu doldururken geçen bir GECİKME sonrası (booking'in orijinal 30dk tutma süresi neredeyse dolmuşken) checkout-session çağrılırsa, DB'deki expiresAt UZATILIR ve süpürücü booking'i HEMEN SONRA SÜPÜRMEZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json().data as { bookingId: string; accessToken: string };

    const originalBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: body.bookingId } });
    // ~30dk'lık tutma süresinin NEREDEYSE TAMAMI geçmiş gibi simüle ediyoruz (hasta intake
    // formunu doldururken zaman geçti) — henüz DOLMADI ama birkaç dakika kaldı.
    const almostExpired = new Date(Date.now() + 2 * 60 * 1000);
    await app.prisma.appointmentBooking.update({ where: { id: body.bookingId }, data: { expiresAt: almostExpired } });

    stripeSessionsCreateMock.mockResolvedValue({
      id: "cs_test_qa_delay",
      url: "https://checkout.stripe.test/cs_test_qa_delay",
    });

    const checkoutRes = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/bookings/${body.bookingId}/checkout-session?t=${body.accessToken}`,
    });
    expect(checkoutRes.statusCode).toBe(200);

    const syncedBooking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: body.bookingId } });

    // KRİTİK — booking.expiresAt, checkout-session ÖNCESİNDEKİ (neredeyse dolmuş) `almostExpired`
    // değerinde SESSİZCE BIRAKILMADI; Stripe'a VAAT EDİLEN süreye YÜKSELTİLDİ (>= ~30dk sonrası).
    expect(syncedBooking.expiresAt.getTime()).toBeGreaterThan(almostExpired.getTime());
    expect(syncedBooking.expiresAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 29 * 60 * 1000);
    // Ham `originalBooking.expiresAt` (yaklaşık +30dk oluşturma anından) İLE DE karşılaştırıldığında
    // yeni değer ondan GERİDE DEĞİLDİR (senkronizasyon asla KISALTMAZ, yalnızca UZATIR/eşitler).
    expect(syncedBooking.expiresAt.getTime()).toBeGreaterThanOrEqual(originalBooking.expiresAt.getTime());

    // Süpürücü BU ANDA çalışsa dahi booking'e DOKUNMAMALI — "neredeyse dolmuş" eski işaretin
    // ARTIK GEÇERSİZ olduğunun kanıtı: satırlar hâlâ yerinde, paymentStatus hâlâ PENDING (silinip
    // EXPIRED'a düşmedi).
    const sweepResult = await runBookingExpirySweep(app);
    expect(sweepResult.expiredBookings).toBe(0);

    const afterSweep = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: body.bookingId } });
    expect(afterSweep.paymentStatus).toBe("PENDING");
    const appointmentCount = await app.prisma.appointment.count({ where: { bookingId: body.bookingId } });
    expect(appointmentCount).toBe(1);
  });

  it("REGRESYON KARŞILAŞTIRMASI — checkout-session hiç ÇAĞRILMAZSA (senkronizasyon devreye girmez) AYNI 'neredeyse dolmuş' booking süpürücü tarafından GERÇEKTEN silinir (fix'in var olmadığı durumu simüle eder, testin kendisinin anlamlı olduğunu kanıtlar)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [startsAt]),
    });
    const body = created.json().data as { bookingId: string };

    await app.prisma.appointmentBooking.update({
      where: { id: body.bookingId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const sweepResult = await runBookingExpirySweep(app);
    expect(sweepResult.expiredBookings).toBe(1);

    const afterSweep = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: body.bookingId } });
    expect(afterSweep.paymentStatus).toBe("EXPIRED");
    expect(stripeSessionsCreateMock).not.toHaveBeenCalled();
  });
});
