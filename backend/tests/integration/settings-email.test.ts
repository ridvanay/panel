import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `/admin/settings/email` — `.claude/architect-scope-smtp-settings.md` §5/§6 +
 * `.claude/security-review-smtp-settings.md` KARAR 1-5 (bağlayıcı). Üç uç da yalnızca
 * `SiteRole=ADMIN` (MANAGER/EDITOR dahil panel-erişimli roller bile `403` alır).
 *
 * Katman B (SSRF ağ-katmanı, private/loopback IP reddi + `SMTP_ALLOW_PRIVATE_HOST` escape hatch)
 * BURADA test EDİLMEZ — `tests/unit/smtp-host-guard.test.ts`'te ağdan bağımsız, deterministik
 * olarak zaten kapsanıyor. Bu dosya yalnızca Katman A (sözdizimi, ağ çağrısı gerektirmez) ile
 * route/RBAC/üç-durumlu-parola/audit/effectiveSource davranışını doğrular.
 *
 * `.env.test`'te `SMTP_ALLOW_PRIVATE_HOST=true` (test ortamına özgü escape hatch) — bu yüzden
 * `127.0.0.1` gibi bir loopback host'u burada BAŞARIYLA kaydedilebilir/test edilebilir
 * (dinleyen bir servis olmadığı için hızlı/deterministik `ECONNREFUSED` alınır, dış ağ/DNS
 * erişimine BAĞIMLI DEĞİLDİR).
 */
describe("settings-email — GET/PATCH (RBAC, üç-durumlu parola, doğrulama, effectiveSource)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let managerToken: string;
  let editorToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: "smtp-admin@example.com" });
    adminToken = admin.accessToken;

    const manager = await registerTestUser(app, { email: "smtp-manager@example.com" });
    await app.prisma.user.update({ where: { id: manager.userId }, data: { role: "MANAGER" } });
    managerToken = manager.accessToken;

    const editor = await registerTestUser(app, { email: "smtp-editor@example.com" });
    await app.prisma.user.update({ where: { id: editor.userId }, data: { role: "EDITOR" } });
    editorToken = editor.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("GET — satır hiç yokken (lazy-upsert) DEFAULTS + smtpPasswordSet:false döner, 422 DEĞİL", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/email", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.enabled).toBe(false);
    expect(data.smtpPasswordSet).toBe(false);
    expect(data.smtpPort).toBe(587);
    expect(["database", "env", "ethereal", "none"]).toContain(data.effectiveSource);
    expect(JSON.stringify(data)).not.toMatch(/smtpPassword"/); // yalnızca `smtpPasswordSet` olmalı
  });

  it.each<[string, string]>([
    ["MANAGER", "managerToken"],
    ["EDITOR", "editorToken"],
  ])("%s — panel erişimi olsa bile üç ucun tamamında 403 alır", async (_label, tokenKey) => {
    const token = tokenKey === "managerToken" ? managerToken : editorToken;

    const getRes = await app.inject({ method: "GET", url: "/api/v1/admin/settings/email", headers: authHeader(token) });
    expect(getRes.statusCode).toBe(403);

    const patchRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(token),
      payload: { enabled: false },
    });
    expect(patchRes.statusCode).toBe(403);

    const testRes = await app.inject({ method: "POST", url: "/api/v1/admin/settings/email/test", headers: authHeader(token) });
    expect(testRes.statusCode).toBe(403);
  });

  it("PATCH — `enabled: true` + boş `smtpHost` → 422 (açık ama yapılandırmasız tuzağı)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(422);
  });

  it.each<[string, string]>([
    ["kimlik bilgisi (user:pass@)", "user:pass@smtp.example.com"],
    ["şema eki (smtp://)", "smtp://smtp.example.com"],
    ["gömülü port (host içinde :)", "smtp.example.com:587"],
    ["boşluk", "smtp example.com"],
    ["ne IP literal ne RFC1123 deseni", "-invalid-.example.com"],
  ])("PATCH — Katman A sözdizimi reddi: %s → 422", async (_label, smtpHost) => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { smtpHost },
    });
    expect(res.statusCode).toBe(422);
  });

  it("PATCH — izin verilmeyen bir port (8080) → 422 (kapalı küme: 25/465/587/2525)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { smtpPort: 8080 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("PATCH — geçerli bir yapılandırma kaydeder, parola YANITTA HİÇBİR ZAMAN görünmez, effectiveSource 'database' olur", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: {
        enabled: true,
        smtpHost: "127.0.0.1",
        smtpPort: 2525,
        smtpSecure: false,
        smtpUser: "test-user",
        smtpPassword: "super-secret-password",
        fromAddress: "no-reply@example.com",
        fromName: "Test Gönderen",
      },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.enabled).toBe(true);
    expect(data.smtpHost).toBe("127.0.0.1");
    expect(data.smtpPasswordSet).toBe(true);
    expect(data.effectiveSource).toBe("database");
    expect(JSON.stringify(res.body)).not.toContain("super-secret-password");
  });

  it("PATCH — parola alanı GÖNDERİLMEZSE mevcut parola KORUNUR (smtpPasswordSet true kalır)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { fromName: "Güncellenmiş Gönderen" },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.fromName).toBe("Güncellenmiş Gönderen");
    expect(data.smtpPasswordSet).toBe(true);
  });

  it("PATCH — `smtpPassword: null` parolayı TEMİZLER (smtpPasswordSet false olur)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { smtpPassword: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.smtpPasswordSet).toBe(false);
  });

  it("PATCH — `enabled: false` yapılınca `smtpHost` dolu olsa bile effectiveSource artık 'database' DEĞİLDİR", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.enabled).toBe(false);
    expect(data.smtpHost).toBe("127.0.0.1"); // ayarlar SİLİNMEDİ, yalnızca öncelik devredildi
    expect(data.effectiveSource).not.toBe("database");
  });

  it("audit — `settings.email_update` yalnızca alan ADLARINI taşır, parola değeri/ciphertext YOKTUR", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { enabled: true, smtpPassword: "another-secret-value" },
    });

    const log = await app.prisma.auditLog.findFirst({
      where: { action: "settings.email_update" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).toBeTruthy();
    expect((log!.metadata as { changed: string[] }).changed).toEqual(expect.arrayContaining(["enabled", "smtpPassword"]));
    expect(JSON.stringify(log!.metadata)).not.toContain("another-secret-value");
    expect(JSON.stringify(log!.metadata)).not.toMatch(/smtpPasswordCiphertext/);
  });

  it("POST .../test — kaydedilmiş satırı test eder, `sentTo` maskelidir, ham hata sızmaz, `lastTestError` sabit/kısa bir mesajdır", async () => {
    // Bu blokta `POST .../test`e yapılan ÜÇÜNCÜ (ve son) çağrıdır (ilk ikisi: MANAGER/EDITOR
    // 403 testleri, rate-limit onRequest'te preHandler'dan ÖNCE çalıştığı için onlar da bütçeyi
    // tüketir) — `EMAIL_SMTP_TEST_RATE_LIMIT` (3/dk) bütçesini AŞMAZ. Rate limit'in KENDİSİ
    // (4. istek → 429) `rate-limits.test.ts`'te AYRI/izole bir app örneğinde doğrulanır.
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/settings/email/test", headers: authHeader(adminToken) });

    // 127.0.0.1:2525'te dinleyen bir SMTP sunucusu YOK — bağlantı reddedilir (502).
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error.code).toBe("EMAIL_DELIVERY_FAILED");
    // Ham `ECONNREFUSED`/stack YOK — yalnızca KARAR 3'ün sabit "connection" mesajı.
    expect(body.error.message).toContain("SMTP sunucusuna bağlanılamadı");
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|errno|syscall/i);

    const row = await app.prisma.emailSettings.findUnique({ where: { id: "singleton" } });
    expect(row?.lastTestSucceeded).toBe(false);
    expect(row?.lastTestError).toBe(body.error.message);
    expect(row?.lastTestError!.length).toBeLessThan(200);

    const testLog = await app.prisma.auditLog.findFirst({ where: { action: "settings.email_test" }, orderBy: { createdAt: "desc" } });
    expect(testLog).toBeTruthy();
    expect((testLog!.metadata as { succeeded: boolean; errorCategory?: string }).succeeded).toBe(false);
    expect((testLog!.metadata as { errorCategory?: string }).errorCategory).toBe("connection");
    expect(JSON.stringify(testLog!.metadata)).not.toMatch(/ECONNREFUSED|@example\.com/);
  });

  it("PATCH — `enabled: false` olunca eski `lastTestedAt`/`lastTestSucceeded`/`lastTestError` sıfırlanır (qa-agent bulgusu)", async () => {
    // Rate-limit bütçesini tüketmeden önceki bir test sonucunu DOĞRUDAN simüle eder.
    await app.prisma.emailSettings.update({
      where: { id: "singleton" },
      data: { lastTestedAt: new Date(), lastTestSucceeded: false, lastTestError: "SMTP sunucusuna bağlanılamadı." },
    });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);

    const row = await app.prisma.emailSettings.findUnique({ where: { id: "singleton" } });
    expect(row?.lastTestedAt).toBeNull();
    expect(row?.lastTestSucceeded).toBeNull();
    expect(row?.lastTestError).toBeNull();
  });

  it("PATCH — `smtpHost` FARKLI bir değere değişince eski test sonucu sıfırlanır; AYNI değere set edilince KORUNUR", async () => {
    await app.prisma.emailSettings.update({
      where: { id: "singleton" },
      data: { lastTestedAt: new Date(), lastTestSucceeded: true, lastTestError: null },
    });

    const changedRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { smtpHost: "127.0.0.2" },
    });
    expect(changedRes.statusCode).toBe(200);

    const rowAfterChange = await app.prisma.emailSettings.findUnique({ where: { id: "singleton" } });
    expect(rowAfterChange?.smtpHost).toBe("127.0.0.2");
    expect(rowAfterChange?.lastTestedAt).toBeNull();
    expect(rowAfterChange?.lastTestSucceeded).toBeNull();
    expect(rowAfterChange?.lastTestError).toBeNull();

    // Yeniden bir test sonucu simüle et, sonra AYNI host değeriyle PATCH at — KORUNMALI.
    await app.prisma.emailSettings.update({
      where: { id: "singleton" },
      data: { lastTestedAt: new Date(), lastTestSucceeded: true, lastTestError: null },
    });
    const sameHostRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/settings/email",
      headers: authHeader(adminToken),
      payload: { smtpHost: "127.0.0.2" },
    });
    expect(sameHostRes.statusCode).toBe(200);

    const rowAfterSameHost = await app.prisma.emailSettings.findUnique({ where: { id: "singleton" } });
    expect(rowAfterSameHost?.lastTestSucceeded).toBe(true);
  });
});

/**
 * Kendi izole `buildTestApp()` instance'ında — `EMAIL_SMTP_TEST_RATE_LIMIT` bütçesini üstteki
 * bloktan (MANAGER/EDITOR 403 testleri dahil, rate-limit onRequest'te preHandler'dan ÖNCE
 * çalışır) BAĞIMSIZ tutmak için.
 */
describe("settings-email — POST .../test, hiç smtpHost kaydedilmemişken", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "smtp-test-no-host-admin@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kayıt gerekmeden test edilecek bir şey yoktur → 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/email/test",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(422);
  });
});
