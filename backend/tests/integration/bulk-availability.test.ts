import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { invalidateEarliestAvailability } from "../../src/modules/telehealth/lib/earliest-availability";

/**
 * Paket Q — admin toplu çalışma saati/izin girişi (CSV + panelden çoklu doktor): şablon, doğrulama,
 * önizleme, kipler, idempotent izin, bayat önizleme, transaction geri dönüşü, geri alma, yetki.
 */
const VALID_TEST_IDENTITY = { citizenshipType: "TR" as const, identityNumber: "10000000146", birthDate: "1990-01-01" };
const BASE = "/api/v1/admin/telehealth/bulk-availability";
const BOM = String.fromCharCode(0xfeff);
const HEADER = "doktor_kodu;doktor_adi;kayit_turu;gun;baslangic_tarihi;bitis_tarihi;baslangic_saati;bitis_saati;izin_turu;not";

/** n hafta sonraki Pazartesi (UTC 00:00) — Europe/Istanbul 09:00 = 06:00Z. */
function mondayInWeeks(n: number): Date {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday + 7 * n));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const at = (day: Date, hourUtc: number) => new Date(day.getTime() + hourUtc * 3600_000);
const trDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

type Rule = { dayOfWeek: number; startMinute: number; endMinute: number };
const A_RULES: Rule[] = [
  { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
  { dayOfWeek: 3, startMinute: 540, endMinute: 720 },
];
const B_RULES: Rule[] = [{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }];

describe("Paket Q — toplu çalışma saati/izin", () => {
  let app: FastifyInstance;
  let admin: { authorization: string };
  let manager: { authorization: string };
  let editor: { authorization: string };
  const A = { id: "", slug: `dra-${crypto.randomUUID().slice(0, 8)}` };
  const B = { id: "", slug: `drb-${crypto.randomUUID().slice(0, 8)}` };
  const C = { id: "", slug: `drc-${crypto.randomUUID().slice(0, 8)}` };
  const D = { id: "", slug: `drd-${crypto.randomUUID().slice(0, 8)}` };
  let fixtureTimeOffIds: string[] = [];
  let appointmentId = "";
  let bookingNumber = "";
  const wedWeek2 = addDays(mondayInWeeks(2), 2);

  async function createUser(role: "MANAGER" | "EDITOR") {
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: { email: `bq-${crypto.randomUUID()}@example.com`, name: "Personel", passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
    return { authorization: `Bearer ${login.json().data.tokens.accessToken as string}` };
  }

  const setRules = (doctorId: string, rules: Rule[]) =>
    app.prisma.$transaction([
      app.prisma.doctorAvailability.deleteMany({ where: { doctorId } }),
      app.prisma.doctorAvailability.createMany({ data: rules.map((r) => ({ ...r, doctorId, isActive: true })) }),
    ]);
  const rulesOf = async (doctorId: string) =>
    (await app.prisma.doctorAvailability.findMany({ where: { doctorId }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] })).map(({ dayOfWeek, startMinute, endMinute }) => ({
      dayOfWeek,
      startMinute,
      endMinute,
    }));
  async function resetFixtures() {
    await setRules(A.id, A_RULES);
    await setRules(B.id, B_RULES);
    await app.prisma.doctorTimeOff.deleteMany({ where: { id: { notIn: fixtureTimeOffIds } } });
    await app.prisma.doctorAvailabilityBulkOperation.deleteMany({});
    invalidateEarliestAvailability();
  }
  const csvPayload = (lines: string[], weeklyMode: "replace" | "append" = "replace") => ({
    fileName: "saatler.csv",
    contentBase64: Buffer.from(`${BOM}${[HEADER, ...lines].join("\r\n")}`, "utf8").toString("base64"),
    weeklyMode,
  });
  const previewCsv = (lines: string[], weeklyMode: "replace" | "append" = "replace") =>
    app.inject({ method: "POST", url: `${BASE}/preview/csv`, headers: admin, payload: csvPayload(lines, weeklyMode) });
  const apply = (previewId: string, acknowledgeConflicts = false) =>
    app.inject({ method: "POST", url: `${BASE}/apply`, headers: admin, payload: { previewId, acknowledgeConflicts } });

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = { authorization: `Bearer ${(await registerTestUser(app)).accessToken}` };
    manager = await createUser("MANAGER");
    editor = await createUser("EDITOR");

    const base = { title: "Dr.", bio: "Test", languages: ["tr"], timeZone: "Europe/Istanbul", sessionDurationMin: 30, sessionPriceCents: null };
    for (const [ref, name, extra] of [
      [A, "Ayşe Bulk", {}],
      [B, "Burak Bulk", {}],
      [C, "Cem Arşiv", { isActive: false, archivedAt: new Date() }],
      [D, "Deniz Pasif", { isActive: false }],
    ] as const) {
      const d = await app.prisma.doctorProfile.create({ data: { ...base, fullName: name, slug: ref.slug, isActive: true, ...extra } });
      ref.id = d.id;
    }
    await setRules(A.id, A_RULES);
    await setRules(B.id, B_RULES);
    const fixtures = await Promise.all([
      app.prisma.doctorTimeOff.create({ data: { doctorId: A.id, startsAt: at(mondayInWeeks(20), -3), endsAt: at(mondayInWeeks(20), 21), kind: "VACATION", allDay: true, note: "=cmd|' /C calc'!A1" } }),
      app.prisma.doctorTimeOff.create({ data: { doctorId: A.id, startsAt: at(mondayInWeeks(-3), -3), endsAt: at(mondayInWeeks(-3), 21), kind: "OTHER", allDay: true, note: "gecmis" } }),
    ]);
    fixtureTimeOffIds = fixtures.map((f) => f.id);

    // Onaylı randevu: A, 2 hafta sonraki Çarşamba 10:00 TSİ (ücretsiz doktor → anında SCHEDULED).
    const booking = await app.inject({
      method: "POST",
      url: "/api/v1/appointments/bookings",
      payload: { doctorSlug: A.slug, slots: [at(wedWeek2, 7).toISOString()], patientName: "Gizli Hasta", patientEmail: `h-${crypto.randomUUID()}@example.com`, identity: VALID_TEST_IDENTITY, consent: true },
    });
    expect(booking.statusCode).toBe(201);
    appointmentId = booking.json().data.appointments[0].id;
    bookingNumber = (await app.prisma.appointmentBooking.findFirstOrThrow({ where: { appointments: { some: { id: appointmentId } } } })).bookingNumber;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("şablon: BOM, ';' ayraç, yalnızca aktif/arşivsiz doktorlar, mevcut saatler + gelecekteki izinler, CSV injection öneki", async () => {
    const res = await app.inject({ method: "GET", url: `${BASE}/template`, headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(".csv");
    expect([...res.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = res.rawPayload.toString("utf8");
    expect(text).toContain(HEADER);
    expect(text).toContain(`${A.slug};Dr. Ayşe Bulk (Europe/Istanbul);CALISMA;Pzt;;;09:00;12:00;;`);
    expect(text).toContain(`${A.slug};Dr. Ayşe Bulk (Europe/Istanbul);CALISMA;Çar;;;09:00;12:00;;`);
    expect(text).toContain(`${B.slug};Dr. Burak Bulk (Europe/Istanbul);CALISMA;Pzt;;;10:00;11:00;;`);
    expect(text).not.toContain(C.slug);
    expect(text).not.toContain(D.slug);
    expect(text).toContain(`IZIN;;${trDate(mondayInWeeks(20))};${trDate(mondayInWeeks(20))};;;TATIL;'=cmd|' /C calc'!A1`);
    expect(text).not.toContain("gecmis");

    const comma = await app.inject({ method: "GET", url: `${BASE}/template?delimiter=comma`, headers: admin });
    expect(comma.rawPayload.toString("utf8")).toContain("doktor_kodu,doktor_adi,kayit_turu");
  });

  it("yetki: yalnızca ADMIN — MANAGER/EDITOR 403, oturumsuz 401", async () => {
    for (const headers of [manager, editor]) {
      expect((await app.inject({ method: "GET", url: `${BASE}/template`, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: `${BASE}/preview/csv`, headers, payload: csvPayload([]) })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: `${BASE}/operations`, headers })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: `${BASE}/template` })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `${BASE}/preview/csv`, headers: admin, payload: { ...csvPayload([]), fileName: "x.xlsx" } })).statusCode).toBe(422);
  });

  it("doğrulama: her hata satır numarasıyla; tek hata varsa hiçbir şey uygulanmaz", async () => {
    await resetFixtures();
    const res = await previewCsv([
      `dr-yok;;CALISMA;Pzt;;;09:00;10:00;;`,
      `${C.slug};;CALISMA;Pzt;;;09:00;10:00;;`,
      `${A.slug};;CALISMA;Pzt;;;09:00;12:00;;`,
      `${A.slug};;CALISMA;Pzt;;;11:00;13:00;;`,
      `${A.slug};;IZIN;;${trDate(mondayInWeeks(-2))};;;;TATIL;`,
      `${A.slug};;CALISMA;Xyz;;;09:00;12:00;;`,
      `${A.slug};;CALISMA;Sal;;;12:00;09:00;;`,
      `${D.slug};;IZIN;;${trDate(mondayInWeeks(3))};;;;TATIL;`,
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.valid).toBe(false);
    expect(body.preview).toBeNull();
    const byRow = new Map((body.errors as { row: number; message: string }[]).map((e) => [e.row, e.message]));
    expect([...byRow.keys()]).toEqual([2, 3, 5, 6, 7, 8, 9]);
    expect(byRow.get(2)).toContain("Bilinmeyen doktor kodu");
    expect(byRow.get(3)).toContain("arşivlenmiş");
    expect(byRow.get(5)).toContain("çakışıyor");
    expect(byRow.get(6)).toContain("Geçmiş tarihli");
    expect(byRow.get(7)).toContain("Geçersiz gün");
    expect(byRow.get(8)).toContain("Bitiş saati");
    expect(byRow.get(9)).toContain("aktif değil");
    expect(await rulesOf(A.id)).toEqual(A_RULES);
    expect(await app.prisma.doctorAvailabilityBulkOperation.count()).toBe(0);
  });

  it("önizleme (değiştir): eklenen/kaldırılan/değişmeyen, dosyada olmayan doktorlar, kaldırılan saate denk gelen onaylı randevu; onaysız 400, onaylı uygulanır", async () => {
    await resetFixtures();
    const res = await previewCsv([`${A.slug};;CALISMA;Pzt;;;09:00;12:00;;`, `${A.slug};;CALISMA;Sal;;;10:00;12:00;;`]);
    const body = res.json().data;
    expect(body.valid).toBe(true);
    const p = body.preview;
    expect(p.doctors).toHaveLength(1);
    const a = p.doctors[0];
    expect(a.weekly.added).toEqual([{ dayOfWeek: 2, startMinute: 600, endMinute: 720, isActive: true }]);
    expect(a.weekly.removed).toEqual([{ dayOfWeek: 3, startMinute: 540, endMinute: 720, isActive: true }]);
    expect(a.weekly.unchanged).toEqual([{ dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: true }]);
    expect(a.conflicts).toEqual([expect.objectContaining({ appointmentId, bookingNumber, reason: "REMOVED_HOURS" })]);
    expect(JSON.stringify(p)).not.toContain("Gizli Hasta");
    expect(p.untouchedDoctors.map((d: { slug: string }) => d.slug)).toEqual([B.slug]);

    const noAck = await apply(p.previewId);
    expect(noAck.statusCode).toBe(400);
    expect(noAck.json().error.code).toBe("BULK_CONFLICT_ACK_REQUIRED");
    expect(await rulesOf(A.id)).toEqual(A_RULES);

    const applied = await apply(p.previewId, true);
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data).toMatchObject({ source: "CSV", fileName: "saatler.csv", rowCount: 2, doctorCount: 1, undoneAt: null });
    expect(await rulesOf(A.id)).toEqual([
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 2, startMinute: 600, endMinute: 720 },
    ]);
    expect(await rulesOf(B.id)).toEqual(B_RULES);
    const appt = await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appt.status).toBe("SCHEDULED");
    expect(appt.startsAt.toISOString()).toBe(at(wedWeek2, 7).toISOString());
    const audit = await app.prisma.auditLog.findFirst({ where: { action: "telehealth.availability.bulk_import" } });
    expect(audit?.metadata).toMatchObject({ source: "CSV", fileName: "saatler.csv", rowCount: 2, doctorCount: 1 });
    // Önizleme tek kullanımlık.
    expect((await apply(p.previewId, true)).statusCode).toBe(404);
  });

  it("yalnızca ekle kipi: mevcutla çakışma hata; çakışmayan eklenir; önizlemede kip değiştirilebilir", async () => {
    await resetFixtures();
    const clash = (await previewCsv([`${A.slug};;CALISMA;Pzt;;;11:00;13:00;;`], "append")).json().data;
    expect(clash.valid).toBe(false);
    expect(clash.errors[0]).toMatchObject({ row: 2 });
    expect(clash.errors[0].message).toContain("Yalnızca ekle");

    const okRes = (await previewCsv([`${A.slug};;CALISMA;Pzt;;;14:00;17:00;;`], "append")).json().data;
    expect(okRes.preview.doctors[0].weekly.removed).toEqual([]);
    expect(okRes.preview.doctors[0].weekly.added).toEqual([{ dayOfWeek: 1, startMinute: 840, endMinute: 1020, isActive: true }]);
    expect(okRes.preview.totals.conflicts).toBe(0);

    const replaced = await app.inject({ method: "POST", url: `${BASE}/previews/${okRes.preview.previewId}/mode`, headers: admin, payload: { weeklyMode: "replace" } });
    expect(replaced.json().data.preview.weeklyMode).toBe("replace");
    expect(replaced.json().data.preview.doctors[0].weekly.removed).toHaveLength(2);
    const back = await app.inject({ method: "POST", url: `${BASE}/previews/${okRes.preview.previewId}/mode`, headers: admin, payload: { weeklyMode: "append" } });
    expect((await apply(back.json().data.preview.previewId)).statusCode).toBe(200);
    expect(await rulesOf(A.id)).toEqual([A_RULES[0], { dayOfWeek: 1, startMinute: 840, endMinute: 1020 }, A_RULES[1]]);
  });

  it("sınırlar: pasif mevcut kuralla aynı başlangıç (append) hata; doktor başına 21'den fazla CALISMA satırı tek hata; hata listesi 200 ile sınırlı; dosya adında kontrol karakteri 422", async () => {
    await resetFixtures();
    await app.prisma.doctorAvailability.create({ data: { doctorId: A.id, dayOfWeek: 2, startMinute: 600, endMinute: 630, isActive: false } });
    const inactiveClash = (await previewCsv([`${A.slug};;CALISMA;Sal;;;10:00;11:00;;`], "append")).json().data;
    expect(inactiveClash.valid).toBe(false);
    expect(inactiveClash.errors[0].message).toContain("pasif olabilir");

    const many = Array.from({ length: 30 }, () => `${A.slug};;CALISMA;Pzt;;;09:00;10:00;;`);
    const tooMany = (await previewCsv(many)).json().data;
    expect(tooMany.errors).toHaveLength(1);
    expect(tooMany.errors[0].message).toContain("en fazla 21 CALISMA");

    const unknown = Array.from({ length: 250 }, (_, i) => `dr-yok-${i};;CALISMA;Pzt;;;09:00;10:00;;`);
    const capped = (await previewCsv(unknown)).json().data;
    expect(capped.errors).toHaveLength(201);
    expect(capped.errors[200].message).toContain("50 hata daha");

    const badName = await app.inject({ method: "POST", url: `${BASE}/preview/csv`, headers: admin, payload: { ...csvPayload([]), fileName: "a\u0007b.csv" } });
    expect(badName.statusCode).toBe(422);
  });

  it("izinler yalnızca eklenir ve idempotent: aynı dosya iki kez → tek kayıt; izne denk gelen onaylı randevu uyarısı; not önizlemede yok", async () => {
    await resetFixtures();
    const lines = [`${A.slug};;IZIN;;${trDate(wedWeek2)};${trDate(wedWeek2)};;;KONGRE;Kongre notu`];
    const first = (await previewCsv(lines)).json().data.preview;
    expect(first.doctors[0].weekly).toBeNull();
    expect(first.doctors[0].timeOff.toAdd).toEqual([
      { startsAt: at(wedWeek2, -3).toISOString(), endsAt: at(wedWeek2, 21).toISOString(), kind: "CONGRESS", allDay: true, hasNote: true },
    ]);
    expect(JSON.stringify(first)).not.toContain("Kongre notu");
    expect(first.doctors[0].conflicts).toEqual([expect.objectContaining({ appointmentId, reason: "TIME_OFF" })]);
    expect((await apply(first.previewId, true)).statusCode).toBe(200);
    expect(await rulesOf(A.id)).toEqual(A_RULES);

    const second = (await previewCsv(lines)).json().data.preview;
    expect(second.totals).toMatchObject({ timeOffAdded: 0, timeOffSkipped: 1 });
    expect((await apply(second.previewId, true)).statusCode).toBe(422);
    expect(await app.prisma.doctorTimeOff.count({ where: { doctorId: A.id, kind: "CONGRESS" } })).toBe(1);
    expect((await app.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe("SCHEDULED");
  });

  it("bayat önizleme: önizlemeden sonra saatler değiştiyse uygulama 409, hiçbir şey yazılmaz", async () => {
    await resetFixtures();
    const p = (await previewCsv([`${A.slug};;CALISMA;Pzt;;;09:00;12:00;;`, `${A.slug};;CALISMA;Çar;;;09:00;12:00;;`, `${A.slug};;CALISMA;Cum;;;09:00;10:00;;`])).json().data.preview;
    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/telehealth/doctors/${A.id}/availability`,
      headers: admin,
      payload: { rules: [...A_RULES, { dayOfWeek: 4, startMinute: 540, endMinute: 600 }] },
    });
    expect(put.statusCode).toBe(200);
    const res = await apply(p.previewId, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("BULK_PREVIEW_STALE");
    expect(await rulesOf(A.id)).toEqual([...A_RULES.slice(0, 2), { dayOfWeek: 4, startMinute: 540, endMinute: 600 }].sort((x, y) => x.dayOfWeek - y.dayOfWeek));
  });

  it("transaction geri dönüşü: yazma sırasında hata olursa saatler ve izinler değişmez", async () => {
    await resetFixtures();
    const p = (await previewCsv([`${A.slug};;CALISMA;Cum;;;09:00;10:00;;`, `${B.slug};;IZIN;;${trDate(mondayInWeeks(5))};;;;TATIL;`])).json().data.preview;
    const original = app.prisma.$transaction.bind(app.prisma) as (fn: unknown, opts?: unknown) => Promise<unknown>;
    const spy = vi.spyOn(app.prisma, "$transaction").mockImplementationOnce(((fn: (tx: object) => Promise<unknown>, opts: unknown) =>
      original(
        (tx: object) =>
          fn(
            new Proxy(tx, {
              get: (target, prop) =>
                prop === "doctorAvailabilityBulkOperation" ? { create: () => Promise.reject(new Error("yazma hatası (test)")) } : Reflect.get(target, prop),
            })
          ),
        opts
      )) as never);
    try {
      expect((await apply(p.previewId, true)).statusCode).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await rulesOf(A.id)).toEqual(A_RULES);
    expect(await app.prisma.doctorTimeOff.count({ where: { doctorId: B.id } })).toBe(0);
    expect(await app.prisma.doctorAvailabilityBulkOperation.count()).toBe(0);
  });

  it("geri alma: önceki saatler döner, eklenen izinler silinir; ikinci geri alma 409; audit", async () => {
    await resetFixtures();
    const p = (
      await previewCsv([`${A.slug};;CALISMA;Pzt;;;08:00;12:00;;`, `${A.slug};;CALISMA;Çar;;;09:00;12:00;;`, `${B.slug};;IZIN;;${trDate(mondayInWeeks(6))};;;;DIGER;`])
    ).json().data.preview;
    const op = (await apply(p.previewId, true)).json().data;
    expect(await rulesOf(A.id)).toEqual([
      { dayOfWeek: 1, startMinute: 480, endMinute: 720 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 720 },
    ]);
    expect(await app.prisma.doctorTimeOff.count({ where: { doctorId: B.id } })).toBe(1);

    const list = (await app.inject({ method: "GET", url: `${BASE}/operations`, headers: admin })).json().data;
    expect(list[0]).toMatchObject({ id: op.id, undoneAt: null, summary: { rulesAdded: 1, rulesRemoved: 1, timeOffAdded: 1 } });

    const undo = await app.inject({ method: "POST", url: `${BASE}/operations/${op.id}/undo`, headers: admin });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().data.undoneAt).not.toBeNull();
    expect(await rulesOf(A.id)).toEqual(A_RULES);
    expect(await app.prisma.doctorTimeOff.count({ where: { doctorId: B.id } })).toBe(0);
    expect((await app.inject({ method: "POST", url: `${BASE}/operations/${op.id}/undo`, headers: admin })).statusCode).toBe(409);
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.availability.bulk_undo", targetId: op.id } })).toBe(1);
  });

  it("geri alma durur: sonradan elle değiştirilmiş saat ya da silinmiş izin varsa listelenir, hiçbir şey değişmez", async () => {
    await resetFixtures();
    const p1 = (await previewCsv([`${A.slug};;CALISMA;Pzt;;;08:00;12:00;;`, `${A.slug};;CALISMA;Çar;;;09:00;12:00;;`])).json().data.preview;
    const op1 = (await apply(p1.previewId)).json().data;
    const manual = [{ dayOfWeek: 5, startMinute: 600, endMinute: 660 }];
    await app.inject({ method: "PUT", url: `/api/v1/admin/telehealth/doctors/${A.id}/availability`, headers: admin, payload: { rules: manual } });
    const blocked = await app.inject({ method: "POST", url: `${BASE}/operations/${op1.id}/undo`, headers: admin });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("BULK_UNDO_BLOCKED");
    expect(blocked.json().error.details.changes[0]).toContain("Dr. Ayşe Bulk");
    expect(await rulesOf(A.id)).toEqual(manual);

    const p2 = (await previewCsv([`${B.slug};;IZIN;;${trDate(mondayInWeeks(7))};;;;TATIL;`])).json().data.preview;
    const op2 = (await apply(p2.previewId)).json().data;
    const created = await app.prisma.doctorTimeOff.findFirstOrThrow({ where: { doctorId: B.id } });
    await app.inject({ method: "DELETE", url: `/api/v1/admin/telehealth/doctors/${B.id}/time-off/${created.id}`, headers: admin });
    const blocked2 = await app.inject({ method: "POST", url: `${BASE}/operations/${op2.id}/undo`, headers: admin });
    expect(blocked2.statusCode).toBe(409);
    expect(blocked2.json().error.details.changes[0]).toContain("silinmiş");
  });

  it("çoklu doktor — haftalık şablon: seçilen doktorlara aynı saatler; arşivli doktor seçilirse hata", async () => {
    await resetFixtures();
    const rules = [
      { dayOfWeek: 1, startMinute: 480, endMinute: 600 },
      { dayOfWeek: 4, startMinute: 780, endMinute: 900 },
    ];
    const bad = await app.inject({ method: "POST", url: `${BASE}/preview/template`, headers: admin, payload: { doctorIds: [A.id, C.id], rules, weeklyMode: "replace" } });
    expect(bad.json().data.valid).toBe(false);
    expect(bad.json().data.errors[0].message).toContain("arşivlenmiş");
    const overlapping = await app.inject({
      method: "POST",
      url: `${BASE}/preview/template`,
      headers: admin,
      payload: { doctorIds: [A.id], rules: [...rules, { dayOfWeek: 1, startMinute: 540, endMinute: 660 }] },
    });
    expect(overlapping.json().data.errors[0].message).toContain("çakışıyor");

    const res = await app.inject({ method: "POST", url: `${BASE}/preview/template`, headers: admin, payload: { doctorIds: [A.id, B.id], rules, weeklyMode: "replace" } });
    const p = res.json().data.preview;
    expect(p.source).toBe("TEMPLATE");
    expect(p.doctors).toHaveLength(2);
    expect(p.totals.conflicts).toBe(1); // A'nın Çarşamba randevusu
    expect((await apply(p.previewId, true)).statusCode).toBe(200);
    expect(await rulesOf(A.id)).toEqual(rules);
    expect(await rulesOf(B.id)).toEqual(rules);
  });

  it("çoklu doktor — toplu izin (bayram): her doktora kendi diliminde tam gün izin, idempotent; en erken randevu önbelleği yenilenir", async () => {
    await resetFixtures();
    const earliestOf = async (slug: string) => (await app.inject({ method: "GET", url: `/api/v1/doctors/${slug}` })).json().data.earliestAvailableAt as string;
    const before = await earliestOf(B.slug);
    expect(before).toBeTruthy();
    const day = new Date(`${before.slice(0, 10)}T00:00:00Z`); // B'nin en erken günü (10:00 TSİ = 07:00Z, aynı UTC günü)
    const payload = { doctorIds: [A.id, B.id], startDate: isoDate(day), endDate: isoDate(addDays(day, 1)), kind: "VACATION", note: "Bayram" };
    const p = (await app.inject({ method: "POST", url: `${BASE}/preview/time-off`, headers: admin, payload })).json().data.preview;
    expect(p.source).toBe("TIME_OFF");
    expect(p.totals.timeOffAdded).toBe(2);
    expect(p.doctors.every((d: { timeOff: { toAdd: { allDay: boolean; startsAt: string }[] } }) => d.timeOff.toAdd[0]!.allDay && d.timeOff.toAdd[0]!.startsAt === at(day, -3).toISOString())).toBe(true);
    expect((await apply(p.previewId, true)).statusCode).toBe(200);
    const after = await earliestOf(B.slug);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());

    const again = (await app.inject({ method: "POST", url: `${BASE}/preview/time-off`, headers: admin, payload })).json().data.preview;
    expect(again.totals).toMatchObject({ timeOffAdded: 0, timeOffSkipped: 2 });
    const past = await app.inject({ method: "POST", url: `${BASE}/preview/time-off`, headers: admin, payload: { ...payload, startDate: isoDate(mondayInWeeks(-2)), endDate: isoDate(mondayInWeeks(-2)) } });
    expect(past.json().data.valid).toBe(false);
    expect(past.json().data.errors[0].message).toContain("Geçmiş tarihli");
  });
});
