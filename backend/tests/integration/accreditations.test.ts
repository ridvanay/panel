import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket V (İş 4) — yetki belgeleri: belge numarası olmadan aktif edilemez (API + DB CHECK), süresi
 * geçen belge sitede gizlenir ve admin listesinde `expired` uyarısı taşır, doğrulama adresi yalnızca
 * https, logo yalnızca PNG/JPG/WebP medya, yazma yalnızca ADMIN.
 */
const ADMIN_URL = "/api/v1/admin/accreditations";
const PUBLIC_URL = "/api/v1/accreditations";

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUser(app: FastifyInstance, role: "ADMIN" | "MANAGER") {
  const { hashPassword } = await import("../../src/lib/password");
  return app.prisma.user.create({
    data: {
      email: `accreditation-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "Sifre12345!" } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe("yetki belgeleri ve akreditasyonlar", () => {
  let app: FastifyInstance;
  let admin: string;
  let manager: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    // Giriş hız sınırına takılmamak için kullanıcılar bir kez oluşturulur.
    admin = await login(app, (await createUser(app, "ADMIN")).email);
    manager = await login(app, (await createUser(app, "MANAGER")).email);
  });

  beforeEach(async () => {
    await app.prisma.accreditationBadge.deleteMany();
    await app.prisma.media.deleteMany();
    await app.prisma.auditLog.deleteMany({ where: { action: { startsWith: "accreditation." } } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  const create = (payload: Record<string, unknown>, token = admin) => app.inject({ method: "POST", url: ADMIN_URL, headers: auth(token), payload });

  it("tablo boş başlar; public liste boş", async () => {
    expect((await app.inject({ method: "GET", url: PUBLIC_URL })).json().data).toEqual([]);
    expect((await app.inject({ method: "GET", url: ADMIN_URL, headers: auth(admin) })).json().data).toEqual([]);
  });

  it("belge numarası olmadan aktif edilemez (oluşturma ve güncelleme); pasif taslak kaydedilebilir ama sitede görünmez", async () => {
    const bad = await create({ name: "Health Türkiye", issuer: "USHAŞ", isActive: true });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details.certificateNo).toBeDefined();

    const draft = await create({ name: "Health Türkiye", issuer: "USHAŞ" });
    expect(draft.statusCode).toBe(201);
    const id = draft.json().data.id as string;
    expect(draft.json().data).toMatchObject({ isActive: false, publiclyVisible: false, certificateNo: null });

    const activate = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: auth(admin), payload: { isActive: true } });
    expect(activate.statusCode).toBe(422);
    const blank = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: auth(admin), payload: { isActive: true, certificateNo: "   " } });
    expect(blank.statusCode).toBe(422);

    const ok = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: auth(admin), payload: { isActive: true, certificateNo: "HT-2026-001" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ isActive: true, publiclyVisible: true });

    // Aktif belgenin numarası silinemez.
    const clear = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: auth(admin), payload: { certificateNo: null } });
    expect(clear.statusCode).toBe(422);
    expect(await app.prisma.auditLog.count({ where: { action: { startsWith: "accreditation." } } })).toBe(2);
  });

  it("DB CHECK: belge numarasız aktif kayıt veritabanı düzeyinde de reddedilir", async () => {
    const row = await app.prisma.accreditationBadge.create({ data: { name: "TÜRSAB", issuer: "TÜRSAB" } });
    await expect(app.prisma.accreditationBadge.update({ where: { id: row.id }, data: { isActive: true } })).rejects.toThrow();
  });

  it("süresi geçen belge sitede gizlenir, admin listesinde uyarı (expired) taşır; bugün geçerli olan görünür", async () => {
    await create({ name: "Expired", issuer: "X", certificateNo: "E-1", isActive: true, validUntil: isoDay(-2) });
    await create({ name: "Valid", issuer: "Y", certificateNo: "V-1", isActive: true, validUntil: isoDay(30), sortOrder: 1 });
    await create({ name: "Open ended", issuer: "Z", certificateNo: "O-1", isActive: true, sortOrder: 2 });

    const pub = (await app.inject({ method: "GET", url: PUBLIC_URL })).json().data as { name: string; certificateNo: string }[];
    expect(pub.map((b) => b.name)).toEqual(["Valid", "Open ended"]);

    const list = (await app.inject({ method: "GET", url: ADMIN_URL, headers: auth(manager) })).json().data as { name: string; expired: boolean; publiclyVisible: boolean }[];
    expect(list.find((b) => b.name === "Expired")).toMatchObject({ expired: true, publiclyVisible: false });
    expect(list.find((b) => b.name === "Valid")).toMatchObject({ expired: false, publiclyVisible: true });
  });

  it("çeviri: public uç aktif dilin adını/açıklamasını döner; yoksa kanonik EN ad", async () => {
    await create({
      name: "Licensed travel agency",
      issuer: "TÜRSAB",
      certificateNo: "A-1234",
      isActive: true,
      verificationUrl: "https://www.tursab.org.tr/tr/ddsv",
      translations: { tr: { name: "Lisanslı seyahat acentesi", description: "TÜRSAB üyesi" }, en: { description: "TÜRSAB member" } },
    });
    const tr = (await app.inject({ method: "GET", url: `${PUBLIC_URL}?locale=tr` })).json().data[0];
    expect(tr).toMatchObject({ name: "Lisanslı seyahat acentesi", description: "TÜRSAB üyesi", certificateNo: "A-1234", verificationUrl: "https://www.tursab.org.tr/tr/ddsv" });
    const en = (await app.inject({ method: "GET", url: `${PUBLIC_URL}?locale=en` })).json().data[0];
    expect(en).toMatchObject({ name: "Licensed travel agency", description: "TÜRSAB member" });
  });

  it("doğrulama adresi yalnızca https; logo yalnızca PNG/JPG/WebP medya", async () => {
    expect((await create({ name: "A", issuer: "B", verificationUrl: "http://example.com" })).statusCode).toBe(422);
    expect((await create({ name: "A", issuer: "B", verificationUrl: "javascript:alert(1)" })).statusCode).toBe(422);
    const pdf = await app.prisma.media.create({ data: { path: "x.pdf", url: "/uploads/x.pdf", filename: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 } });
    expect((await create({ name: "A", issuer: "B", logoMediaId: pdf.id })).statusCode).toBe(422);
    const png = await app.prisma.media.create({ data: { path: "l.png", url: "/uploads/l.png", filename: "l.png", mimeType: "image/png", sizeBytes: 10, altText: "Logo" } });
    const res = await create({ name: "A", issuer: "B", logoMediaId: png.id, certificateNo: "1", isActive: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.logoUrl).toMatch(/\/uploads\/l\.png$/);
    expect((await app.inject({ method: "GET", url: PUBLIC_URL })).json().data[0].logoAlt).toBe("Logo");
  });

  it("yazma yalnızca ADMIN: MANAGER okuyabilir ama oluşturamaz/güncelleyemez/silemez", async () => {
    const created = await create({ name: "A", issuer: "B" });
    const id = created.json().data.id as string;
    expect((await create({ name: "C", issuer: "D" }, manager)).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: auth(manager), payload: { name: "X" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `${ADMIN_URL}/${id}`, headers: auth(manager) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: ADMIN_URL, headers: auth(manager) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: ADMIN_URL })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: `${ADMIN_URL}/${id}`, headers: auth(admin) })).statusCode).toBe(204);
  });
});
