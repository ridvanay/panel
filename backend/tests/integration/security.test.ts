import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

interface SessionDto {
  id: string;
  isCurrent: boolean;
}

// Not: /auth/login ve /auth/2fa/verify de AUTH_RATE_LIMIT (dakikada 5) altında —
// bu dosyadaki testler challenge token'ları/oturumları yeniden kullanarak toplam
// çağrı sayısını bu limitin altında tutar (bkz. auth.test.ts'teki benzer not).
describe("security — 2FA & aktif oturumlar", () => {
  let app: FastifyInstance;
  let user: Awaited<ReturnType<typeof registerTestUser>>;
  let secret: string;
  let setupToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    user = await registerTestUser(app, { email: "dave@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("2FA kapalıyken login normal token döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: user.password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.tokens.accessToken).toEqual(expect.any(String));
    expect(res.json().data.requiresTwoFactor).toBeUndefined();
  });

  it("2FA kurulumu başlatılır (otpauthUrl + setupToken döner)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/setup",
      headers: authHeader(user.accessToken),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.setupToken).toEqual(expect.any(String));

    const otpauthUrl = new URL(body.otpauthUrl);
    secret = otpauthUrl.searchParams.get("secret")!;
    expect(secret).toEqual(expect.any(String));
    setupToken = body.setupToken;
  });

  let backupCodes: string[] = [];

  it("doğru TOTP koduyla 2FA etkinleştirilir ve yedek kodlar döner", async () => {
    const code = authenticator.generate(secret);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/enable",
      headers: authHeader(user.accessToken),
      payload: { setupToken, code },
    });

    expect(res.statusCode).toBe(200);
    backupCodes = res.json().data.backupCodes;
    expect(backupCodes).toHaveLength(10);
  });

  let challengeToken: string;
  let currentAccessToken: string;
  let currentCookieHeader: string;

  it("2FA açıkken login requiresTwoFactor döner ve token YOK, yanlış kod 401 döner, doğru TOTP kodu token üretir", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: user.password },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json().data;
    expect(loginBody.requiresTwoFactor).toBe(true);
    expect(loginBody.tokens).toBeUndefined();
    challengeToken = loginBody.challengeToken;

    // Yanlış kod → 401, token verilmez.
    const wrongRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/verify",
      payload: { challengeToken, code: "000000" },
    });
    expect(wrongRes.statusCode).toBe(401);

    // Doğru TOTP kodu → normal login ile aynı token çifti.
    const code = authenticator.generate(secret);
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/verify",
      payload: { challengeToken, code },
    });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().data.tokens.accessToken).toEqual(expect.any(String));
    expect(verifyRes.json().data.user.email).toBe(user.email);

    currentAccessToken = verifyRes.json().data.tokens.accessToken;
    currentCookieHeader = verifyRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  });

  it("yedek kod tek kullanımlıktır — ikinci kullanımda reddedilir", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: user.password },
    });
    const freshChallenge = loginRes.json().data.challengeToken;
    const backupCode = backupCodes[0]!;

    const firstUse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/verify",
      payload: { challengeToken: freshChallenge, code: backupCode },
    });
    expect(firstUse.statusCode).toBe(200);

    const loginRes2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: user.password },
    });
    const freshChallenge2 = loginRes2.json().data.challengeToken;

    const secondUse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/verify",
      payload: { challengeToken: freshChallenge2, code: backupCode },
    });
    expect(secondUse.statusCode).toBe(401);
  });

  it("GET sessions mevcut oturumu isCurrent:true işaretler, DELETE başka bir oturumu iptal eder", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings/security/sessions",
      headers: { ...authHeader(currentAccessToken), cookie: currentCookieHeader },
    });

    expect(listRes.statusCode).toBe(200);
    const sessions = listRes.json().data as SessionDto[];

    const current = sessions.find((s) => s.isCurrent);
    expect(current).toBeDefined();

    const other = sessions.find((s) => !s.isCurrent);
    expect(other).toBeDefined();

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/settings/security/sessions/${other!.id}`,
      headers: authHeader(currentAccessToken),
    });
    expect(deleteRes.statusCode).toBe(204);

    const listRes2 = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings/security/sessions",
      headers: { ...authHeader(currentAccessToken), cookie: currentCookieHeader },
    });
    const idsAfter = (listRes2.json().data as SessionDto[]).map((s) => s.id);
    expect(idsAfter).not.toContain(other!.id);

    const stillCurrent = (listRes2.json().data as SessionDto[]).find((s) => s.isCurrent);
    expect(stillCurrent).toBeDefined();
  });

  it("yanlış şifreyle /2fa/disable 401 döner ve FAILURE audit log kaydı oluşturur", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/disable",
      headers: authHeader(currentAccessToken),
      payload: { password: "yanlis-sifre-123" },
    });
    expect(res.statusCode).toBe(401);

    const log = await app.prisma.auditLog.findFirst({
      where: { actorId: user.userId, action: "security.2fa_disable", status: "FAILURE" },
      orderBy: { seq: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorEmail).toBe(user.email);
  });

  it("yanlış şifreyle /2fa/backup-codes/regenerate 401 döner ve FAILURE audit log kaydı oluşturur", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/backup-codes/regenerate",
      headers: authHeader(currentAccessToken),
      payload: { password: "yanlis-sifre-123" },
    });
    expect(res.statusCode).toBe(401);

    const log = await app.prisma.auditLog.findFirst({
      where: { actorId: user.userId, action: "security.2fa_backup_codes_regenerate", status: "FAILURE" },
      orderBy: { seq: "desc" },
    });
    expect(log).not.toBeNull();
    expect(log?.actorEmail).toBe(user.email);
  });
});
