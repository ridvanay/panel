import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Uzmanlık kartı görseli — `Specialty.imageMediaId` (anasayfa "Uzmanlık kartları" bloğu).
 * Yalnızca PNG/JPG/WebP kabul edilir; public liste/detay ucu `imageUrl` döner; medya silinirse
 * alan NULL'a düşer (FK `ON DELETE SET NULL`).
 */
const ADMIN_URL = "/api/v1/admin/telehealth/specialties";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("telehealth — uzmanlık görseli", () => {
  let app: FastifyInstance;
  let adminToken: string;

  async function createMedia(mimeType: string) {
    const suffix = crypto.randomUUID();
    const ext = mimeType.split("/")[1];
    return app.prisma.media.create({
      data: { path: `sp-${suffix}.${ext}`, url: `/uploads/sp-${suffix}.${ext}`, filename: `sp-${suffix}.${ext}`, mimeType, sizeBytes: 100 },
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const { hashPassword } = await import("../../src/lib/password");
    const admin = await app.prisma.user.create({
      data: {
        email: `sp-image-admin-${crypto.randomUUID()}@example.com`,
        name: "Admin",
        passwordHash: await hashPassword("Sifre12345!"),
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: admin.email, password: "Sifre12345!" } });
    adminToken = login.json().data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("PNG/JPG/WebP görsel ile oluşturulur; public uçlar imageUrl döner", async () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      const media = await createMedia(mime);
      const res = await app.inject({
        method: "POST",
        url: ADMIN_URL,
        headers: authHeader(adminToken),
        payload: { name: `Görsel ${mime}`, icon: "heart-pulse", imageMediaId: media.id },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.imageMediaId).toBe(media.id);
      expect(res.json().data.imageUrl).toContain(media.url);

      const pub = await app.inject({ method: "GET", url: `/api/v1/specialties/${res.json().data.slug}` });
      expect(pub.json().data.imageUrl).toContain(media.url);
    }
    const list = await app.inject({ method: "GET", url: "/api/v1/specialties" });
    expect(list.json().data.every((s: { imageUrl: string | null }) => typeof s.imageUrl === "string")).toBe(true);
  });

  it("GIF/PDF reddedilir (422), görselsiz uzmanlık imageUrl=null", async () => {
    for (const mime of ["image/gif", "application/pdf"]) {
      const media = await createMedia(mime);
      const res = await app.inject({
        method: "POST",
        url: ADMIN_URL,
        headers: authHeader(adminToken),
        payload: { name: `Reddedilen ${mime}`, icon: "heart-pulse", imageMediaId: media.id },
      });
      expect(res.statusCode).toBe(422);
    }
    const plain = await app.inject({ method: "POST", url: ADMIN_URL, headers: authHeader(adminToken), payload: { name: "Görselsiz", icon: "stethoscope" } });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().data).toMatchObject({ imageMediaId: null, imageUrl: null });
  });

  it("PATCH ile eklenir/kaldırılır; medya silinince alan NULL'a düşer", async () => {
    const created = await app.inject({ method: "POST", url: ADMIN_URL, headers: authHeader(adminToken), payload: { name: "Sonradan Görsel", icon: "brain" } });
    const id = created.json().data.id as string;
    const media = await createMedia("image/webp");

    const set = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: authHeader(adminToken), payload: { imageMediaId: media.id } });
    expect(set.statusCode).toBe(200);
    expect(set.json().data.imageMediaId).toBe(media.id);

    const cleared = await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: authHeader(adminToken), payload: { imageMediaId: null } });
    expect(cleared.json().data).toMatchObject({ imageMediaId: null, imageUrl: null });

    await app.inject({ method: "PATCH", url: `${ADMIN_URL}/${id}`, headers: authHeader(adminToken), payload: { imageMediaId: media.id } });
    await app.prisma.media.delete({ where: { id: media.id } });
    const row = await app.prisma.specialty.findUnique({ where: { id } });
    expect(row?.imageMediaId).toBeNull();
  });
});
