import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

/**
 * §10.12 Site Özelleştirme — ARCHITECTURE.md §10.12 / openapi.yaml `Appearance` tag'i. Bu dosya
 * backend-agent'ın KENDİ implementasyonunu doğrulayan TEMEL smoke testlerdir (lazy-upsert
 * DEFAULTS, ADMIN-only 403, `acknowledged` eksikse 422, kill switch davranışı) — qa-agent
 * kapsamlı senaryoları (E2E, regresyon) ayrıca ekleyecektir.
 */
describe("appearance — /appearance ve /admin/appearance (public + authenticated)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let managerToken: string;
  let editorToken: string;
  let userToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserDirect(role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `appearance-user-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });
  }

  async function loginAs(email: string, password = "Sifre12345!"): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(res.statusCode).toBe(200);
    return res.json().data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // İlk register boş bir DB'de otomatik ADMIN olur (bkz. auth.service.ts).
    const admin = await registerTestUser(app, { email: "appearance-admin@example.com" });
    adminToken = admin.accessToken;
    adminId = admin.userId;

    // `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 2 — okuma (`GET /`, `/presets`,
    // `/custom-code`): ADMIN/MANAGER/EDITOR; `PATCH /`, `POST /reset`: ADMIN+MANAGER;
    // `PUT /custom-code/{css,js}`: yalnızca ADMIN.
    const manager = await createUserDirect("MANAGER");
    managerToken = await loginAs(manager.email);

    const editor = await createUserDirect("EDITOR");
    editorToken = await loginAs(editor.email);

    const standardUser = await createUserDirect("USER");
    userToken = await loginAs(standardUser.email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("GET /appearance (public) — satır yoksa 404 DEĞİL, sabit DEFAULTS döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/appearance" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.pageHeaderStyle).toBe("PLAIN");
    expect(data.primaryColor).toBe("#4f46e5");
    expect(data.backToTopEnabled).toBe(true);
    expect(data.customCss).toBeNull();
    expect(data.customJs).toBeNull();
    // Public DTO yönetim-özel alanları TAŞIMAZ.
    expect(data.presetKey).toBeUndefined();
    expect(data.updatedAt).toBeUndefined();
  });

  it("GET /admin/appearance — kimliksiz istek 401 döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/appearance" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /admin/appearance — ADMIN/MANAGER/EDITOR okuyabilir, USER panel kapısında 403 alır (satır yoksa DEFAULTS + updatedAt: null)", async () => {
    const userRes = await app.inject({ method: "GET", url: "/api/v1/admin/appearance", headers: authHeader(userToken) });
    expect(userRes.statusCode).toBe(403);

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/appearance", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.presetKey).toBeNull();
    expect(data.updatedAt).toBeNull();
    expect(data.pageHeaderOverlayOpacity).toBe(40);
  });

  it("PATCH /admin/appearance — EDITOR 403 döner, MANAGER 200 döner (§5.3 satır 2 — ADMIN+MANAGER)", async () => {
    const editorRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(editorToken),
      payload: { primaryColor: "#123456" },
    });
    expect(editorRes.statusCode).toBe(403);

    const managerRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(managerToken),
      payload: { primaryColor: "#654321" },
    });
    expect(managerRes.statusCode).toBe(200);
  });

  it("PATCH /admin/appearance — USER 403 döner", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(userToken),
      payload: { primaryColor: "#123456" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /admin/appearance — bilinmeyen/türetilmiş alan (pageHeaderBackgroundUrl) gönderilirse 422 döner", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(adminToken),
      payload: { pageHeaderBackgroundUrl: "https://example.com/x.png" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /admin/appearance — customCss gönderilirse 422 döner (.strict() — kendi PUT ucu vardır)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(adminToken),
      payload: { primaryColor: "#123456", customCss: "body { color: red; }" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /admin/appearance — customJs gönderilirse 422 döner (.strict() — kendi PUT ucu vardır)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(adminToken),
      payload: { primaryColor: "#123456", customJs: "console.log(1)" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /admin/appearance — var olmayan pageHeaderBackgroundMediaId 404 döner (kısmi yazma YAPILMAZ)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(adminToken),
      payload: { pageHeaderBackgroundMediaId: crypto.randomUUID(), primaryColor: "#000000" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    // Kısmi yazma YAPILMAMALI — primaryColor de değişmemiş olmalı.
    const getRes = await app.inject({ method: "GET", url: "/api/v1/admin/appearance", headers: authHeader(adminToken) });
    expect(getRes.json().data.primaryColor).not.toBe("#000000");
  });

  it("PATCH /admin/appearance — ADMIN lazy-upsert ile satırı oluşturur, tekilleştirilmiş socialShareNetworks döner, audit log yazılır", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/appearance",
      headers: authHeader(adminToken),
      payload: {
        primaryColor: "#ff0000",
        backToTopEnabled: false,
        socialShareEnabled: true,
        socialShareNetworks: ["TWITTER", "TWITTER", "EMAIL"],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.primaryColor).toBe("#ff0000");
    expect(data.backToTopEnabled).toBe(false);
    expect(data.socialShareNetworks.sort()).toEqual(["EMAIL", "TWITTER"]);
    expect(data.updatedAt).not.toBeNull();

    const auditLog = await app.prisma.auditLog.findFirst({
      where: { action: "appearance.update", targetId: "singleton" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditLog).not.toBeNull();
    expect((auditLog!.metadata as { changed: string[] }).changed).toContain("primaryColor");
  });

  it("GET /appearance (public) — PATCH sonrası güncel değeri yansıtır", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/appearance" });
    expect(res.json().data.primaryColor).toBe("#ff0000");
  });

  it("GET /admin/appearance/presets — statik registry döner, DB tablosu OLMADAN (USER panel kapısında 403 alır)", async () => {
    const userRes = await app.inject({ method: "GET", url: "/api/v1/admin/appearance/presets", headers: authHeader(userToken) });
    expect(userRes.statusCode).toBe(403);

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/appearance/presets", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(200);
    const presets = res.json().data as Array<{ key: string; values: Record<string, unknown> }>;
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((p) => p.values.headingFont !== undefined)).toBe(true);
    // Ön ayarlar anahtarları/404 alanlarını ASLA taşımaz.
    expect(presets.every((p) => p.values.maintenanceModeEnabled === undefined)).toBe(true);
  });

  it("POST /admin/appearance/reset — EDITOR 403 döner (§5.3 satır 2 — ADMIN+MANAGER)", async () => {
    // NOT: gövde şeması opsiyonel olsa da `payload` hiç verilmezse `light-my-request` gövdeyi
    // `null` gönderir — bu da preHandler (RBAC) çalışmadan ÖNCE preValidation aşamasında 422
    // üretir (bkz. ARCHITECTURE.md "Bilinen Sorunlar" — preValidation vs RBAC hook sıralaması,
    // import.test.ts'teki AYNI NOT). Gerçek bir RBAC testi için geçerli bir gövde ({}) gerekir.
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/appearance/reset", headers: authHeader(editorToken), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it("POST /admin/appearance/reset — bilinmeyen presetKey 404 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/appearance/reset",
      headers: authHeader(adminToken),
      payload: { presetKey: "does-not-exist" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /admin/appearance/reset — geçerli presetKey ile renk/tipografiyi uygular, anahtarları/404'ü ETKİLEMEZ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/appearance/reset",
      headers: authHeader(adminToken),
      payload: { presetKey: "modern" },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.presetKey).toBe("modern");
    expect(data.primaryColor).toBe("#4f46e5");
    // §10.12.9 kararı — reset ucu YALNIZCA renk/tipografiyi etkiler, önceki PATCH'te
    // false yapılmış backToTopEnabled DEĞİŞMEMİŞ olmalı.
    expect(data.backToTopEnabled).toBe(false);
  });

  it("POST /admin/appearance/reset — gövde boş, fabrika renk/tipografi DEFAULTS'una döner", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/appearance/reset", headers: authHeader(adminToken), payload: {} });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.presetKey).toBeNull();
    expect(data.primaryColor).toBe("#4f46e5");
  });

  // ---------------------------------------------------------------------------
  // §10.12.6 Özel CSS/JS — kontrattaki EN YÜKSEK RİSKLİ yüzey.
  // ---------------------------------------------------------------------------

  it("GET /admin/appearance/custom-code — satır yoksa DEFAULTS (null/null), customCodeEnabled: true (USER panel kapısında 403 alır)", async () => {
    const userRes = await app.inject({ method: "GET", url: "/api/v1/admin/appearance/custom-code", headers: authHeader(userToken) });
    expect(userRes.statusCode).toBe(403);

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/appearance/custom-code", headers: authHeader(editorToken) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.css).toBeNull();
    expect(data.js).toBeNull();
    expect(data.customCodeEnabled).toBe(true);
  });

  it("PUT /admin/appearance/custom-code/css — EDITOR 403 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/css",
      headers: authHeader(editorToken),
      payload: { css: "body { color: red; }", acknowledged: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /admin/appearance/custom-code/js — EDITOR 403 döner (CSS ucuyla AYNI hakemlik kararı, §10.12.6 — CSS için EDITOR/ADMIN olabilir önerisinin reddi burada da geçerlidir)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(editorToken),
      payload: { js: "console.log('merhaba');", acknowledged: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /admin/appearance/custom-code/js — USER 403 döner, MANAGER de 403 döner ((c) — keyfi kod yürütme yalnızca ADMIN)", async () => {
    const userRes = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(userToken),
      payload: { js: "console.log('merhaba');", acknowledged: true },
    });
    expect(userRes.statusCode).toBe(403);

    const managerRes = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(managerToken),
      payload: { js: "console.log('merhaba');", acknowledged: true },
    });
    expect(managerRes.statusCode).toBe(403);
  });

  it("PUT /admin/appearance/custom-code/css — css boş DEĞİLKEN acknowledged: false ise 422 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/css",
      headers: authHeader(adminToken),
      payload: { css: "body { color: red; }", acknowledged: false },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("PUT /admin/appearance/custom-code/css — acknowledged: true ile kaydeder, audit log KOD GÖVDESİNİ değil sha256 taşır", async () => {
    const css = "body { color: red; }";
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/css",
      headers: authHeader(adminToken),
      payload: { css, acknowledged: true },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.css).toBe(css);
    expect(data.cssUpdatedBy.id).toBe(adminId);
    expect(data.cssUpdatedAt).not.toBeNull();

    const auditLog = await app.prisma.auditLog.findFirst({
      where: { action: "appearance.custom_css.update" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditLog).not.toBeNull();
    const metadata = auditLog!.metadata as { length: number; sha256: string; acknowledged: boolean };
    expect(metadata.length).toBe(css.length);
    expect(metadata.sha256).toBe(crypto.createHash("sha256").update(css).digest("hex"));
    expect(metadata.acknowledged).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain(css);
  });

  it("PUT /admin/appearance/custom-code/css — kod TEMİZLENİRKEN (null) acknowledged aranmaz", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/css",
      headers: authHeader(adminToken),
      payload: { css: null, acknowledged: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.css).toBeNull();
  });

  it("PUT /admin/appearance/custom-code/js — js boş DEĞİLKEN acknowledged: false ise 422 döner (CSS ucuyla AYNI kural, symmetri boşluğu)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(adminToken),
      payload: { js: "console.log('ack yok');", acknowledged: false },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("PUT /admin/appearance/custom-code/js — 20.000 karakteri aşarsa 422 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(adminToken),
      payload: { js: "a".repeat(20001), acknowledged: true },
    });
    expect(res.statusCode).toBe(422);
  });

  it("PUT /admin/appearance/custom-code/js — geçerli gövde ile kaydeder ve public GET /appearance'a yansır", async () => {
    const js = "console.log('merhaba');";
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(adminToken),
      payload: { js, acknowledged: true },
    });
    expect(putRes.statusCode).toBe(200);

    const publicRes = await app.inject({ method: "GET", url: "/api/v1/appearance" });
    expect(publicRes.json().data.customJs).toBe(js);
  });

  it("PUT /admin/appearance/custom-code/js — kod TEMİZLENİRKEN (null) acknowledged aranmaz (CSS ucuyla AYNI kural)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(adminToken),
      payload: { js: null, acknowledged: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.js).toBeNull();
  });
});

/**
 * §10.12.6 Kill switch — `CUSTOM_CODE_ENABLED=false`. `env` modülü process başına BİR KEZ
 * `process.env`'den okunduğu için (bkz. config/env.ts) taze bir uygulama grafiği elde etmek üzere
 * `vi.resetModules()` + dinamik `import()` kullanılır — `tests/unit/sentry-error-handler.test.ts`
 * ile AYNI yaklaşım.
 */
describe("appearance — özel CSS/JS kill switch (CUSTOM_CODE_ENABLED=false)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    process.env.CUSTOM_CODE_ENABLED = "false";
    vi.resetModules();

    const { buildApp } = await import("../../src/app");
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);

    const passwordHash = await hashPassword("Sifre12345!");
    const admin = await app.prisma.user.create({
      data: { email: "appearance-killswitch-admin@example.com", name: "Kill Switch Admin", passwordHash, role: "ADMIN", status: "ACTIVE" },
    });
    adminId = admin.id;

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: admin.email, password: "Sifre12345!" },
    });
    expect(loginRes.statusCode).toBe(200);
    adminToken = loginRes.json().data.tokens.accessToken as string;

    // Kill switch AÇILMADAN önce (bir başka deyişle env=false iken bile) saklı değerin
    // KORUNDUĞUNU göstermek için değeri doğrudan DB'ye yazıyoruz (bkz. §10.12.6 — "saklı değer
    // korunur ve bu yönetim ucunda GÖRÜNÜR").
    await app.prisma.siteCustomCode.create({
      data: {
        id: "singleton",
        customCss: "body { color: blue; }",
        customJs: "console.log('gizli')",
        cssUpdatedById: adminId,
        cssUpdatedAt: new Date(),
        jsUpdatedById: adminId,
        jsUpdatedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    delete process.env.CUSTOM_CODE_ENABLED;
    vi.resetModules();
  });

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it("PUT .../custom-code/css — kill switch'te ADMIN + acknowledged:true bile 403 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/css",
      headers: authHeader(adminToken),
      payload: { css: "body { color: green; }", acknowledged: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("PUT .../custom-code/js — kill switch'te 403 döner", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/appearance/custom-code/js",
      headers: authHeader(adminToken),
      payload: { js: "console.log('yeni')", acknowledged: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /admin/appearance/custom-code — saklı değer KORUNUR ve yönetim ucunda GÖRÜNÜR, customCodeEnabled: false", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/appearance/custom-code", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.css).toBe("body { color: blue; }");
    expect(data.js).toBe("console.log('gizli')");
    expect(data.customCodeEnabled).toBe(false);
  });

  it("GET /appearance (public) — customJs HER ZAMAN null, customCss ETKİLENMEZ", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/appearance" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.customJs).toBeNull();
    expect(data.customCss).toBe("body { color: blue; }");
  });
});
