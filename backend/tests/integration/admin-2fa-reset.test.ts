import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";

/**
 * Paket B1 (2026-10-18) — `POST /admin/users/{userId}/2fa/reset` (step-up, oturum iptali, audit,
 * bilgilendirme e-postası, aktör kilidi) ve `POST /admin/users/{userId}/resend-activation`.
 * Gerçek SMTP'ye dokunulmasın diye `sendMail` mock'lanır (modülün geri kalanı gerçek kalır).
 */
const sendMailMock = vi.fn();
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => sendMailMock(...args) };
});
const sendPasswordResetEmailMock = vi.fn();
vi.mock("../../src/modules/email-templates/email-templates.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/email-templates/email-templates.service")>();
  return { ...actual, sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmailMock(...args) };
});

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { encryptSecret } from "../../src/lib/crypto";
import { hashPassword } from "../../src/lib/password";
import { hashBackupCode } from "../../src/lib/backup-codes";

const PASSWORD = "Sifre12345!";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function enableTwoFactor(app: FastifyInstance, userId: string): Promise<string> {
  const secret = authenticator.generateSecret();
  await app.prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorSecret: encryptSecret(secret), twoFactorVerifiedAt: new Date() },
  });
  return secret;
}

/** Hedef kullanıcı: önce giriş yapılır (gerçek refresh cookie), SONRA 2FA + yedek kod eklenir. */
async function createTargetWithSession(app: FastifyInstance) {
  const email = `doktor-${crypto.randomUUID()}@example.com`;
  const user = await app.prisma.user.create({
    data: { email, name: "Doktor Hesabı", passwordHash: await hashPassword(PASSWORD), role: "USER", emailVerifiedAt: new Date() },
  });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  expect(login.statusCode).toBe(200);
  const refreshCookie = login.cookies.find((c) => c.name === "refresh_token")!.value;
  await enableTwoFactor(app, user.id);
  await app.prisma.backupCode.create({ data: { userId: user.id, codeHash: hashBackupCode("ABCD-EFGH") } });
  return { user, email, refreshCookie };
}

async function createManagerToken(app: FastifyInstance): Promise<string> {
  const email = `manager-${crypto.randomUUID()}@example.com`;
  await app.prisma.user.create({
    data: { email, name: "Yönetici", passwordHash: await hashPassword(PASSWORD), role: "MANAGER", status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
  return res.json().data.tokens.accessToken as string;
}

describe("Admin 2FA sıfırlama (Paket B1)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let adminSecret: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: `admin-${crypto.randomUUID()}@example.com` });
    adminToken = admin.accessToken;
    adminId = admin.userId;
    adminSecret = await enableTwoFactor(app, adminId);
    sendMailMock.mockReset().mockResolvedValue({ messageId: "test" });
    sendPasswordResetEmailMock.mockReset().mockResolvedValue({ messageId: "test" });
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("MANAGER 2FA sıfırlayamaz (403)", async () => {
    const { user } = await createTargetWithSession(app);
    const managerToken = await createManagerToken(app);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(managerToken),
      payload: { code: "123456" },
    });

    expect(res.statusCode).toBe(403);
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.twoFactorEnabled).toBe(true);
  });

  it("step-up kodu yanlışsa 403 STEP_UP_INVALID_CODE, hedef değişmez, FAILURE audit yazılır", async () => {
    const { user } = await createTargetWithSession(app);
    const valid = authenticator.generate(adminSecret);
    const wrong = valid === "000000" ? "111111" : "000000";

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: wrong },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("STEP_UP_INVALID_CODE");
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.twoFactorEnabled).toBe(true);
    expect(row.twoFactorSecret).not.toBeNull();
    const audit = await app.prisma.auditLog.findFirst({ where: { action: "admin_users.2fa_reset", status: "FAILURE", targetId: user.id } });
    expect(audit?.actorId).toBe(adminId);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("admin'in kendi 2FA'sı kapalıysa 403 STEP_UP_2FA_NOT_ENABLED", async () => {
    const { user } = await createTargetWithSession(app);
    await app.prisma.user.update({ where: { id: adminId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: "123456" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("STEP_UP_2FA_NOT_ENABLED");
  });

  it("admin kendi 2FA'sını bu yolla sıfırlayamaz (409)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${adminId}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: authenticator.generate(adminSecret) },
    });

    expect(res.statusCode).toBe(409);
    const admin = await app.prisma.user.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.twoFactorEnabled).toBe(true);
  });

  it("başarılı sıfırlama: 2FA alanları + yedek kodlar temizlenir, TÜM oturumlar iptal, e-posta + audit", async () => {
    const { user, refreshCookie } = await createTargetWithSession(app);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: authenticator.generate(adminSecret) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.emailStatus).toBe("sent");
    expect(res.json().data.user.twoFactorEnabled).toBe(false);

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.twoFactorEnabled).toBe(false);
    expect(row.twoFactorSecret).toBeNull();
    expect(row.twoFactorVerifiedAt).toBeNull();
    expect(await app.prisma.backupCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await app.prisma.refreshToken.count({ where: { userId: user.id, revoked: false } })).toBe(0);

    // Eski refresh cookie artık oturum açamaz.
    const refresh = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", cookies: { refresh_token: refreshCookie } });
    expect(refresh.statusCode).toBe(401);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0]![1]).toMatchObject({ to: user.email });

    const audit = await app.prisma.auditLog.findFirst({ where: { action: "admin_users.2fa_reset", status: "SUCCESS", targetId: user.id } });
    expect(audit?.actorId).toBe(adminId);
    expect(audit?.metadata).toMatchObject({ emailStatus: "sent" });
  });

  it("sıfırlama sonrası doktor girişte kurulum ekranına düşer (/doctor/me → 403 TWO_FACTOR_REQUIRED)", async () => {
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    const { user, email } = await createTargetWithSession(app);
    await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Portal Doktor", slug: `portal-doktor-${crypto.randomUUID()}`, bio: "Bio", languages: ["tr"], userId: user.id },
    });

    const reset = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: authenticator.generate(adminSecret) },
    });
    expect(reset.statusCode).toBe(200);

    // 2FA kapalı → giriş challenge istemeden token verir, portal ise kurulum kapısında durur.
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const token = login.json().data.tokens.accessToken as string;
    const me = await app.inject({ method: "GET", url: "/api/v1/doctor/me", headers: authHeader(token) });
    expect(me.statusCode).toBe(403);
    expect(me.json().error.code).toBe("TWO_FACTOR_REQUIRED");
  });

  it("başka bir ADMIN'in 2FA'sı sıfırlanamaz (403)", async () => {
    const { user } = await createTargetWithSession(app);
    await app.prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: authenticator.generate(adminSecret) },
    });

    expect(res.statusCode).toBe(403);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(true);
  });

  it("sıfırlama bekleyen şifre sıfırlama bağlantılarını da geçersiz kılar", async () => {
    const { user } = await createTargetWithSession(app);
    await app.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: crypto.randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3600_000) },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: authenticator.generate(adminSecret) },
    });

    expect(res.statusCode).toBe(200);
    expect(await app.prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  });

  it("etkin 2FA, /2fa/enable ile üzerine yazılamaz (409)", async () => {
    const setup = await app.inject({ method: "POST", url: "/api/v1/admin/settings/security/2fa/setup", headers: authHeader(adminToken) });
    expect(setup.statusCode).toBe(200);
    const { setupToken, otpauthUrl } = setup.json().data as { setupToken: string; otpauthUrl: string };
    const newSecret = new URL(otpauthUrl).searchParams.get("secret")!;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/security/2fa/enable",
      headers: authHeader(adminToken),
      payload: { setupToken, code: authenticator.generate(newSecret) },
    });

    expect(res.statusCode).toBe(409);
  });

  it("son 15 dakikada 5 başarısız step-up varsa doğru kod da 429 alır (aktör kilidi)", async () => {
    const { user } = await createTargetWithSession(app);
    await app.prisma.auditLog.createMany({
      data: Array.from({ length: 5 }, () => ({ actorId: adminId, action: "admin_users.2fa_reset", status: "FAILURE" as const, targetId: user.id })),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${user.id}/2fa/reset`,
      headers: authHeader(adminToken),
      payload: { code: authenticator.generate(adminSecret) },
    });

    expect(res.statusCode).toBe(429);
    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.twoFactorEnabled).toBe(true);
  });
});

describe("Etkinleştirme e-postasını yeniden gönder (Paket B1)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    adminToken = (await registerTestUser(app, { email: `admin-${crypto.randomUUID()}@example.com` })).accessToken;
    sendPasswordResetEmailMock.mockReset().mockResolvedValue({ messageId: "test" });
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("hiç giriş yapmamış hesaba yeni bağlantı gönderir, eski bağlantıyı geçersiz kılar", async () => {
    const user = await app.prisma.user.create({
      data: { email: `yeni-${crypto.randomUUID()}@example.com`, name: "Yeni Doktor", passwordHash: "x", role: "USER", emailVerifiedAt: new Date() },
    });
    const old = await app.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: crypto.randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3600_000) },
    });

    const res = await app.inject({ method: "POST", url: `/api/v1/admin/users/${user.id}/resend-activation`, headers: authHeader(adminToken) });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.emailStatus).toBe("sent");
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    const oldRow = await app.prisma.passwordResetToken.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.usedAt).not.toBeNull();
    expect(await app.prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
  });

  it("daha önce giriş yapmış hesapta 409 ACCOUNT_ALREADY_ACTIVE", async () => {
    const user = await app.prisma.user.create({
      data: {
        email: `aktif-${crypto.randomUUID()}@example.com`,
        name: "Aktif",
        passwordHash: "x",
        role: "USER",
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });

    const res = await app.inject({ method: "POST", url: `/api/v1/admin/users/${user.id}/resend-activation`, headers: authHeader(adminToken) });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ACCOUNT_ALREADY_ACTIVE");
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });
});
