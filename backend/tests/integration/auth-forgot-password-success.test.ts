import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `sendMail()` (bkz. src/lib/mail.ts) mock'lanır — gerçek SMTP/Ethereal'a hiç dokunulmaz.
 * Amaç: `forgotPassword()` → `sendPasswordResetEmail()` → `sendTemplateEmail()` zincirinin,
 * DB'deki PASSWORD_RESET şablonunu doğru render edip `sendMail()`'e doğru `to/subject/html`
 * ile ulaştığını ve route'un 202 döndüğünü uçtan uca kanıtlamak.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("POST /auth/forgot-password — SMTP mock'lanmış (başarı senaryosu)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // prisma/seed.ts'in kurduğu PASSWORD_RESET şablonunun bir kopyası — global test setup'ı
    // seed script'ini çalıştırmıyor (bkz. tests/setup/global-setup.ts), bu yüzden burada elle ekliyoruz.
    await app.prisma.emailTemplate.create({
      data: {
        key: "PASSWORD_RESET",
        name: "Şifre Sıfırlama E-postası",
        subject: "Şifre sıfırlama talebiniz",
        bodyHtml:
          '<p>Merhaba {{user_name}},</p><p><a href="{{reset_link}}">Şifremi Sıfırla</a></p>',
        availableVariables: ["user_name", "reset_link"],
      },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("renders the PASSWORD_RESET template and sends it via sendMail; route returns 202", async () => {
    const user = await registerTestUser(app, { email: "erin@example.com" });
    sendMailMock.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: user.email },
    });

    expect(res.statusCode).toBe(202);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; subject: string; html: string }];
    expect(input.to).toBe(user.email);
    expect(input.subject).toBe("Şifre sıfırlama talebiniz");
    expect(input.html).toContain("reset-password?token=");
  });
});
