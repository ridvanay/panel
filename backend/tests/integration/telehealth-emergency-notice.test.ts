import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Acil durum uyarısı — `PATCH /admin/telehealth/settings/emergency-notice` (yalnızca ADMIN),
 * `GET /admin/telehealth/settings` + public `GET /telehealth/theme` yanıtı ve tema kaydıyla
 * birlikte yaşaması (aynı `SiteModule.settings` JSON'u). Bkz. `modules/telehealth/lib/emergency-notice.ts`.
 */
const URL = "/api/v1/admin/telehealth/settings/emergency-notice";
const SUMMARY_EN = "Not for emergencies. In an emergency, call your local emergency number.";
const SUMMARY_TR = "Acil durumlar için kullanılamaz. Acil bir durumda yerel acil numarayı arayın.";
const FULL_EN =
  "This platform is not for emergencies and is not a substitute for emergency medical care. In an emergency, call your local emergency number.";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER") {
  const { hashPassword } = await import("../../src/lib/password");
  return app.prisma.user.create({
    data: {
      email: `emergency-notice-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      name: `Test ${role}`,
      passwordHash: await hashPassword("Sifre12345!"),
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
}

async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "Sifre12345!" } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

describe("telehealth acil durum uyarısı — ayarlar", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let managerToken: string;
  let editorToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const admin = await createUserDirect(app, "ADMIN");
    adminId = admin.id;
    adminToken = await loginAs(app, admin.email);
    managerToken = await loginAs(app, (await createUserDirect(app, "MANAGER")).email);
    editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("varsayılan: şerit AÇIK, admin metni yok (mevcut kurulumlar açık başlar)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.emergencyNotice).toEqual({ enabled: true, summary: {}, full: {} });
  });

  it("yalnızca ADMIN değiştirebilir — MANAGER ve EDITOR 403", async () => {
    for (const token of [managerToken, editorToken]) {
      const res = await app.inject({ method: "PATCH", url: URL, headers: authHeader(token), payload: { enabled: false } });
      expect(res.statusCode).toBe(403);
    }
    const res = await app.inject({ method: "PATCH", url: URL, payload: { enabled: false } });
    expect([401, 403]).toContain(res.statusCode);
  });

  it("boş, HTML'li, sınır dışı veya anahtar kelimesiz metin 422 ile reddedilir", async () => {
    for (const payload of [
      { summary: { en: "   " } },
      { summary: { en: `emergency ${"x".repeat(81)}` } },
      { full: { tr: "<b>kalın</b> acil uyarı metni burada yer alır" } },
      { full: { en: "short" } },
      { full: { en: `emergency ${"x".repeat(291)}` } },
      { summary: { en: "Please call your doctor first." } },
      { full: { tr: "Bu platform tıbbi bakımın yerine geçmez, doktorunuza danışın." } },
    ]) {
      const res = await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload });
      expect(res.statusCode).toBe(422);
    }
  });

  it("ADMIN metin ve anahtarı değiştirir; public uç yansıtır; denetim kaydı eski/yeni değeri içerir", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: URL,
      headers: authHeader(adminToken),
      payload: { enabled: false, summary: { en: SUMMARY_EN, tr: SUMMARY_TR }, full: { en: FULL_EN } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.emergencyNotice).toEqual({ enabled: false, summary: { en: SUMMARY_EN, tr: SUMMARY_TR }, full: { en: FULL_EN } });

    const pub = await app.inject({ method: "GET", url: "/api/v1/telehealth/theme" });
    expect(pub.json().data.emergencyNotice.enabled).toBe(false);

    const log = await app.prisma.auditLog.findFirst({
      where: { action: "telehealth.emergency_notice.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log!.actorId).toBe(adminId);
    expect(log!.createdAt).toBeInstanceOf(Date);
    const metadata = log!.metadata as Record<string, unknown>;
    expect(metadata.enabledChanged).toEqual({ from: true, to: false });
    expect((metadata.before as { enabled: boolean }).enabled).toBe(true);
    expect((metadata.after as { summary: Record<string, string> }).summary.tr).toBe(SUMMARY_TR);
  });

  it("tam metin 300 karaktere kadar kabul edilir; diğer dillerde anahtar kelime aranmaz", async () => {
    const long = `Acil ${"x".repeat(295)}`;
    const res = await app.inject({
      method: "PATCH",
      url: URL,
      headers: authHeader(adminToken),
      payload: { full: { tr: long, de: "Diese Plattform ist nicht für Notfälle gedacht." } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.emergencyNotice.full.tr).toBe(long);
    const cleanup = await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload: { full: { tr: null, de: null } } });
    expect(cleanup.statusCode).toBe(200);
  });

  it("null o dilin metnini siler (sitede sözlük varsayılanı)", async () => {
    const res = await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload: { summary: { tr: null } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.emergencyNotice.summary).toEqual({ en: SUMMARY_EN });
  });

  it("HATA DÜZELTMESİ: tema rengi kaydı uyarı ayarlarını SİLMEZ; uyarı kaydı tema rengini silmez", async () => {
    const theme = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/telehealth/settings",
      headers: authHeader(managerToken),
      payload: { primaryColor: "#123456" },
    });
    expect(theme.statusCode).toBe(200);
    expect(theme.json().data.emergencyNotice).toEqual({ enabled: false, summary: { en: SUMMARY_EN }, full: { en: FULL_EN } });

    const notice = await app.inject({ method: "PATCH", url: URL, headers: authHeader(adminToken), payload: { enabled: true } });
    expect(notice.statusCode).toBe(200);
    expect(notice.json().data.primaryColor).toBe("#123456");
    expect(notice.json().data.emergencyNotice.enabled).toBe(true);

    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    expect(row?.settings).toMatchObject({ primaryColor: "#123456", emergencyNotice: { enabled: true, summary: { en: SUMMARY_EN } } });
  });
});
