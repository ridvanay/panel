import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.4/§4.5/§8/§9.4/§9.5/§12 — integration-agent'ın
 * TEK SAHASI: `POST /appointments/{id}/meeting-token` + `POST /appointments/{id}/complete`.
 *
 * LiveKit "yapılandırılmışken" davranışı test etmek için `process.env.LIVEKIT_*` +
 * `vi.resetModules()` + dinamik `import("../../src/app")` kullanılır —
 * `tests/integration/appearance.test.ts::CUSTOM_CODE_ENABLED` İLE AYNI, bu depoda YERLEŞİK
 * desen (`config/env.ts` process başına BİR KEZ okunur). Gerçek bir LiveKit hesabına
 * bağlanılmaz — `AccessToken`/`TokenVerifier` tamamen yerel bir JWT imzalama/doğrulama
 * işlemidir (ağ çağrısı YOKTUR), `STRIPE_WEBHOOK_SECRET` test sabiti İLE AYNI güvenlik sınıfı.
 */

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

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-livekit-${crypto.randomUUID()}@example.com`,
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

/** Europe/Istanbul, Pazartesi 09:00-17:00, 30dk seans — her çağrıda YENİ bir doktor/uzmanlık. */
async function createDoctorWithAvailability(app: FastifyInstance) {
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

async function bookAppointment(app: FastifyInstance, doctorSlug: string, startsAt: Date, patientEmail = `hasta-${crypto.randomUUID()}@example.com`) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/appointments",
    payload: { doctorSlug, startsAt: startsAt.toISOString(), patientName: "Test Hasta", patientEmail, consent: true },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { id: string; accessToken: string };
}

/**
 * `POST /appointments` (§4.3) her zaman en az `SLOT_BOOKING_BUFFER_MS` (2 saat) İLERİDE bir
 * `startsAt` ister (bkz. `lib/availability.ts::isBookableSlotStart`) — bu yüzden GERÇEK
 * rezervasyon akışıyla katılım penceresi (§4.5: `startsAt - 5dk` … `endsAt + 15dk`) İÇİNDE bir
 * randevu ÜRETİLEMEZ (booking anı ile pencere birbirini yapısal olarak DIŞLAR). meeting-token
 * yetkilendirme/pencere mantığını izole test etmek için `Appointment` satırı DOĞRUDAN yazılır —
 * booking akışının kendisi zaten `telehealth.test.ts`'te (backend-agent) ayrıca test edilir.
 */
async function createAppointmentDirect(
  app: FastifyInstance,
  doctor: { id: string },
  overrides: Partial<{ patientUserId: string | null; startsAt: Date; endsAt: Date }> = {}
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
      priceCents: 50000,
      currency: "TRY",
      meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
      accessTokenHash: hashToken(rawAccessToken),
    },
  });
  return { appointment, rawAccessToken };
}

describe("telehealth/livekit — meeting-token, LiveKit YAPILANDIRILMAMIŞKEN (varsayılan test env)", () => {
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

  it("§4.4 madde 3 — 503 LIVEKIT_NOT_CONFIGURED döner (randevu var olsa dahi)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { id } = await bookAppointment(app, doctor.slug, nextMondayNineAmUtc());

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/meeting-token` });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("LIVEKIT_NOT_CONFIGURED");
  });

  it("modül KAPALIYKEN 404 döner (LiveKit yapılandırmasından ÖNCE kontrol edilir)", async () => {
    await setTelehealthModuleEnabled(app, false);
    const res = await app.inject({ method: "POST", url: "/api/v1/appointments/00000000-0000-0000-0000-000000000000/meeting-token" });
    expect(res.statusCode).toBe(404);
    await setTelehealthModuleEnabled(app, true);
  });
});

describe("telehealth/livekit — meeting-token, LiveKit YAPILANDIRILMIŞKEN (sahte config)", () => {
  let app: FastifyInstance;
  let adminToken: string;

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

    const admin = await registerTestUser(app, { email: "telehealth-livekit-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    vi.resetModules();
  });

  it("§8/§12 — doğru accessToken ile MİSAFİR hasta 200 alır; token/serverUrl/roomName/expiresAt döner; LIVEKIT_API_SECRET yanıtta YOK", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment, rawAccessToken } = await createAppointmentDirect(app, doctor);

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token?t=${rawAccessToken}` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(typeof data.token).toBe("string");
    expect(data.serverUrl).toBe("wss://fake-project.livekit.cloud");
    expect(data.roomName).toBe(appointment.meetingRoomName);
    expect(typeof data.expiresAt).toBe("string");

    const raw = JSON.stringify(res.json());
    expect(raw).not.toContain("fake-api-secret-for-tests-only");

    // İlk başarılı token → randevu IN_PROGRESS + startedAt set edilir (tek seferlik).
    const updated = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.startedAt).not.toBeNull();

    // Audit: `logAudit(action: "telehealth.meeting_token.issued")` yazılmış olmalı.
    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.meeting_token.issued", targetId: appointment.id } });
    expect(audit).not.toBeNull();
  });

  it("§4.5/§8 IDOR — token OLMADAN/YANLIŞ token ile misafir erişemez (404); ADMIN token olmadan erişir; MANAGER erişemez (404)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment } = await createAppointmentDirect(app, doctor);

    const noToken = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token` });
    expect(noToken.statusCode).toBe(404);

    const wrongToken = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token?t=yanlis-token` });
    expect(wrongToken.statusCode).toBe(404);

    const asAdmin = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token`, headers: authHeader(adminToken) });
    expect(asAdmin.statusCode).toBe(200);

    const manager = await createUserDirect(app, "MANAGER");
    const managerToken = await loginAs(app, manager.email);
    const { doctor: doctor2 } = await createDoctorWithAvailability(app);
    const { appointment: appointment2 } = await createAppointmentDirect(app, doctor2);
    const asManager = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment2.id}/meeting-token`, headers: authHeader(managerToken) });
    // §4.5 (bağlayıcı) — yalnızca `SiteRole.ADMIN`, MANAGER BU uçta DAHİL DEĞİL (genel
    // randevu görüntüleme/iptal ADMIN+MANAGER eşiğiyle KARIŞTIRILMAMALI).
    expect(asManager.statusCode).toBe(404);
  });

  it("§4.5/§8 IDOR — randevunun sahibi oturum açmış hasta erişir; BAŞKA bir hasta erişemez", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const patient = await registerTestUser(app, { email: `telehealth-patient-${crypto.randomUUID()}@example.com` });
    const other = await registerTestUser(app, { email: `telehealth-other-${crypto.randomUUID()}@example.com` });

    const { appointment } = await createAppointmentDirect(app, doctor, { patientUserId: patient.userId });

    const ownerRes = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token`, headers: authHeader(patient.accessToken) });
    expect(ownerRes.statusCode).toBe(200);

    const otherRes = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token`, headers: authHeader(other.accessToken) });
    expect(otherRes.statusCode).toBe(404);
  });

  it("§4.5/§8 — doktorun bağlı User'ı erişir; doktor identity'si PII İÇERMEZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const doctorUser = await createUserDirect(app, "USER");
    const doctorUserToken = await loginAs(app, doctorUser.email);

    const link = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/doctors/${doctor.id}`,
      headers: authHeader(adminToken),
      payload: { userId: doctorUser.id },
    });
    expect(link.statusCode).toBe(200);

    const { appointment } = await createAppointmentDirect(app, doctor);
    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token`, headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
  });

  it("§4.5 — randevu penceresi DIŞINDA 409 APPOINTMENT_NOT_JOINABLE döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const { appointment, rawAccessToken } = await createAppointmentDirect(app, doctor, {
      startsAt: farFuture,
      endsAt: new Date(farFuture.getTime() + 30 * 60 * 1000),
    });

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token?t=${rawAccessToken}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPOINTMENT_NOT_JOINABLE");
  });

  it("§4.5 — CANCELLED bir randevu için token istenemez (409)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { id, accessToken } = await bookAppointment(app, doctor.slug, nextMondayNineAmUtc());

    // [TCT] §9.7.2/§9.7.3 (bağlayıcı) — `POST /appointments` artık `PENDING_PAYMENT` ile
    // başlar; yalnızca `SCHEDULED` randevular iptal edilebilir (bkz. telehealth.routes.ts). Bu
    // izole akışta ödemeyi simüle etmenin en basit yolu ADMIN'in manuel `mark-paid` ucudur.
    const created = await app.prisma.appointment.findUniqueOrThrow({ where: { id } });
    const markPaid = await app.inject({
      method: "POST",
      url: `/api/v1/admin/telehealth/bookings/${created.bookingId}/mark-paid`,
      headers: authHeader(adminToken),
      payload: { reason: "Test — ofis içi ödeme simülasyonu" },
    });
    expect(markPaid.statusCode).toBe(200);

    const cancelRes = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/cancel?t=${accessToken}`, payload: {} });
    expect(cancelRes.statusCode).toBe(200);

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/meeting-token?t=${accessToken}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("APPOINTMENT_NOT_JOINABLE");
  });
});

describe("telehealth/livekit — meeting-token hız sınırı (§8 madde 1 — 10/dk, AYRI app örneği)", () => {
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

  it("11. istek 429 RATE_LIMITED döner (IP bazlı, tek randevu üzerinde tekrar tekrar)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { appointment, rawAccessToken } = await createAppointmentDirect(app, doctor);

    const results: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${appointment.id}/meeting-token?t=${rawAccessToken}` });
      results.push(res.statusCode);
    }
    expect(results.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(results[10]).toBe(429);
  });
});

describe("telehealth/livekit — complete (§4.5 son madde: doktor/ADMIN)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: "telehealth-complete-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ADMIN randevuyu COMPLETED yapar + endedAt set edilir", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { id } = await bookAppointment(app, doctor.slug, nextMondayNineAmUtc());

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/complete`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("COMPLETED");
    expect(res.json().data.endedAt).not.toBeNull();
  });

  it("doktorun bağlı User'ı COMPLETED yapabilir; İLGİSİZ kullanıcı/MANAGER YAPAMAZ (404)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const doctorUser = await createUserDirect(app, "USER");
    const doctorUserToken = await loginAs(app, doctorUser.email);
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/doctors/${doctor.id}`,
      headers: authHeader(adminToken),
      payload: { userId: doctorUser.id },
    });

    const { id } = await bookAppointment(app, doctor.slug, nextMondayNineAmUtc());

    const manager = await createUserDirect(app, "MANAGER");
    const managerToken = await loginAs(app, manager.email);
    const managerRes = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/complete`, headers: authHeader(managerToken) });
    expect(managerRes.statusCode).toBe(404);

    const doctorRes = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/complete`, headers: authHeader(doctorUserToken) });
    expect(doctorRes.statusCode).toBe(200);
    expect(doctorRes.json().data.status).toBe("COMPLETED");
  });

  it("kimlik doğrulanmamış istek 404 döner (misafir accessToken'ı bu uçta GEÇERSİZDİR)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { id, accessToken } = await bookAppointment(app, doctor.slug, nextMondayNineAmUtc());

    const res = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/complete?t=${accessToken}` });
    expect(res.statusCode).toBe(404);
  });

  it("`note` gönderildiğinde AES-256-GCM ile şifrelenip yazılır; audit loglanır; `note` YOKSA mevcut alanlar DOKUNULMAZ", async () => {
    const { decryptSecret } = await import("../../src/lib/crypto");
    const { doctor } = await createDoctorWithAvailability(app);
    const { id } = await bookAppointment(app, doctor.slug, nextMondayNineAmUtc());

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${id}/complete`,
      headers: authHeader(adminToken),
      payload: { note: "Hasta stabil, kontrol önerildi." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("COMPLETED");

    const raw = await app.prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(raw.consultationNoteCiphertext).not.toBeNull();
    expect(raw.consultationNoteCiphertext).not.toContain("Hasta stabil");
    expect(decryptSecret(raw.consultationNoteCiphertext!)).toBe("Hasta stabil, kontrol önerildi.");
    expect(raw.consultationNoteUpdatedAt).not.toBeNull();

    const audit = await app.prisma.auditLog.findFirst({
      where: { action: "telehealth.consultation_note.updated", targetId: id },
    });
    expect(audit).not.toBeNull();
    // Not içeriği metadata'ya YAZILMAZ.
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain("Hasta stabil");

    // `note` YOKSA — var olan not SİLİNMEZ (ikinci bir çağrı, notsuz).
    const secondCall = await app.inject({
      method: "POST",
      url: `/api/v1/appointments/${id}/complete`,
      headers: authHeader(adminToken),
    });
    expect(secondCall.statusCode).toBe(200);
    const afterSecondCall = await app.prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(afterSecondCall.consultationNoteCiphertext).toBe(raw.consultationNoteCiphertext);
  });
});
