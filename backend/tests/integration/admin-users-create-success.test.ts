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

    await app.prisma.emailTemplate.create({
      data: {
        key: "PASSWORD_RESET",
        name: "Şifre Sıfırlama E-postası",
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
});
