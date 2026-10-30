import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket V (İş 3) — "Kendi dilinizde destek": `PATCH /admin/telehealth/settings/language-support`
 * (yalnızca ADMIN), public `GET /telehealth/theme` yanıtındaki `languageSupport`. Varsayılan kapalı
 * (liste boş, tercüman yok); tema/uyarı kaydı bu alanı silmez.
 */
const URL = "/api/v1/admin/telehealth/settings/language-support";

async function login(app: FastifyInstance, role: "ADMIN" | "MANAGER") {
  const { hashPassword } = await import("../../src/lib/password");
  const user = await app.prisma.user.create({
    data: {
      email: `ls-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: role,
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
  return { authorization: `Bearer ${res.json().data.tokens.accessToken as string}` };
}

describe("destek dilleri ayarı", () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let manager: Record<string, string>;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await login(app, "ADMIN");
    manager = await login(app, "MANAGER");
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("varsayılan: liste boş, saat yok, tercüman kapalı (bölüm sitede görünmez)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(res.json().data.languageSupport).toEqual({ supportLanguages: [], supportHours: {}, interpreterIncluded: false });
  });

  it("geçersiz kod, tekrarlı dil, HTML'li saat ve boş gövde 422", async () => {
    for (const payload of [
      { supportLanguages: ["english"] },
      { supportLanguages: ["en", "en"] },
      { supportHours: { en: "<b>9-18</b>" } },
      { supportHours: { en: "x".repeat(121) } },
      {},
    ]) {
      expect((await app.inject({ method: "PATCH", url: URL, headers: admin, payload })).statusCode).toBe(422);
    }
  });

  it("MANAGER değiştiremez (403)", async () => {
    expect((await app.inject({ method: "PATCH", url: URL, headers: manager, payload: { supportLanguages: ["en"] } })).statusCode).toBe(403);
  });

  it("ADMIN kaydeder; public uç yansıtır; saat metni null ile silinir; tema kaydı alanı korur; audit", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: URL,
      headers: admin,
      payload: { supportLanguages: ["en", "tr", "ar", "ru"], supportHours: { en: "Mon–Sat 09:00–21:00 (GMT+3)", tr: "Pzt–Cmt 09:00–21:00" }, interpreterIncluded: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.languageSupport).toEqual({
      supportLanguages: ["en", "tr", "ar", "ru"],
      supportHours: { en: "Mon–Sat 09:00–21:00 (GMT+3)", tr: "Pzt–Cmt 09:00–21:00" },
      interpreterIncluded: true,
    });

    await app.inject({ method: "PATCH", url: URL, headers: admin, payload: { supportHours: { tr: null } } });
    // Tema renkleri kaydı aynı JSON'u paylaşır; destek ayarı silinmemeli.
    expect((await app.inject({ method: "PATCH", url: "/api/v1/admin/telehealth/settings", headers: admin, payload: { primaryColor: "#112233" } })).statusCode).toBe(200);

    const pub = (await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" })).json().data;
    expect(pub.languageSupport).toEqual({ supportLanguages: ["en", "tr", "ar", "ru"], supportHours: { en: "Mon–Sat 09:00–21:00 (GMT+3)" }, interpreterIncluded: true });
    expect(pub.primaryColor).toBe("#112233");
    expect(await app.prisma.auditLog.count({ where: { action: "telehealth.language_support.update" } })).toBe(2);
  });
});
