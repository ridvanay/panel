import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `POST /admin/users` — bu dosya SMTP mock'lamadan, gerçek `sendMail()` yolunu (config/env.ts::
 * SMTP_HOST tanımsız → .env.test/NODE_ENV=test) kullanır. Amaç: e-posta gönderimi başarısız
 * olsa bile (1) kullanıcı kaydının GERİ ALINMADIĞINI, (2) response'un artık ham `setPasswordUrl`
 * DÖNDÜRMEDİĞİNİ, bunun yerine `emailStatus: "failed"` döndürdüğünü kanıtlamak (bkz.
 * security-agent kararı — token sızıntısı temizliği). Başarılı gönderim senaryosu (mock'lanmış)
 * için bkz. admin-users-create-success.test.ts.
 */
describe("POST /admin/users — SMTP yapılandırılmadan (test ortamı)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);

    // Global test setup seed script'ini çalıştırmıyor (bkz. tests/setup/global-setup.ts) —
    // PASSWORD_RESET şablonu olmadan sendTemplateEmail() 404 (NotFoundError) fırlatır; biz
    // burada gerçek SMTP hatasını (best-effort yutulup emailStatus:"failed" olmasını) test
    // etmek istiyoruz, şablon eksikliğini değil.
    await app.prisma.emailTemplate.create({
      data: {
        key: "PASSWORD_RESET",
        name: "Şifre Sıfırlama E-postası",
        subject: "Şifre sıfırlama talebiniz",
        bodyHtml: '<p>Merhaba {{user_name}},</p><p><a href="{{reset_link}}">Şifremi Sıfırla</a></p>',
        availableVariables: ["user_name", "reset_link"],
      },
    });

    // İlk register olan kullanıcı otomatik ADMIN olur (bkz. auth.service.ts::register).
    const admin = await registerTestUser(app, { email: `admin-${Date.now()}@example.com` });
    adminToken = admin.accessToken;
  });

  it("e-posta gönderimi başarısız olsa bile kullanıcı oluşturulur; response setPasswordUrl DEĞİL emailStatus:'failed' döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: authHeader(adminToken),
      payload: { name: "Yeni Kullanıcı", email: "new-user@example.com" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.emailStatus).toBe("failed");
    expect(body.data.setPasswordUrl).toBeUndefined();
    expect(body.data.user.email).toBe("new-user@example.com");

    // Kayıt gerçekten oluşturulmuş (geri alınmamış) olmalı.
    const created = await app.prisma.user.findUnique({ where: { email: "new-user@example.com" } });
    expect(created).not.toBeNull();
  });

  it("response body/response gövdesi hiçbir yerde ham token/reset-password URL'i İÇERMEZ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: authHeader(adminToken),
      payload: { name: "Yeni Kullanıcı 2", email: "new-user-2@example.com" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.payload).not.toMatch(/reset-password\?token=/);
  });
});
