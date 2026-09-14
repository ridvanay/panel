import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { encryptIdentityNumber, hashIdentityNumber, maskIdentityNumber } from "../../src/lib/identity";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §6 madde 2 —
 * hasta kimlik bilgisi akışı (zorunlu `identity`, format/18-yaş reddi, `GET`/`PUT .../identity`
 * erişim matrisi) + doktor self-servis profil ucunun (`PUT /doctor/profile`) kapsam dışı alan
 * reddi + `GET /doctor/bookings` `scope`/`from`/`to` çakışma reddi.
 */

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `telehealth-identity-user-${crypto.randomUUID()}@example.com`,
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

function bookingPayload(doctorSlug: string, slots: Date[], patientEmail = `hasta-${crypto.randomUUID()}@example.com`, identity: unknown = VALID_TEST_IDENTITY) {
  return {
    doctorSlug,
    slots: slots.map((s) => s.toISOString()),
    patientName: "Test Hasta",
    patientEmail,
    identity,
    consent: true,
  };
}

async function makeDoctorSession(app: FastifyInstance, doctorId: string) {
  const doctorUser = await createUserDirect(app, "USER");
  const doctorUserToken = await loginAs(app, doctorUser.email);
  await app.prisma.user.update({ where: { id: doctorUser.id }, data: { twoFactorEnabled: true } });
  await app.prisma.doctorProfile.update({ where: { id: doctorId }, data: { userId: doctorUser.id } });
  return { doctorUser, doctorUserToken };
}

describe("telehealth — kimlik adımı (POST /appointments/bookings — [DPI] §2.4/§2.6)", () => {
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

  it("geçersiz TCKN (checksum hatası) → 422, hiçbir slot TUTULMAZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const slot = nextMondayNineAmUtc();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [slot], undefined, { ...VALID_TEST_IDENTITY, identityNumber: "10000000145" }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");

    // Slot HÂLÂ boş olmalı — geçersiz kimlik yüzünden hiçbir Appointment satırı oluşmamalı.
    const appointmentCount = await app.prisma.appointment.count({ where: { doctorId: doctor.id, startsAt: slot } });
    expect(appointmentCount).toBe(0);
  });

  it("hata gövdesi girilen kimlik numarasını GERİ YANSITMAZ (security-review madde 3)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()], undefined, { ...VALID_TEST_IDENTITY, identityNumber: "10000000145" }),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).not.toContain("10000000145");
  });

  it("18 yaş altı beyan → 422 IDENTITY_MINOR_NOT_SUPPORTED, hiçbir slot TUTULMAZ", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const slot = nextMondayNineAmUtc();
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [slot], undefined, { ...VALID_TEST_IDENTITY, birthDate: tenYearsAgo.toISOString().slice(0, 10) }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("IDENTITY_MINOR_NOT_SUPPORTED");

    const appointmentCount = await app.prisma.appointment.count({ where: { doctorId: doctor.id, startsAt: slot } });
    expect(appointmentCount).toBe(0);
  });

  it("`identity` alanı OLMADAN istek 422 VALIDATION_ERROR döner (kimlik ZORUNLU)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const payload = bookingPayload(doctor.slug, [nextMondayNineAmUtc()]) as Record<string, unknown>;
    delete payload.identity;

    const res = await app.inject({ method: "POST", url: "/api/v1/appointments/bookings", payload });
    expect(res.statusCode).toBe(422);
  });

  it("geçerli kimlikle booking oluşur; `consentVersion` varsayılanı `v2`'dir ([CNT] TUR 4 güncellemesi)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    expect(res.statusCode).toBe(201);
    const bookingId = res.json().data.bookingId as string;

    const booking = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.consentVersion).toBe("v2");
    expect(booking.citizenshipType).toBe("TR");
    expect(booking.identityNumberMasked).toBe("100******46");
    expect(booking.identityNumberCiphertext).not.toBeNull();
    expect(booking.identityNumberHash).not.toBeNull();
  });
});

describe("telehealth — kimlik erişim matrisi (GET/PUT .../identity — [DPI] §2.7)", () => {
  let app: FastifyInstance;
  // `AUTH_RATE_LIMIT_MAX` (varsayılan 5/dk, `.env.test`'te override EDİLMEDİ) `/auth/register`
  // ucunda TEK bir app örneğinde birikir — bu describe'daki TÜM testler AYNI paylaşılan
  // patient/admin/manager oturumlarını (§beforeAll'da BİR KEZ kaydedilir) yeniden kullanır.
  let patient: { userId: string; email: string; accessToken: string };
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);

    patient = await registerTestUser(app, { email: `telehealth-identity-patient-${crypto.randomUUID()}@example.com` });

    const admin = await registerTestUser(app, { email: `telehealth-identity-admin-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
    adminToken = admin.accessToken;

    const manager = await registerTestUser(app, { email: `telehealth-identity-manager-${crypto.randomUUID()}@example.com` });
    await app.prisma.user.update({ where: { id: manager.userId }, data: { role: "MANAGER" } });
    managerToken = manager.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  /**
   * `POST /appointments/bookings`'in 5/dk route-level hız sınırı bu describe'daki 10 testte
   * TEK bir app örneğinde birikirdi (`telehealth-bookings.test.ts` dosya başlığındaki AYNI
   * kısıt) — bu yüzden erişim matrisi testleri booking'i DOĞRUDAN Prisma ile, GERÇEK
   * `lib/identity.ts` yardımcılarıyla (şifreli/hash'li/maskeli) kurar
   * (`telehealth-analytics.test.ts::createBookingDirect` İLE AYNI desen).
   */
  async function createPendingBooking(patient?: { userId: string; email: string }) {
    const { doctor } = await createDoctorWithAvailability(app);
    const now = new Date();
    const identityNumber = "10000000146";
    const booking = await app.prisma.appointmentBooking.create({
      data: {
        bookingNumber: `BK-${crypto.randomUUID()}`,
        doctorId: doctor.id,
        patientUserId: patient?.userId ?? null,
        patientName: "Test Hasta",
        patientEmail: patient?.email ?? `hasta-${crypto.randomUUID()}@example.com`,
        citizenshipType: "TR",
        identityCountryCode: "TR",
        identityNumberCiphertext: encryptIdentityNumber(identityNumber),
        identityNumberHash: hashIdentityNumber("TR", "TR", identityNumber),
        identityNumberMasked: maskIdentityNumber("TR", identityNumber),
        patientBirthDate: new Date("1990-01-01T00:00:00.000Z"),
        identityCapturedAt: now,
        slotCount: 1,
        unitPriceCents: doctor.sessionPriceCents,
        subtotalCents: doctor.sessionPriceCents,
        totalCents: doctor.sessionPriceCents,
        currency: "TRY",
        paymentStatus: "PENDING",
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        meetingRoomName: `room_${crypto.randomUUID()}`,
        accessTokenHash: crypto.randomUUID(),
        consentAt: now,
        consentVersion: "v2",
      },
    });
    return { doctor, bookingId: booking.id };
  }

  it("hasta (oturum) GET .../identity ile açık numarayı okuyabilir ve audit'e düşer", async () => {
    const { bookingId } = await createPendingBooking({ userId: patient.userId, email: patient.email });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(patient.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.identityNumber).toBe("10000000146");
    expect(res.headers["cache-control"]).toBe("no-store");

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.identity.accessed", targetId: bookingId } });
    expect(audit).not.toBeNull();
    // Audit metadata'da numara/maske ASLA yer ALMAZ.
    expect(JSON.stringify(audit?.metadata ?? {})).not.toContain("10000000146");
  });

  it("booking'in KENDİ doktoru GET .../identity ile erişebilir", async () => {
    const { doctor, bookingId } = await createPendingBooking();
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(doctorUserToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("ADMIN GET .../identity ile erişebilir", async () => {
    const { bookingId } = await createPendingBooking();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("MANAGER GET .../identity → 404 (varlık sızdırılmaz)", async () => {
    const { bookingId } = await createPendingBooking();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(managerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("BAŞKA bir doktor GET .../identity → 404", async () => {
    const { bookingId } = await createPendingBooking();
    const { doctor: otherDoctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken: otherDoctorToken } = await makeDoctorSession(app, otherDoctor.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(otherDoctorToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("MANAGER booking'i GÖRÜR (GET .../bookingId) ama `identity` alanı `null` döner", async () => {
    const { bookingId } = await createPendingBooking();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}`,
      headers: authHeader(managerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.identity).toBeNull();
  });

  it("ADMIN booking'i görür ve `identity` (maskeli) DOLUDUR", async () => {
    const { bookingId } = await createPendingBooking();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/appointments/bookings/${bookingId}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.identity).not.toBeNull();
    expect(res.json().data.identity.maskedNumber).toBe("100******46");
  });

  it("PUT .../identity — yalnızca hasta, `paymentStatus=PENDING` iken kimliği düzeltebilir", async () => {
    const { bookingId } = await createPendingBooking({ userId: patient.userId, email: patient.email });

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(patient.accessToken),
      payload: { citizenshipType: "FOREIGN", identityNumber: "AB123456", countryCode: "DE", birthDate: "1985-05-05" },
    });
    expect(res.statusCode).toBe(200);

    const updated = await app.prisma.appointmentBooking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(updated.citizenshipType).toBe("FOREIGN");
    expect(updated.identityCountryCode).toBe("DE");

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.identity.updated", targetId: bookingId } });
    expect(audit?.metadata).toEqual({ fields: ["citizenshipType", "countryCode", "identityNumber", "birthDate"] });
  });

  it("doktor PUT .../identity ile bir hastanın kimliğini YAZAMAZ (404)", async () => {
    const { doctor, bookingId } = await createPendingBooking();
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(doctorUserToken),
      payload: VALID_TEST_IDENTITY,
    });
    expect(res.statusCode).toBe(404);
  });

  it("ödenmiş (PAID) booking'de PUT .../identity → 409 IDENTITY_LOCKED", async () => {
    const { bookingId } = await createPendingBooking({ userId: patient.userId, email: patient.email });

    await app.prisma.appointmentBooking.update({ where: { id: bookingId }, data: { paymentStatus: "PAID", paidAt: new Date() } });

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/appointments/bookings/${bookingId}/identity`,
      headers: authHeader(patient.accessToken),
      payload: { ...VALID_TEST_IDENTITY, identityNumber: "10000000005" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("IDENTITY_LOCKED");
  });
});

describe("telehealth — doktor self-servis profil ucu (PUT /doctor/profile — [DPI] §1.4)", () => {
  let app: FastifyInstance;
  // `AUTH_RATE_LIMIT_MAX` (varsayılan 5/dk) `/auth/login` ucunda birikir (`makeDoctorSession`
  // her çağrıda bir `login` isteği yapar) — bu describe'daki TÜM testler TEK bir paylaşılan
  // doktor oturumunu yeniden kullanır (yalnızca bir test — "izin verilen alanlar" — kalıcı bir
  // değişiklik yazar, SONRAKİ hiçbir test o alanların ÖNCEKİ durumuna bağımlı değildir).
  let doctorId: string;
  let doctorUserToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setTelehealthModuleEnabled(app, true);

    const { doctor } = await createDoctorWithAvailability(app);
    doctorId = doctor.id;
    const session = await makeDoctorSession(app, doctor.id);
    doctorUserToken = session.doctorUserToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kapsam dışı bir alan (`title`) gönderilirse 422 döner (Zod `.strict()`, sessiz yok sayma YOK)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { title: "Prof. Dr." },
    });
    expect(res.statusCode).toBe(422);
  });

  it("fiyat/seans süresi alanı gönderilirse 422 döner (doktor satılan ürünü değiştiremez)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { sessionPriceCents: 999999 },
    });
    expect(res.statusCode).toBe(422);

    const unchanged = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    expect(unchanged.sessionPriceCents).not.toBe(999999);
  });

  it("`experienceYears` gönderilirse 422 döner (türetilmiş alan, kolon DEĞİLDİR)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { experienceYears: 10 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("izin verilen alanlar (subSpecialty/practiceStartYear/cvEntries) başarıyla güncellenir", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        subSpecialty: "Girişimsel Kardiyoloji",
        practiceStartYear: 2010,
        cvEntries: [{ kind: "EDUCATION", title: "Tıp Doktoru", organization: "Test Üniversitesi", startYear: 2004, endYear: 2010 }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.doctorProfile.subSpecialty).toBe("Girişimsel Kardiyoloji");
    expect(res.json().data.doctorProfile.practiceStartYear).toBe(2010);
    expect(res.json().data.doctorProfile.cvEntries).toHaveLength(1);

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.doctor.profile_updated", targetId: doctorId } });
    expect(audit).not.toBeNull();
  });

  it("`cvEntries` içinde HTML gönderilirse 422 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        cvEntries: [{ kind: "EDUCATION", title: "<b>Tıp Doktoru</b>", organization: "Test Üniversitesi", startYear: 2004 }],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it("`endYear < startYear` ise 422 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        cvEntries: [{ kind: "EDUCATION", title: "Tıp Doktoru", organization: "Test Üniversitesi", startYear: 2010, endYear: 2004 }],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  /**
   * Bug fix (backend-agent, 2026-09-14) — `doi` bir URL DEĞİLDİR (`https://doi.org/` öneki
   * render tarafında SABİT eklenir, bkz. `entities.ts::DoctorPublicationSchema` üstündeki not),
   * bu yüzden serbest biçimli DOI metni (`https://` ŞEMASIZ) artık `422` ile REDDEDİLMEMELİDİR.
   */
  it("serbest biçimli `doi` (https:// şemasız, düz sayı dahil) kabul edilir", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: 2020, doi: "1221321" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.doctorProfile.publications[0].doi).toBe("1221321");
  });

  it("`doi` içinde HTML gönderilirse hâlâ 422 döner (serbest metin ≠ HTML izni)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: 2020, doi: "<script>1</script>" }],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it("`url` hâlâ YALNIZCA https:// şeması kabul eder (XSS/açık şema koruması korunur)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: 2020, url: "javascript:alert(1)" }],
      },
    });
    expect(res.statusCode).toBe(422);
    // Detaylı hata anahtarı dizin-içi yolu taşır — frontend'in `describeArrayItemError`'ının
    // ayrıştırdığı format ("publications.0.url").
    expect(Object.keys(res.json().error.details ?? {})).toContain("publications.0.url");
  });

  it("`url` boş string (`\"\"`) ile 200 döner (savunma amaçlı gevşetme)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: 2020, url: "" }],
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("`year` string olarak gönderilirse coerce edilir, aralık dışı yıl 422 döner", async () => {
    const coerced = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: "2020" }] },
    });
    expect(coerced.statusCode).toBe(200);
    expect(coerced.json().data.doctorProfile.publications[0].year).toBe(2020);

    const outOfRange = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: 9999 }] },
    });
    expect(outOfRange.statusCode).toBe(422);
  });

  /**
   * Bug fix (backend-agent, 2026-09-14) — doktor hiçbir bilimsel yayın/özgeçmiş girdisi
   * eklemeden formu kaydettiğinde frontend'in gönderdiği GERÇEK payload (boş `cvEntries`/
   * `publications` dizileri + `null` `subSpecialty`/`practiceStartYear`) `422` ile
   * REDDEDİLMEMELİDİR — regresyon testi.
   */
  it("boş `cvEntries`/`publications` dizileri ve `null` opsiyonel alanlarla 200 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        subSpecialty: null,
        bio: "Yeni kısa özet.",
        aboutHtml: null,
        practiceStartYear: null,
        languages: ["tr"],
        cvEntries: [],
        publications: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.doctorProfile.cvEntries).toEqual([]);
    expect(res.json().data.doctorProfile.publications).toEqual([]);
    expect(res.json().data.doctorProfile.subSpecialty).toBeNull();
    expect(res.json().data.doctorProfile.practiceStartYear).toBeNull();
  });

  it("boş `subSpecialty` (`\"\"`) kabul edilir (422 DEĞİL)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { subSpecialty: "" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("bir yayın eklenip sonra boş diziye geri döndürüldüğünde şema patlamaz (200)", async () => {
    const withPublication = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: {
        publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "Test Makale", venue: "Test Dergisi", year: 2020 }],
      },
    });
    expect(withPublication.statusCode).toBe(200);
    expect(withPublication.json().data.doctorProfile.publications).toHaveLength(1);

    const clearedAgain = await app.inject({
      method: "PUT",
      url: "/api/v1/doctor/profile",
      headers: authHeader(doctorUserToken),
      payload: { publications: [] },
    });
    expect(clearedAgain.statusCode).toBe(200);
    expect(clearedAgain.json().data.doctorProfile.publications).toEqual([]);
  });
});

describe("telehealth — GET /doctor/bookings `scope` (§3.2)", () => {
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

  it("`scope=today` ile `from`/`to` BİRLİKTE gönderilirse 422 döner", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/doctor/bookings?scope=today&from=2026-01-01T00:00:00Z",
      headers: authHeader(doctorUserToken),
    });
    expect(res.statusCode).toBe(422);
  });

  it("`scope=all` (varsayılan) ile `from`/`to` birlikte kabul edilir (geriye dönük uyumluluk)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/doctor/bookings?scope=all&from=2026-01-01T00:00:00Z",
      headers: authHeader(doctorUserToken),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("telehealth — GET /doctor/overview ([DPI] §3.1)", () => {
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

  it("`generatedAt` ve `timeZone` zorunlu alanlarla 200 döner; `doctorId` parametresi YOKTUR", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.timeZone).toBe("Europe/Istanbul");
    expect(res.json().data.generatedAt).toBeTruthy();
    expect(res.json().data.today.total).toBe(0);
    expect(res.json().data.distinctPatientTotal).toBe(0);
    expect(res.json().data.pendingDocumentCount).toBe(0);
    expect(res.json().data.nextAppointment).toBeNull();
  });

  it("PAID booking'ler `distinctPatientTotal`'a DISTINCT olarak yansır (identityNumberHash anahtarı)", async () => {
    const { doctor } = await createDoctorWithAvailability(app);
    const { doctorUserToken } = await makeDoctorSession(app, doctor.id);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: bookingPayload(doctor.slug, [nextMondayNineAmUtc()]),
    });
    expect(created.statusCode).toBe(201);
    const bookingId = created.json().data.bookingId as string;
    await app.prisma.appointmentBooking.update({ where: { id: bookingId }, data: { paymentStatus: "PAID", paidAt: new Date() } });

    const res = await app.inject({ method: "GET", url: "/api/v1/doctor/overview", headers: authHeader(doctorUserToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.distinctPatientTotal).toBe(1);
  });
});
