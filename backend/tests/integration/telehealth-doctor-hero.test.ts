import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { parseDoctorHero } from "../../src/modules/telehealth/lib/doctor-hero";

/**
 * Paket M (2026-10-23) — doktor profil başlığı arka planı: `PATCH /admin/telehealth/settings/doctor-hero`
 * (ADMIN/MANAGER), public `GET /telehealth/theme` yanıtındaki `doctorHero`. Görsel yalnızca medya
 * kütüphanesinden; dış URL ve görsel olmayan medya reddedilir; tema/uyarı kayıtlarıyla aynı JSON'da yaşar.
 */
const URL = "/api/v1/admin/telehealth/settings/doctor-hero";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUser(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR") {
  const { hashPassword } = await import("../../src/lib/password");
  const user = await app.prisma.user.create({
    data: {
      email: `doctor-hero-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

describe("telehealth doktor profil başlığı (Paket M)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;
  let imageId: string;
  let pdfId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    adminToken = await createUser(app, "ADMIN");
    managerToken = await createUser(app, "MANAGER");
    editorToken = await createUser(app, "EDITOR");
    imageId = (await app.prisma.media.create({ data: { path: "hero.webp", url: "/uploads/hero.webp", filename: "hero.webp", mimeType: "image/webp", sizeBytes: 10 } })).id;
    pdfId = (await app.prisma.media.create({ data: { path: "doc.pdf", url: "/uploads/doc.pdf", filename: "doc.pdf", mimeType: "application/pdf", sizeBytes: 10 } })).id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("varsayılan: görsel yok (site varsayılan SVG'yi gösterir), opaklık 55", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.doctorHero).toEqual({ imageMediaId: null, imageUrl: null, overlayOpacity: 55 });
  });

  it("EDITOR ve anonim değiştiremez", async () => {
    expect((await app.inject({ method: "PATCH", url: URL, headers: authHeader(editorToken), payload: { overlayOpacity: 40 } })).statusCode).toBe(403);
    expect([401, 403]).toContain((await app.inject({ method: "PATCH", url: URL, payload: { overlayOpacity: 40 } })).statusCode);
  });

  it("dış URL, geçersiz kimlik, görsel olmayan ya da olmayan medya ve sınır dışı opaklık reddedilir", async () => {
    const cases: [Record<string, unknown>, number][] = [
      [{ imageUrl: "https://evil.example/x.jpg" }, 422],
      [{ imageMediaId: "https://evil.example/x.jpg" }, 422],
      [{ imageMediaId: imageId, imageUrl: "https://evil.example/x.jpg" }, 422],
      [{ overlayOpacity: 81 }, 422],
      [{ overlayOpacity: -1 }, 422],
      [{}, 422],
      [{ imageMediaId: pdfId }, 422],
      [{ imageMediaId: crypto.randomUUID() }, 404],
    ];
    for (const [payload, status] of cases) {
      const res = await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(status);
    }
  });

  it("MANAGER görsel ve opaklık seçer; public tema mutlak bağlantıyla döner; tema ve uyarı alanları korunur", async () => {
    await app.prisma.siteModule.update({
      where: { key: "telehealth" },
      data: { settings: { primaryColor: "#112233", emergencyNotice: { enabled: false, summary: {}, full: {} } } },
    });
    const res = await app.inject({ method: "PATCH", url: URL, headers: authHeader(managerToken), payload: { imageMediaId: imageId, overlayOpacity: 30 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.doctorHero).toMatchObject({ imageMediaId: imageId, overlayOpacity: 30 });

    const theme = (await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" })).json().data;
    // Prod'da `PUBLIC_URL` ile mutlak; test ortamında `PUBLIC_URL` boş olduğu için göreli kalabilir.
    expect(theme.doctorHero.imageUrl).toMatch(/\/uploads\/hero\.webp$/);
    expect(theme.primaryColor).toBe("#112233");
    expect(theme.emergencyNotice.enabled).toBe(false);
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.doctor_hero.update" } })).toBe(1);
  });

  it("varsayılana dön: imageMediaId null; silinen medya bağlantısız döner", async () => {
    await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload: { imageMediaId: imageId } });
    await app.prisma.media.delete({ where: { id: imageId } });
    expect((await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" })).json().data.doctorHero.imageUrl).toBeNull();

    const res = await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload: { imageMediaId: null, overlayOpacity: 55 } });
    expect(res.json().data.doctorHero).toEqual({ imageMediaId: null, imageUrl: null, overlayOpacity: 55 });
  });

  it("JSON'daki bozuk değerler varsayılana düşer (dış URL yazılmış olsa bile kullanılmaz)", () => {
    expect(parseDoctorHero({ doctorHero: { imageMediaId: "https://evil.example/x.jpg", overlayOpacity: 500 } })).toEqual({ imageMediaId: null, overlayOpacity: 55 });
    expect(parseDoctorHero(null)).toEqual({ imageMediaId: null, overlayOpacity: 55 });
  });
});
