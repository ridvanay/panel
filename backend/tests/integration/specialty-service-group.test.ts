import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/** Paket AI — `Specialty.serviceGroup` + `shortDescription`: admin doğrulama (422), public yerelleştirme, null varsayılanlar. */
const ADMIN_URL = "/api/v1/admin/telehealth/specialties";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("hizmet grubu + kısa açıklama (Paket AI)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let createdDe = false;

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: ADMIN_URL, headers: auth(adminToken), payload: { icon: "Heart", ...payload } });

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    createdDe = !(await app.prisma.locale.findUnique({ where: { code: "de" } }));
    await app.prisma.locale.upsert({
      where: { code: "de" },
      create: { code: "de", label: "de", nativeLabel: "de", enabled: true, isDefault: false, sortOrder: 5 },
      update: { enabled: true },
    });
    const { hashPassword } = await import("../../src/lib/password");
    const admin = await app.prisma.user.create({
      data: { email: `ai-admin-${crypto.randomUUID()}@example.com`, name: "Admin", passwordHash: await hashPassword("Sifre12345!"), role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: admin.email, password: "Sifre12345!" } });
    adminToken = login.json().data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    if (createdDe) await app.prisma.locale.deleteMany({ where: { code: "de" } });
    await app.close();
  });

  it("alanlar verilmezse null döner (geriye dönük uyumlu)", async () => {
    const res = await create({ name: "Plain", slug: "plain" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ serviceGroup: null, shortDescription: null });
  });

  it("izinli grup + kısa açıklama (kırpılır) + çeviri yazılır; PATCH ile null'a çekilebilir", async () => {
    const res = await create({
      name: "Neurosurgery",
      slug: "neurosurgery",
      serviceGroup: "surgery-oncology",
      shortDescription: "  Brain and spine surgery  ",
      translations: { de: { name: "Neurochirurgie", shortDescription: "Gehirn- und Wirbelsäulenchirurgie" } },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data).toMatchObject({ serviceGroup: "surgery-oncology", shortDescription: "Brain and spine surgery" });
    expect(data.translations.de.shortDescription).toBe("Gehirn- und Wirbelsäulenchirurgie");

    const patched = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${data.id}`, headers: auth(adminToken), payload: { serviceGroup: null, shortDescription: "" } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({ serviceGroup: null, shortDescription: null });
    await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${data.id}`, headers: auth(adminToken), payload: { serviceGroup: "fertility", shortDescription: "x" } });
    const renamed = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${data.id}`, headers: auth(adminToken), payload: { name: "Neuro" } });
    expect(renamed.json().data).toMatchObject({ name: "Neuro", serviceGroup: "fertility", shortDescription: "x" });
  });

  it("geçersiz grup ve 120 karakteri aşan kısa açıklama -> 422 (alan adıyla)", async () => {
    const badGroup = await create({ name: "Bad", slug: "bad", serviceGroup: "not-a-group" });
    expect(badGroup.statusCode).toBe(422);
    expect(JSON.stringify(badGroup.json().error)).toContain("serviceGroup");

    const tooLong = await create({ name: "Long", slug: "long", shortDescription: "a".repeat(121) });
    expect(tooLong.statusCode).toBe(422);
    expect(JSON.stringify(tooLong.json().error)).toContain("shortDescription");

    const tooLongTr = await create({ name: "Long2", slug: "long2", translations: { de: { shortDescription: "a".repeat(121) } } });
    expect(tooLongTr.statusCode).toBe(422);

    const bad = await app.prisma.specialty.findFirst({ where: { slug: { in: ["bad", "long", "long2"] } } });
    expect(bad).toBeNull();
    const exact = await create({ name: "Exact", slug: "exact", shortDescription: "a".repeat(120) });
    expect(exact.statusCode).toBe(201);
  });

  it("public liste ve detay: serviceGroup + yerelleştirilmiş shortDescription; çeviri yoksa kanonik", async () => {
    await app.prisma.specialty.create({
      data: {
        name: "Dental Care",
        slug: "dentalcare",
        icon: "Smile",
        serviceGroup: "aesthetic-dental-hair",
        shortDescription: "Dental treatments at authorized dental facilities",
        translations: { de: { name: "Zahnmedizin", shortDescription: "Zahnbehandlungen" } },
      },
    });
    const list = (await app.inject({ method: "GET", url: "/api/v1/specialties" })).json().data as Array<Record<string, unknown>>;
    const en = list.find((s) => s.slug === "dentalcare")!;
    expect(en).toMatchObject({ serviceGroup: "aesthetic-dental-hair", shortDescription: "Dental treatments at authorized dental facilities", name: "Dental Care" });

    const de = (await app.inject({ method: "GET", url: "/api/v1/specialties?locale=de" })).json().data.find((s: { slug: string }) => s.slug === "dentalcare");
    expect(de).toMatchObject({ name: "Zahnmedizin", shortDescription: "Zahnbehandlungen", serviceGroup: "aesthetic-dental-hair" });

    const fr = (await app.inject({ method: "GET", url: "/api/v1/specialties/dentalcare?locale=fr" })).json().data;
    expect(fr).toMatchObject({ shortDescription: "Dental treatments at authorized dental facilities", serviceGroup: "aesthetic-dental-hair" });
    const detail = (await app.inject({ method: "GET", url: "/api/v1/specialties/dentalcare?locale=de" })).json().data;
    expect(detail.shortDescription).toBe("Zahnbehandlungen");
  });
});
