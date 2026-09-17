import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Bug-fix turu (2026-09-17, kullanıcı onaylı) — bu dosya artık `sendMail()`'i (bkz. src/lib/mail.ts)
 * mock'lar. Gerekçe: gerçek (test ortamı) `sendMail()` yolu NODE_ENV=test'te KOŞULSUZ başarısız
 * olur (bkz. `.claude/architect-scope-smtp-settings.md` §3.1, adım 4 — "mevcut davranış,
 * değişmez") — bu, gerçek bir kullanıcı için `forgotPassword()`'un 202 dönebildiğini VE
 * `password_reset_tokens`'a satır yazdığını AYNI dosyada, mock'lamadan kanıtlamayı imkansız
 * kılar. Mock varsayılan olarak BAŞARILI döner; SMTP hatasını kanıtlayan testler
 * `mockImplementationOnce`/`mockRejectedValueOnce` ile o TEK çağrıyı başarısız kılar.
 * Başarılı gönderimin şablon render/`to`/`subject` doğruluğunu kanıtlayan ayrı, TEK amaçlı
 * dosya için bkz. `auth-forgot-password-success.test.ts` (bu dosyaya dokunulmadı).
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { EmailDeliveryError } from "../../src/lib/errors";

describe("POST /auth/forgot-password", () => {
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
    sendMailMock.mockClear();
    // Varsayılan davranışı başarılı gönderime SIFIRLA — bir önceki testin
    // `mockImplementationOnce`/`mockRejectedValueOnce` ile bıraktığı geçici override'lar
    // (varsa) tüketilmiş olur, ama emin olmak için burada da açıkça sıfırlıyoruz.
    sendMailMock.mockImplementation(async () => ({ messageId: "mocked-message-id" }));

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

  /**
   * GÜVENLİK ÖZELLİĞİ (anti-enumeration), BUG DEĞİL — kullanıcının "forgot-password 202
   * dönüyor ama `password_reset_tokens`'a kayıt açılmıyor" şikayetinin kök nedeni budur:
   * e-posta HİÇBİR `User` satırıyla eşleşmiyorsa `forgotPassword()`'un ilk satırı
   * (`if (!user) return;`) token'ı HİÇ üretmez — bu KASITLIDIR (e-posta numaralandırmasını
   * önlemek için route her zaman 202 döner, kayıtlı/kayıtsız e-posta arasında yanıt farkı
   * OLMAMALIDIR). Bu test, gelecekte biri bunu tekrar "bug" sanıp token üretmeye
   * zorlamasın diye bu davranışı AÇIKÇA belgeler ve kilitler.
   */
  it("does NOT create a password_reset_tokens row for an unregistered email (anti-enumeration, expected behavior)", async () => {
    const countBefore = await app.prisma.passwordResetToken.count();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: `kesinlikle-yok-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
    });

    const countAfter = await app.prisma.passwordResetToken.count();

    expect(res.statusCode).toBe(202);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(countAfter).toBe(countBefore);
  });

  /**
   * Regresyon testi — kullanıcının "gerçek kullanıcı için de kayıt açılmıyor" iddiasının
   * YANLIŞ olduğunu, gerçek bir kullanıcı için akışın uçtan uca doğru çalıştığını kanıtlar:
   * 202 döner, `password_reset_tokens`'a (hash'lenmiş token'la) bir satır yazılır ve
   * `expiresAt` ~1 saat sonrası makul bir aralıktadır (bkz. `createPasswordResetToken`).
   */
  it("creates a password_reset_tokens row with a ~1h expiresAt for a real, registered user and returns 202", async () => {
    const user = await registerTestUser(app, { email: `carol-${Date.now()}@example.com` });
    // `registerTestUser` kendi doğrulama-kodu e-postası için `sendMail()`'i ÇAĞIRMIŞTIR —
    // aşağıdaki `toHaveBeenCalledTimes(1)` iddiasının YALNIZCA forgot-password çağrısını
    // saymasını sağlamak için burada temizliyoruz.
    sendMailMock.mockClear();

    const beforeCall = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: user.email },
    });
    const afterCall = Date.now();

    expect(res.statusCode).toBe(202);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const token = await app.prisma.passwordResetToken.findFirst({ where: { userId: user.userId } });
    expect(token).not.toBeNull();

    const expiresAtMs = token!.expiresAt.getTime();
    // `createPasswordResetToken`: `expiresAt = now + 60 * 60 * 1000`. Makul bir tolerans
    // (birkaç saniyelik test çalışma süresi) bırakarak ~1 saat sonrasını doğrula.
    expect(expiresAtMs).toBeGreaterThan(beforeCall + 59 * 60 * 1000);
    expect(expiresAtMs).toBeLessThan(afterCall + 61 * 60 * 1000);
  });

  it("does NOT silently succeed for an existing user when SMTP delivery fails — returns 502 EMAIL_DELIVERY_FAILED", async () => {
    // `registerTestUser` de dahili olarak `sendMail()`'i çağırır (e-posta doğrulama kodu
    // gönderimi, best-effort/sessizce yutulur) — `mockImplementationOnce` bu ÖNCEKİ çağrı
    // tarafından TÜKETİLMESİN diye kullanıcı oluşturulduktan SONRA, forgot-password
    // çağrısından HEMEN ÖNCE ayarlanır.
    const user = await registerTestUser(app, { email: "dave@example.com" });
    sendMailMock.mockImplementationOnce(async () => {
      throw new EmailDeliveryError();
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: user.email },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("EMAIL_DELIVERY_FAILED");
  });

  /**
   * Bug-fix turu (2026-09-17, kullanıcı onaylı) — `auth.service.ts::logDevPasswordResetLink`
   * YALNIZCA `NODE_ENV === "development"` iken (gönderim başarılı OLSUN ya da OLMASIN)
   * sıfırlama bağlantısını `"[AUTH] Password Reset Link: <url>"` formatıyla loglar
   * (`logDevFallbackOtpCode` ile AYNI güvenlik disiplini). Bu test suite `NODE_ENV=test` ile
   * çalışır — bu testte SMTP gönderimi BİLEREK başarısız kılınır (yine de aynı disiplin
   * BAŞARILI gönderimde de geçerlidir, çünkü log çağrısı artık koşulsuzdur). Test ortamında
   * (ve production'da) sıfırlama bağlantısının/token'ın HİÇBİR log satırına yazılmadığını ve
   * hatanın hâlâ 502 olarak yükseldiğini (sessizce yutulmadığını) doğrular.
   */
  it("reset link is NOT logged in test/production environment (dev-only escape hatch) and the 502 is still thrown", async () => {
    // Sıralama notu: bkz. yukarıdaki test — `registerTestUser` kendi `sendMail()` çağrısını
    // yapar, bu yüzden `mockImplementationOnce` kullanıcı oluşturulduktan SONRA ayarlanır.
    const user = await registerTestUser(app, { email: "frank@example.com" });
    sendMailMock.mockImplementationOnce(async () => {
      throw new EmailDeliveryError();
    });

    const warnCalls: unknown[][] = [];
    const originalWarn = app.log.warn.bind(app.log);
    app.log.warn = ((...args: unknown[]) => {
      warnCalls.push(args);
      return (originalWarn as (...a: unknown[]) => unknown)(...args);
    }) as typeof app.log.warn;

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        payload: { email: user.email },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("EMAIL_DELIVERY_FAILED");
    } finally {
      app.log.warn = originalWarn;
    }

    expect(warnCalls.some((args) => JSON.stringify(args).includes("[AUTH] Password Reset Link"))).toBe(false);
    expect(warnCalls.some((args) => JSON.stringify(args).includes("reset-password?token="))).toBe(false);
  });
});
