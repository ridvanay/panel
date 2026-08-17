import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Bu dosya SMTP mock'lamadan, gerçek `sendMail()` yolunu (config/env.ts::SMTP_HOST tanımsız →
 * .env.test/NODE_ENV=test) kullanır — amaç, `forgotPassword()`'un artık gerçek bir gönderim
 * hatasını (kullanıcı var ama mail gönderilemedi) SESSİZCE YUTMADIĞINI kanıtlamak, ama
 * kullanıcı yoksa (e-posta enumeration koruması) hâlâ 202 döndüğünü doğrulamak.
 * Başarılı gönderim senaryosu (mock'lanmış) için bkz. auth-forgot-password-success.test.ts.
 */
describe("POST /auth/forgot-password — SMTP yapılandırılmadan (test ortamı)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);

    // Global test setup seed script'ini çalıştırmıyor (bkz. tests/setup/global-setup.ts) — PASSWORD_RESET
    // şablonu olmadan sendTemplateEmail() 404 (NotFoundError) fırlatır, biz burada SMTP hatasını
    // (502) test etmek istiyoruz, şablon eksikliğini değil.
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
        bodyHtml:
          '<p>Merhaba {{user_name}},</p><p><a href="{{reset_link}}">Şifremi Sıfırla</a></p>',
        availableVariables: ["user_name", "reset_link"],
      },
    });
  });

  it("returns 202 for a non-existent email — enumeration protection is preserved", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "ghost@example.com" },
    });

    expect(res.statusCode).toBe(202);
  });

  it("does NOT silently succeed for an existing user when SMTP delivery fails — returns 502 EMAIL_DELIVERY_FAILED", async () => {
    const user = await registerTestUser(app, { email: "dave@example.com" });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: user.email },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("EMAIL_DELIVERY_FAILED");
  });
});
