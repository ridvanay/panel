import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `sendMail()` (bkz. src/lib/mail.ts) mock'lanır — gerçek SMTP/Ethereal'a hiç dokunulmaz.
 * Amaç: `POST /admin/users` → `sendPasswordResetEmail()` → `sendTemplateEmail()` zincirinin
 * başarılı olduğunda `emailStatus: "sent"` döndürdüğünü ve ham şifre belirleme bağlantısının
 * response body'sinde YER ALMADIĞINI (yalnızca `sendMail`'e giden `html` içinde, iç iletişimde,
 * göründüğünü) kanıtlamak.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("POST /admin/users — SMTP mock'lanmış (başarı senaryosu)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // §10.16.3 BREAKING — `sendTemplateEmail` artık `purpose` + `isActive=true` ile çözümlenir.
    await app.prisma.emailTemplate.create({
      data: {
        key: "PASSWORD_RESET",
        name: "Şifre Sıfırlama E-postası",
        purpose: "PASSWORD_RESET",
        editorMode: "RAW",
        isSystem: true,
        isActive: true,
        subject: "Şifre sıfırlama talebiniz",
        bodyHtml: '<p>Merhaba {{user_name}},</p><p><a href="{{reset_link}}">Şifremi Sıfırla</a></p>',
        availableVariables: ["user_name", "reset_link"],
      },
    });

    const admin = await registerTestUser(app, { email: "admin-success@example.com" });
    adminToken = admin.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("PASSWORD_RESET şablonunu render edip sendMail'e gönderir; response emailStatus:'sent' döner, setPasswordUrl DÖNMEZ", async () => {
    sendMailMock.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: authHeader(adminToken),
      payload: { name: "Başarılı Kullanıcı", email: "success-user@example.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.emailStatus).toBe("sent");
    expect(body.data.setPasswordUrl).toBeUndefined();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; subject: string; html: string }];
    expect(input.to).toBe("success-user@example.com");
    expect(input.html).toContain("reset-password?token=");
  });

  /**
   * Regresyon (backend-agent bulgusu, 2026-09-16) — `.claude/architect-scope-guest-account-otp.md`
   * §2.5 gerekçesinin `POST /admin/users`e de uygulanması: admin tarafından oluşturulan bir
   * kullanıcı `emailVerifiedAt` DOLU doğar (SMTP arızasında çifte-bağımlılık kilitlenmesini önler).
   * Uçtan uca: oluştur → DB'de `emailVerifiedAt` dolu doğrula → e-postadaki reset linkiyle şifre
   * belirle → `POST /auth/login`de `requiresEmailVerification` ALINMADIĞINI, doğrudan token
   * alındığını doğrula.
   */
  it("yeni admin-oluşturulan kullanıcı emailVerifiedAt DOLU doğar; reset-password sonrası login'de requiresEmailVerification ALINMAZ", async () => {
    sendMailMock.mockClear();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: authHeader(adminToken),
      payload: { name: "Kilitlenme Regresyonu", email: "no-lockout-user@example.com" },
    });
    expect(createRes.statusCode).toBe(201);

    const dbUser = await app.prisma.user.findUniqueOrThrow({ where: { email: "no-lockout-user@example.com" } });
    expect(dbUser.emailVerifiedAt).not.toBeNull();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; html: string }];
    const match = input.html.match(/reset-password\?token=([\w-]+)/);
    expect(match).not.toBeNull();
    const rawToken = match![1]!;

    const resetRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token: rawToken, newPassword: "YeniSifre12345!" },
    });
    expect(resetRes.statusCode).toBe(204);

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "no-lockout-user@example.com", password: "YeniSifre12345!" },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json().data;
    expect(loginBody.requiresEmailVerification).toBeUndefined();
    expect(loginBody.tokens.accessToken).toEqual(expect.any(String));
  });
});
