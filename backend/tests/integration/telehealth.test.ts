import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `.claude/architect-scope-telehealth-template.md` §4/§8/§9.4/§10 — modül aç/kapa (404),
 * randevu alma akışı, `409 SLOT_TAKEN` yarış senaryosu (§4.3, GERÇEK Postgres'e karşı — saf
 * birim testleri `@@unique`/Serializable transaction'ı KANITLAYAMAZ), erişim kontrolü (token/
 * oturum/rol) ve `/admin/telehealth/appointments` RBAC'i (ADMIN+MANAGER, EDITOR dışlanır, §8.4).
 *
 * AYRI `describe`/`app` blokları — `POST /appointments`'ın 5/dk route-level hız sınırı (IP
 * bazlı, bkz. telehealth.routes.ts) tek bir app örneğinde birikip testleri 429 ile çökertir;
 * `checkout.test.ts::CHECKOUT_RATE_LIMIT` İLE AYNI, bu depoda YERLEŞİK çözüm.
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-user-${crypto.randomUUID()}@example.com`,
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
async function createDoctorWithAvailability(
  app: FastifyInstance,
  overrides: Partial<{ sessionDurationMin: number; sessionPriceCents: number; currency: string; withAvatar: boolean }> = {}
) {
  const specialty = await app.prisma.specialty.create({
    data: { name: `Kardiyoloji ${crypto.randomUUID()}`, slug: `kardiyoloji-${crypto.randomUUID()}`, icon: "heart-pulse" },
  });
  const avatarMedia = overrides.withAvatar
    ? await app.prisma.media.create({
        data: {
          path: `uploads/telehealth-test-${crypto.randomUUID()}.jpg`,
          url: `/uploads/telehealth-test-${crypto.randomUUID()}.jpg`,
          filename: "avatar.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
        },
      })
    : null;
  const doctor = await app.prisma.doctorProfile.create({
    data: {
      title: "Dr.",
      fullName: `Test Doktor ${crypto.randomUUID()}`,
      slug: `test-doktor-${crypto.randomUUID()}`,
      bio: "Test amaçlı doktor profili.",
      languages: ["tr"],
      timeZone: "Europe/Istanbul",
      specialtyId: specialty.id,
      sessionDurationMin: overrides.sessionDurationMin ?? 30,
      sessionPriceCents: overrides.sessionPriceCents ?? 50000,
      currency: overrides.currency ?? "TRY",
      avatarMediaId: avatarMedia?.id ?? null,
      isActive: true,
    },
  });
  await app.prisma.doctorAvailability.create({
    data: { doctorId: doctor.id, dayOfWeek: 1, startMinute: 540, endMinute: 1020, isActive: true },
  });
  return { doctor, specialty, avatarMedia };
}

/** Bugünden itibaren GELECEKTEKİ ilk Pazartesi'nin 09:00 Europe/Istanbul (= 06:00 UTC) anı. */
function nextMondayNineAmUtc(): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7; // bugün DAHİL değil, her zaman GELECEKTE.
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 6, 0, 0));
}

describe("telehealth — modül aç/kapa + doktor/slot görüntüleme", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("§8.6/DoD — modül KAPALIYKEN ADMIN uçları da 404 döner (ADMIN rolü BİLE modülü AŞAMAZ)", async () => {
    await setTelehealthModuleEnabled(app, false);
    const admin = await registerTestUser(app, { email: `telehealth-module-off-admin-${crypto.randomUUID()}@example.com` });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/appointments",
      headers: authHeader(admin.accessToken),
    });
    expect(list.statusCode).toBe(404);

    const doctors = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/doctors",
      headers: authHeader(admin.accessToken),
    });
    expect(doctors.statusCode).toBe(404);

    const specialties = await app.inject({
      method: "GET",
      url: "/api/v1/admin/telehealth/specialties",
      headers: authHeader(admin.accessToken),
    });
    expect(specialties.statusCode).toBe(404);

    await setTelehealthModuleEnabled(app, true);
  });

  it("modül KAPALIYKEN tüm public uçlar 404 döner", async () => {
    await setTelehealthModuleEnabled(app, false);

    const list = await app.inject({ method: "GET", url: "/api/v1/doctors" });
    expect(list.statusCode).toBe(404);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: { doctorSlug: "yok", startsAt: "2030-01-01T06:00:00Z", patientName: "A", patientEmail: "a@example.com", consent: true },
    });
    expect(create.statusCode).toBe(404);
  });

  it("modül AÇIKKEN doktor listesi/detayı ve slot takvimi doğru döner", async () => {
    await setTelehealthModuleEnabled(app, true);
    const { doctor, specialty, avatarMedia } = await createDoctorWithAvailability(app, {
      sessionDurationMin: 45,
      sessionPriceCents: 65000,
      currency: "GBP",
      withAvatar: true,
    });

    const list = await app.inject({ method: "GET", url: "/api/v1/doctors" });
    expect(list.statusCode).toBe(200);
    const listedDoctor = list.json().data.find((d: { id: string }) => d.id === doctor.id);
    expect(listedDoctor).toBeDefined();
    // §regresyon — liste ucu her doktorun KENDİ para birimi/süre/ücret/saat dilimini döner,
    // sabit/varsayılan bir değere DÜŞMEZ (bkz. görev notu: hardcode "TRY" riski).
    expect(listedDoctor.currency).toBe("GBP");
    expect(listedDoctor.timeZone).toBe("Europe/Istanbul");
    expect(listedDoctor.sessionDurationMin).toBe(45);
    expect(listedDoctor.sessionPriceCents).toBe(65000);
    expect(listedDoctor.avatarMediaId).toBe(avatarMedia?.id);
    expect(listedDoctor.avatarMedia).not.toBeNull();
    expect(typeof listedDoctor.avatarMedia.url).toBe("string");

    const detail = await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}` });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json().data;
    expect(detailBody.specialty.id).toBe(specialty.id);
    expect(detailBody.currency).toBe("GBP");
    expect(detailBody.timeZone).toBe("Europe/Istanbul");
    expect(detailBody.sessionDurationMin).toBe(45);
    expect(detailBody.sessionPriceCents).toBe(65000);
    expect(detailBody.avatarMediaId).toBe(avatarMedia?.id);
    expect(detailBody.avatarMedia?.url).toEqual(expect.stringContaining(avatarMedia!.url));

    const monday = nextMondayNineAmUtc();
    const fromStr = monday.toISOString().slice(0, 10);
    const slots = await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}/slots?from=${fromStr}&to=${fromStr}` });
    expect(slots.statusCode).toBe(200);
    const slotBody = slots.json().data as { startsAt: string; endsAt: string; available: boolean }[];
    expect(slotBody.some((s) => s.startsAt === monday.toISOString())).toBe(true);
    expect(slotBody.every((s) => s.available)).toBe(true);
  });

  it("31 günden UZUN slot aralığı 422 döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/doctors/${doctor.slug}/slots?from=2030-01-01&to=2030-03-01` });
    expect(res.statusCode).toBe(422);
  });
});

describe("telehealth — randevu oluşturma (§4.3)", () => {
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

  it("geçerli slot için 201 + ham accessToken BİR KEZ döner; fiyat/süre istemciden ASLA kabul edilmez", async () => {
    const { doctor } = await createDoctorWithAvailability(app, { sessionPriceCents: 75000 });
    const startsAt = nextMondayNineAmUtc();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: { doctorSlug: doctor.slug, startsAt: startsAt.toISOString(), patientName: "Ada Lovelace", patientEmail: "ada@example.com", consent: true },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.priceCents).toBe(75000);
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessToken.length).toBeGreaterThan(10);

    const created = await app.prisma.appointment.findUniqueOrThrow({ where: { id: body.id } });
    expect(created.priceCents).toBe(75000);
    expect(created.status).toBe("SCHEDULED");
  });

  it("geçersiz (müsaitlik dışı) bir saat için 422 döner, RANDEVU OLUŞMAZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const invalidStart = new Date(nextMondayNineAmUtc().getTime() + 60_000); // 1dk kaymış, gerçek bir slot DEĞİL.

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: { doctorSlug: doctor.slug, startsAt: invalidStart.toISOString(), patientName: "Geçersiz Saat", patientEmail: "gecersiz@example.com", consent: true },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("telehealth — çifte rezervasyon yarış senaryosu (§4.3, KRİTİK)", () => {
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

  it("aynı doktor+saat için EŞZAMANLI iki POST /appointments — biri 201, diğeri 409 SLOT_TAKEN", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const payload = (email: string) => ({
      doctorSlug: doctor.slug,
      startsAt: startsAt.toISOString(),
      patientName: "Yarış Testi",
      patientEmail: email,
      consent: true,
    });

    const [resA, resB] = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/appointments", payload: payload("race-a@example.com") }),
      app.inject({ method: "POST", url: "/api/v1/appointments", payload: payload("race-b@example.com") }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const conflicted = resA.statusCode === 409 ? resA : resB;
    expect(conflicted.json().error.code).toBe("SLOT_TAKEN");

    const count = await app.prisma.appointment.count({ where: { doctorId: doctor.id, startsAt } });
    expect(count).toBe(1);
  });
});

describe("telehealth — randevu erişimi (IDOR koruması, §8.5)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);
    const admin = await registerTestUser(app, { email: "telehealth-access-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("GET /appointments/{id} — doğru token ile 200, YANLIŞ/EKSİK token ile 404; ADMIN token olmadan erişebilir", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: { doctorSlug: doctor.slug, startsAt: startsAt.toISOString(), patientName: "Erişim Testi", patientEmail: "erisim@example.com", consent: true },
    });
    expect(createRes.statusCode).toBe(201);
    const { id, accessToken } = createRes.json().data;

    const withToken = await app.inject({ method: "GET", url: `/api/v1/appointments/${id}?t=${accessToken}` });
    expect(withToken.statusCode).toBe(200);
    expect(withToken.json().data.patientEmail).toBe("erisim@example.com");

    const withoutToken = await app.inject({ method: "GET", url: `/api/v1/appointments/${id}` });
    expect(withoutToken.statusCode).toBe(404);

    const wrongToken = await app.inject({ method: "GET", url: `/api/v1/appointments/${id}?t=yanlis-token` });
    expect(wrongToken.statusCode).toBe(404);

    const asAdmin = await app.inject({ method: "GET", url: `/api/v1/appointments/${id}`, headers: authHeader(adminToken) });
    expect(asAdmin.statusCode).toBe(200);
  });
});

describe("telehealth — randevu iptali (§4.3, slot serbest KALMAZ)", () => {
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

  it("POST /appointments/{id}/cancel — ikinci iptal 409 döner; iptal edilen saat YENİDEN alınamaz (SLOT_TAKEN)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const startsAt = nextMondayNineAmUtc();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: { doctorSlug: doctor.slug, startsAt: startsAt.toISOString(), patientName: "İptal Testi", patientEmail: "iptal@example.com", consent: true },
    });
    const { id, accessToken } = createRes.json().data;

    const cancelRes = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/cancel?t=${accessToken}`, payload: {} });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().data.status).toBe("CANCELLED");

    const secondCancel = await app.inject({ method: "POST", url: `/api/v1/appointments/${id}/cancel?t=${accessToken}`, payload: {} });
    expect(secondCancel.statusCode).toBe(409);

    const rebook = await app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      payload: { doctorSlug: doctor.slug, startsAt: startsAt.toISOString(), patientName: "Yeniden Dene", patientEmail: "yeniden@example.com", consent: true },
    });
    expect(rebook.statusCode).toBe(409);
    expect(rebook.json().error.code).toBe("SLOT_TAKEN");
  });
});

describe("telehealth — admin RBAC ve CRUD (§8.4)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // §8.6/DoD (bağlayıcı) — admin uçları da `requireModuleEnabled("telehealth")` ile korunur
    // (security-agent düzeltmesi); RBAC'i izole test edebilmek için modül burada AÇIK olmalı.
    await setTelehealthModuleEnabled(app, true);

    const admin = await registerTestUser(app, { email: "telehealth-admin@example.com" });
    adminToken = admin.accessToken;
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("/admin/telehealth/appointments — EDITOR 403, MANAGER 200 (EDITOR dışlanır)", async () => {
    const editorRes = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/appointments", headers: authHeader(editorToken) });
    expect(editorRes.statusCode).toBe(403);

    const managerRes = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/appointments", headers: authHeader(managerToken) });
    expect(managerRes.statusCode).toBe(200);
  });

  it("/admin/telehealth/doctors — kimlik doğrulanmamış istek 401 alır; ADMIN/MANAGER oluşturabilir", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/doctors" });
    expect(noAuth.statusCode).toBe(401);

    const createSpecialty = await app.inject({
      method: "POST",
      url: "/api/v1/admin/telehealth/specialties",
      headers: authHeader(managerToken),
      payload: { name: "Dermatoloji", icon: "stethoscope" },
    });
    expect(createSpecialty.statusCode).toBe(201);

    const createDoctor = await app.inject({
      method: "POST",
      url: "/api/v1/admin/telehealth/doctors",
      headers: authHeader(adminToken),
      payload: {
        title: "Dr.",
        fullName: "Panelden Eklenen Doktor",
        bio: "Panelden oluşturuldu.",
        languages: ["tr"],
        timeZone: "Europe/Istanbul",
        sessionDurationMin: 30,
        sessionPriceCents: 40000,
      },
    });
    expect(createDoctor.statusCode).toBe(201);
    const doctorId = createDoctor.json().data.id;

    const setAvailability = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/telehealth/doctors/${doctorId}/availability`,
      headers: authHeader(adminToken),
      payload: { rules: [{ dayOfWeek: 2, startMinute: 600, endMinute: 720, isActive: true }] },
    });
    expect(setAvailability.statusCode).toBe(200);
    expect(setAvailability.json().data).toHaveLength(1);
  });

  it("EDITOR doktor/uzmanlık YAZAMAZ (403) ama panel kapısını GEÇER (okuma 200)", async () => {
    const readSpecialties = await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/specialties", headers: authHeader(editorToken) });
    expect(readSpecialties.statusCode).toBe(200);

    const writeSpecialty = await app.inject({
      method: "POST",
      url: "/api/v1/admin/telehealth/specialties",
      headers: authHeader(editorToken),
      payload: { name: "Nöroloji", icon: "brain" },
    });
    expect(writeSpecialty.statusCode).toBe(403);
  });
});
