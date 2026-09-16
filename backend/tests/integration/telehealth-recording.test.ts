import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — integration-agent'ın TEK
 * SAHASI: `POST /appointments/{id}/recording/start|consent|stop` + `POST /webhooks/livekit`.
 *
 * `livekit-server-sdk` TAMAMEN mock'lanır (`EgressClient`/`RoomServiceClient`/`WebhookReceiver`) —
 * gerçek bir LiveKit hesabına/Egress sürecine bağlanılmaz. Enum/mesaj sınıfları (`EgressStatus`,
 * `EncodedFileType`, `S3Upload`, `EncodedFileOutput`, `WebhookConfig`, `DataPacket_Kind`) GERÇEK
 * kalır (saf veri taşıyıcıları, ağ çağrısı YAPMAZLAR) — yalnızca ağ/kripto YAPAN üç sınıf mock'lanır.
 *
 * `telehealthRecordingRoutes`/`telehealthEgressWebhookRoutes` henüz `app.ts`'e KAYITLI DEĞİL
 * (backend-agent FAZ B'de ekleyecek) — bu dosya, `buildApp()`'in döndürdüğü (henüz `ready()`
 * ÇAĞRILMAMIŞ) instance'a ek bir `register` bloğu ekleyerek test eder. Bu, `app.ts`'i DEĞİŞTİRMEZ
 * (dosyaya hiç dokunulmadı) ve mevcut hiçbir test altyapısını (`tests/helpers/*`) icat/değiştirmez —
 * yalnızca Fastify'ın `ready()` ÇAĞRILMADAN önce ek plugin kaydına izin veren standart davranışını
 * kullanır.
 */

const egressClientMocks = vi.hoisted(() => ({
  startRoomCompositeEgress: vi.fn(),
  stopEgress: vi.fn(),
}));
const roomServiceMocks = vi.hoisted(() => ({
  sendData: vi.fn(),
}));
const webhookReceiverMocks = vi.hoisted(() => ({
  receive: vi.fn(),
}));

vi.mock("livekit-server-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-server-sdk")>();
  // `vi.fn().mockImplementation(() => ({...}))` (ARROW fonksiyon) `new EgressClient(...)` ile
  // ÇAĞRILDIĞINDA "is not a constructor" hatası verir (arrow fonksiyonlar `new` DESTEKLEMEZ) —
  // bu yüzden BİLEREK klasik `function` sözdizimi kullanılır (constructor'dan dönen NESNE,
  // `new` tarafından OLDUĞU GİBİ kullanılır — standart JS constructor-return davranışı).
  return {
    ...actual,
    EgressClient: vi.fn().mockImplementation(function EgressClientMock() {
      return {
        startRoomCompositeEgress: egressClientMocks.startRoomCompositeEgress,
        stopEgress: egressClientMocks.stopEgress,
      };
    }),
    RoomServiceClient: vi.fn().mockImplementation(function RoomServiceClientMock() {
      return { sendData: roomServiceMocks.sendData };
    }),
    WebhookReceiver: vi.fn().mockImplementation(function WebhookReceiverMock() {
      return { receive: webhookReceiverMocks.receive };
    }),
  };
});

const archiveRecordingFromEgressMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/lib/telehealth-recording-archive", () => ({
  archiveRecordingFromEgress: archiveRecordingFromEgressMock,
}));

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function setModuleEnabled(app: FastifyInstance, key: string, enabled: boolean) {
  await app.prisma.siteModule.upsert({ where: { key }, create: { key, enabled }, update: { enabled } });
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-recording-${crypto.randomUUID()}@example.com`,
      name: "Test Kullanıcı",
      passwordHash,
      role,
      status: "ACTIVE",
      // `.claude/architect-scope-guest-account-otp.md` §2.3 — `login()` artık `emailVerifiedAt`
      // gerektiriyor; bu doğrudan-oluşturma yardımcısı GRANDFATHERED bir hesabı temsil eder.
      emailVerifiedAt: new Date(),
    },
  });
}

async function loginAs(app: FastifyInstance, email: string, password = "Sifre12345!"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

/** Europe/Istanbul, Pazartesi 09:00-17:00, 30dk seans — her çağrıda YENİ bir doktor/uzmanlık. */
async function createDoctorWithAvailability(app: FastifyInstance, userId: string | null = null) {
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
      sessionPriceCents: 50000,
      currency: "TRY",
      isActive: true,
      userId,
    },
  });
  return { doctor, specialty };
}

/**
 * `telehealth-livekit.test.ts::createAppointmentDirect` İLE AYNI desen — booking OLUŞTURMADAN
 * (TUR 2 öncesi tekil randevu şekli) doğrudan bir `Appointment` satırı yazar; katılım
 * penceresi/yetki mantığını izole test etmek için.
 */
async function createAppointmentDirect(
  app: FastifyInstance,
  doctor: { id: string },
  overrides: Partial<{ patientUserId: string | null; startsAt: Date; endsAt: Date; status: "SCHEDULED" | "IN_PROGRESS" }> = {}
) {
  const { generateOpaqueToken, hashToken } = await import("../../src/lib/tokens");
  const rawAccessToken = generateOpaqueToken();
  const startsAt = overrides.startsAt ?? new Date();
  const endsAt = overrides.endsAt ?? new Date(startsAt.getTime() + 30 * 60 * 1000);
  const appointment = await app.prisma.appointment.create({
    data: {
      doctorId: doctor.id,
      patientUserId: overrides.patientUserId ?? null,
      patientName: "Test Hasta",
      patientEmail: `hasta-${crypto.randomUUID()}@example.com`,
      startsAt,
      endsAt,
      status: overrides.status ?? "SCHEDULED",
      priceCents: 50000,
      currency: "TRY",
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: hashToken(rawAccessToken),
    },
  });
  return { appointment, rawAccessToken };
}

/**
 * `telehealth-livekit.test.ts` İLE AYNI desen: LiveKit + kayıt için gerekli TÜM env değişkenleri
 * (LiveKit + S3 + `LIVEKIT_EGRESS_WEBHOOK_URL`) test sabitleriyle doldurulur.
 *
 * NOT (backend-agent FAZ B, 2026-09-13): `telehealthRecordingRoutes`/`telehealthEgressWebhookRoutes`
 * artık `app.ts`'in KENDİSİ tarafından kaydediliyor (`buildApp()` çağrısı yeterli) — bu fonksiyon
 * ÖNCEDEN (bu iki dosya `app.ts`'e henüz kayıtlı değilken) `ready()`'den ÖNCE ek bir `register`
 * bloğuyla bu route'ları KENDİSİ ekliyordu; artık bunu yapması `app.ts`'in kendi kaydıyla
 * ÇAKIŞIP "Method 'POST' already declared" hatası verirdi, bu yüzden KALDIRILDI.
 */
async function buildRecordingTestApp(): Promise<FastifyInstance> {
  process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "fake-api-key";
  process.env.LIVEKIT_API_SECRET = "fake-api-secret-for-tests-only";
  process.env.STORAGE_DRIVER = "s3";
  process.env.S3_BUCKET = "telehealth-recordings-test";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY_ID = "test-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.LIVEKIT_EGRESS_WEBHOOK_URL = "https://api.example.test/api/v1/webhooks/livekit";
  vi.resetModules();

  const { buildApp } = await import("../../src/app");

  const app = buildApp();
  await app.ready();
  return app;
}

function resetLiveKitEnv() {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
  delete process.env.STORAGE_DRIVER;
  delete process.env.S3_BUCKET;
  delete process.env.S3_REGION;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
  delete process.env.LIVEKIT_EGRESS_WEBHOOK_URL;
}

describe("telehealth/recording — /recording/start", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildRecordingTestApp();
    await resetDatabase(app.prisma);
    await setModuleEnabled(app, "telehealth", true);
    await setModuleEnabled(app, "telehealth-recording", true);
    const admin = await createUserDirect(app, "ADMIN");
    adminToken = await loginAs(app, admin.email);
  });

  afterEach(async () => {
    egressClientMocks.startRoomCompositeEgress.mockReset();
    egressClientMocks.stopEgress.mockReset();
    roomServiceMocks.sendData.mockReset();
    webhookReceiverMocks.receive.mockReset();
    archiveRecordingFromEgressMock.mockClear();
    await resetDatabase(app.prisma);
    await app.close();
    resetLiveKitEnv();
    vi.resetModules();
  });

  it("doktorun bağlı User'ı veya ADMIN → 200, PENDING_CONSENT; audit + oda sinyali gönderilir", async () => {
    const doctorUser = await createUserDirect(app, "USER");
    const doctorToken = await loginAs(app, doctorUser.email);
    const { doctor } = await createDoctorWithAvailability(app, doctorUser.id);
    const { appointment } = await createAppointmentDirect(app, doctor);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(doctorToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("PENDING_CONSENT");
    expect(typeof res.json().data.consentExpiresAt).toBe("string");

    const row = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { appointmentId: appointment.id } });
    expect(row.status).toBe("PENDING_CONSENT");
    expect(row.doctorConsentAt).not.toBeNull();

    const audit = await app.prisma.auditLog.findFirst({
      where: { action: "telehealth.recording.consent_requested", targetId: appointment.id },
    });
    expect(audit).not.toBeNull();
    expect(roomServiceMocks.sendData).toHaveBeenCalledTimes(1);
    // Egress BU ADIMDA HİÇ ÇAĞRILMAZ.
    expect(egressClientMocks.startRoomCompositeEgress).not.toHaveBeenCalled();
  });

  it("ADMIN de başlatabilir (misafir accessToken bu uçta GEÇERSİZDİR — IDOR: 404)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);

    const asAdmin = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(asAdmin.statusCode).toBe(200);

    const { appointment: appointment2, rawAccessToken: token2 } = await createAppointmentDirect(app, doctor);
    const withGuestToken = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment2.id}/recording/start?t=${token2}`,
    });
    expect(withGuestToken.statusCode).toBe(404);
  });

  it("hasta/yabancı kullanıcı erişemez (404)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const patient = await createUserDirect(app, "USER");
    const patientToken = await loginAs(app, patient.email);
    const { appointment } = await createAppointmentDirect(app, doctor, { patientUserId: patient.id });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(patientToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("modül (`telehealth-recording`) KAPALIYKEN 404 döner", async () => {
    await setModuleEnabled(app, "telehealth-recording", false);
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("katılım penceresi DIŞINDAYKEN 409 APPOINTMENT_NOT_JOINABLE döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const { appointment } = await createAppointmentDirect(app, doctor, {
      startsAt: farFuture,
      endsAt: new Date(farFuture.getTime() + 30 * 60 * 1000),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPOINTMENT_NOT_JOINABLE");
  });

  it("LiveKit yapılandırılmamışken 503 LIVEKIT_NOT_CONFIGURED döner (randevu hiç sorgulanmaz)", async () => {
    delete process.env.LIVEKIT_URL;
    vi.resetModules();
    const { buildApp } = await import("../../src/app");
    const unconfiguredApp = buildApp();
    await unconfiguredApp.ready();
    await setModuleEnabled(unconfiguredApp, "telehealth", true);
    await setModuleEnabled(unconfiguredApp, "telehealth-recording", true);

    const res = await unconfiguredApp.inject({
      method: "POST",
      url: `/api/v1/appointments/00000000-0000-0000-0000-000000000000/recording/start`,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("LIVEKIT_NOT_CONFIGURED");

    await unconfiguredApp.close();
    process.env.LIVEKIT_URL = "wss://fake-project.livekit.cloud";
    vi.resetModules();
  });

  it("halihazırda RECORDING/PROCESSING durumunda kayıt varsa 409 RECORDING_ALREADY_ACTIVE döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "RECORDING", egressId: `egress_${crypto.randomUUID()}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RECORDING_ALREADY_ACTIVE");
  });

  it("COMPLETED/FAILED durumunda kayıt varsa 409 RECORDING_ALREADY_EXISTS döner (randevu başına EN FAZLA 1 kayıt)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "COMPLETED" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RECORDING_ALREADY_EXISTS");
  });

  it("CONSENT_DENIED durumundaki satır YENİDEN KULLANILIR (patientConsentDeniedAt KORUNUR)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    const deniedAt = new Date();
    await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "CONSENT_DENIED", patientConsentDeniedAt: deniedAt },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("PENDING_CONSENT");

    const row = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { appointmentId: appointment.id } });
    expect(row.patientConsentDeniedAt?.toISOString()).toBe(deniedAt.toISOString());
  });
});

describe("telehealth/recording — /recording/consent", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildRecordingTestApp();
    await resetDatabase(app.prisma);
    await setModuleEnabled(app, "telehealth", true);
    await setModuleEnabled(app, "telehealth-recording", true);
  });

  afterEach(async () => {
    egressClientMocks.startRoomCompositeEgress.mockReset();
    egressClientMocks.stopEgress.mockReset();
    roomServiceMocks.sendData.mockReset();
    webhookReceiverMocks.receive.mockReset();
    archiveRecordingFromEgressMock.mockClear();
    await resetDatabase(app.prisma);
    await app.close();
    resetLiveKitEnv();
    vi.resetModules();
  });

  async function startRecordingAsAdmin(): Promise<{ appointmentId: string; rawAccessToken: string; recordingId: string }> {
    const admin = await createUserDirect(app, "ADMIN");
    const adminToken = await loginAs(app, admin.email);
    const patient = await createUserDirect(app, "USER");
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment, rawAccessToken } = await createAppointmentDirect(app, doctor, { patientUserId: patient.id });

    const start = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/start`,
      headers: authHeader(adminToken),
    });
    expect(start.statusCode).toBe(200);
    return { appointmentId: appointment.id, rawAccessToken, recordingId: start.json().data.id };
  }

  it("BLOKE EDİCİ — `granted:false` → CONSENT_DENIED; Egress HİÇ ÇAĞRILMAZ", async () => {
    const { appointmentId, rawAccessToken } = await startRecordingAsAdmin();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/recording/consent?t=${rawAccessToken}`,
      payload: { granted: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("CONSENT_DENIED");
    expect(egressClientMocks.startRoomCompositeEgress).not.toHaveBeenCalled();

    const row = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { appointmentId } });
    expect(row.status).toBe("CONSENT_DENIED");
    expect(row.patientConsentDeniedAt).not.toBeNull();

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.recording.consent_denied", targetId: appointmentId } });
    expect(audit).not.toBeNull();
  });

  it("`granted:true` → Egress ÇAĞRILIR, RECORDING'e geçer, patientConsentAt dolu", async () => {
    const { appointmentId, rawAccessToken } = await startRecordingAsAdmin();
    egressClientMocks.startRoomCompositeEgress.mockResolvedValueOnce({ egressId: "egress_test_1" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/recording/consent?t=${rawAccessToken}`,
      payload: { granted: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("RECORDING");
    expect(egressClientMocks.startRoomCompositeEgress).toHaveBeenCalledTimes(1);

    const row = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { appointmentId } });
    expect(row.status).toBe("RECORDING");
    expect(row.patientConsentAt).not.toBeNull();
    expect(row.egressId).toBe("egress_test_1");
    expect(row.startedAt).not.toBeNull();

    const grantedAudit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.recording.consent_granted", targetId: appointmentId } });
    expect(grantedAudit).not.toBeNull();
    const startedAudit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.recording.started", targetId: appointmentId } });
    expect(startedAudit).not.toBeNull();
  });

  it("Egress teknik hata verirse yine 200 döner, status: FAILED (rıza GEÇERLİDİR)", async () => {
    const { appointmentId, rawAccessToken } = await startRecordingAsAdmin();
    egressClientMocks.startRoomCompositeEgress.mockRejectedValueOnce(new Error("egress upstream error"));

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/recording/consent?t=${rawAccessToken}`,
      payload: { granted: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("FAILED");
    // `failureReason` istemciye SIZMAZ (ConsultationRecordingSchema'da alan yok).
    expect(res.json().data.failureReason).toBeUndefined();

    const row = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { appointmentId } });
    expect(row.status).toBe("FAILED");
    expect(row.failureReason).toContain("egress upstream error");

    // Rıza yine de GEÇERLİ sayılır — `.consent_granted` audit'i YAZILMIŞ olmalı.
    const grantedAudit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.recording.consent_granted", targetId: appointmentId } });
    expect(grantedAudit).not.toBeNull();
  });

  it("TTL (2dk) dolduktan SONRA rıza yanıtı 409 RECORDING_CONSENT_EXPIRED döner", async () => {
    const { appointmentId, rawAccessToken } = await startRecordingAsAdmin();
    await app.prisma.consultationRecording.update({
      where: { appointmentId },
      data: { consentRequestedAt: new Date(Date.now() - 121_000) },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/recording/consent?t=${rawAccessToken}`,
      payload: { granted: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RECORDING_CONSENT_EXPIRED");
    expect(egressClientMocks.startRoomCompositeEgress).not.toHaveBeenCalled();
  });

  it("bekleyen bir rıza istemi YOKKEN (satır yok) 409 RECORDING_CONSENT_NOT_PENDING döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const patient = await createUserDirect(app, "USER");
    const patientToken = await loginAs(app, patient.email);
    const { appointment } = await createAppointmentDirect(app, doctor, { patientUserId: patient.id });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/consent`,
      headers: authHeader(patientToken),
      payload: { granted: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RECORDING_CONSENT_NOT_PENDING");
  });

  it("doktor/ADMIN hastanın YERİNE rıza VEREMEZ (404)", async () => {
    const { appointmentId } = await startRecordingAsAdmin();
    const stranger = await createUserDirect(app, "USER");
    const strangerToken = await loginAs(app, stranger.email);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointmentId}/recording/consent`,
      headers: authHeader(strangerToken),
      payload: { granted: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("telehealth/recording — /recording/stop", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildRecordingTestApp();
    await resetDatabase(app.prisma);
    await setModuleEnabled(app, "telehealth", true);
    await setModuleEnabled(app, "telehealth-recording", true);
    const admin = await createUserDirect(app, "ADMIN");
    adminToken = await loginAs(app, admin.email);
  });

  afterEach(async () => {
    egressClientMocks.startRoomCompositeEgress.mockReset();
    egressClientMocks.stopEgress.mockReset();
    roomServiceMocks.sendData.mockReset();
    webhookReceiverMocks.receive.mockReset();
    archiveRecordingFromEgressMock.mockClear();
    await resetDatabase(app.prisma);
    await app.close();
    resetLiveKitEnv();
    vi.resetModules();
  });

  it("RECORDING DEĞİLKEN 409 RECORDING_NOT_ACTIVE döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    await app.prisma.consultationRecording.create({ data: { appointmentId: appointment.id, status: "PENDING_CONSENT" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/stop`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("RECORDING_NOT_ACTIVE");
    expect(egressClientMocks.stopEgress).not.toHaveBeenCalled();
  });

  it("RECORDING'KEN → Egress durdurulur, PROCESSING'e geçer, audit yazılır", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "RECORDING", egressId: "egress_active_1", startedAt: new Date() },
    });
    egressClientMocks.stopEgress.mockResolvedValueOnce({});

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/stop`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("PROCESSING");
    expect(egressClientMocks.stopEgress).toHaveBeenCalledWith("egress_active_1");

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.recording.stopped", targetId: appointment.id } });
    expect(audit).not.toBeNull();
  });

  it("Egress zaten durmuşsa (SDK hata fırlatır) yine de PROCESSING'e geçer (best-effort)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "RECORDING", egressId: "egress_active_2", startedAt: new Date() },
    });
    egressClientMocks.stopEgress.mockRejectedValueOnce(new Error("egress already stopped"));

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${appointment.id}/recording/stop`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("PROCESSING");
  });
});

describe("webhooks/livekit — egress webhook'u (imza doğrulama + idempotency)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildRecordingTestApp();
    await resetDatabase(app.prisma);
  });

  afterEach(async () => {
    egressClientMocks.startRoomCompositeEgress.mockReset();
    egressClientMocks.stopEgress.mockReset();
    roomServiceMocks.sendData.mockReset();
    webhookReceiverMocks.receive.mockReset();
    archiveRecordingFromEgressMock.mockClear();
    await resetDatabase(app.prisma);
    await app.close();
    resetLiveKitEnv();
    vi.resetModules();
  });

  it("`Authorization` header YOKSA 400 döner, `receive` hiç çağrılmaz", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json" },
      payload: JSON.stringify({ event: "egress_ended" }),
    });
    expect(res.statusCode).toBe(400);
    expect(webhookReceiverMocks.receive).not.toHaveBeenCalled();
  });

  it("imza doğrulaması BAŞARISIZ olursa (`receive` reddeder) 400 döner", async () => {
    webhookReceiverMocks.receive.mockRejectedValueOnce(new Error("invalid signature"));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "tampered" },
      payload: JSON.stringify({ event: "egress_ended" }),
    });
    expect(res.statusCode).toBe(400);
    expect(archiveRecordingFromEgressMock).not.toHaveBeenCalled();
  });

  it("`egress_ended` (başarı) → `archiveRecordingFromEgress` doğru `{egressId, durationSeconds, error:null}` ile çağrılır", async () => {
    webhookReceiverMocks.receive.mockResolvedValueOnce({
      event: "egress_ended",
      egressInfo: {
        egressId: "egress_ok_1",
        status: 3, // EgressStatus.EGRESS_COMPLETE
        error: "",
        fileResults: [{ duration: 90_000_000_000n }], // 90 saniye (nanosaniye).
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "valid" },
      payload: JSON.stringify({ event: "egress_ended" }),
    });
    expect(res.statusCode).toBe(200);
    expect(archiveRecordingFromEgressMock).toHaveBeenCalledTimes(1);
    expect(archiveRecordingFromEgressMock).toHaveBeenCalledWith(expect.anything(), {
      egressId: "egress_ok_1",
      durationSeconds: 90,
      error: null,
    });
  });

  it("`egress_ended` (EGRESS_FAILED) → `archiveRecordingFromEgress` `error` DOLU çağrılır", async () => {
    webhookReceiverMocks.receive.mockResolvedValueOnce({
      event: "egress_ended",
      egressInfo: {
        egressId: "egress_fail_1",
        status: 4, // EgressStatus.EGRESS_FAILED
        error: "encoder crashed",
        fileResults: [],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "valid" },
      payload: JSON.stringify({ event: "egress_ended" }),
    });
    expect(res.statusCode).toBe(200);
    expect(archiveRecordingFromEgressMock).toHaveBeenCalledWith(expect.anything(), {
      egressId: "egress_fail_1",
      durationSeconds: null,
      error: "encoder crashed",
    });
  });

  it("`egress_started` → satırı (PENDING_CONSENT/RECORDING) `RECORDING`'e günceller (idempotent)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);
    await app.prisma.consultationRecording.create({
      data: { appointmentId: appointment.id, status: "PENDING_CONSENT", egressId: "egress_started_1" },
    });

    webhookReceiverMocks.receive.mockResolvedValueOnce({
      event: "egress_started",
      egressInfo: { egressId: "egress_started_1" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "valid" },
      payload: JSON.stringify({ event: "egress_started" }),
    });
    expect(res.statusCode).toBe(200);

    const row = await app.prisma.consultationRecording.findUniqueOrThrow({ where: { appointmentId: appointment.id } });
    expect(row.status).toBe("RECORDING");
  });

  it("bilinmeyen olay tipi → sessiz 200, `archiveRecordingFromEgress` ÇAĞRILMAZ", async () => {
    webhookReceiverMocks.receive.mockResolvedValueOnce({ event: "room_started" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "valid" },
      payload: JSON.stringify({ event: "room_started" }),
    });
    expect(res.statusCode).toBe(200);
    expect(archiveRecordingFromEgressMock).not.toHaveBeenCalled();
  });
});
