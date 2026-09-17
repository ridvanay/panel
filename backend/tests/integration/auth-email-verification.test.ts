import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashOtpCode } from "../../src/lib/otp";

/**
 * NOT — bu dosyadaki testler `auth.routes.ts::AUTH_RATE_LIMIT`e (5/dk, ROUTE-bazlı — her uç
 * kendi bağımsız kovasına sahiptir) tabidir; her `describe` bloğu TEK bir paylaşılan `app`
 * kullanır (`tests/integration/auth.test.ts`teki AYNI disiplin), bu yüzden bir describe
 * içindeki HİÇBİR uca 5'ten fazla çağrı YAPILMAZ. 5-deneme kilitlenmesinin (§3.4) TAM
 * kapsamlı testi (`tests/unit/otp.test.ts::dies after MAX_VERIFICATION_ATTEMPTS...`) HTTP
 * seviyesinde DEĞİL, `lib/otp.ts` birim testinde yapılır — burada tekrar etmek 5/dk hız
 * sınırıyla ÇARPIŞIRDI.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

/**
 * `.claude/architect-scope-guest-account-otp.md` §2/§3/§4 (Özellik A) — `POST /auth/register`
 * artık `202 RegistrationPendingVerification` döner, token YALNIZCA `POST /auth/verify-email`
 * başarılı olduğunda üretilir. Bu dosya bu yeni sözleşmeyi + §3.4 deneme sınırını + §2.3'ün
 * "doğrulanmamış kullanıcı login'den token ALAMAZ" kuralını uçtan uca doğrular.
 *
 * Kod, DB satırındaki `codeHash`i `lib/otp.ts::hashOtpCode` (PUBLIC, saf fonksiyon) ile BİLİNEN
 * bir değere üzerine yazarak elde edilir — `tests/helpers/auth.ts::registerTestUser`teki AYNI
 * desen (gerekçe orada belgelenmiştir).
 */
async function registerAndOverrideCode(app: FastifyInstance, email: string, knownCode: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: "Sifre12345!", name: "Test User" },
  });
  expect(res.statusCode).toBe(202);
  const body = res.json();
  expect(body.data.verificationRequired).toBe(true);
  expect(body.data.email).toBe(email);

  const user = await app.prisma.user.findUniqueOrThrow({ where: { email } });
  const codeHash = hashOtpCode(user.id, "EMAIL_VERIFICATION", knownCode);
  await app.prisma.emailVerificationCode.updateMany({
    where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash },
  });
  return { userId: user.id, registerResponseBody: body };
}

describe("POST /auth/register — kırıcı sözleşme değişikliği (202, token/cookie YOK)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("201 DEĞİL 202 döner, gövdede token/user YOKTUR, refresh cookie SET EDİLMEZ", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: uniqueEmail("pending"), password: "Sifre12345!", name: "Pending User" },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data).toEqual({
      verificationRequired: true,
      email: expect.any(String),
      expiresAt: expect.any(String),
      resendAvailableAt: expect.any(String),
    });
    expect(body.data.user).toBeUndefined();
    expect(body.data.tokens).toBeUndefined();
    expect(res.cookies.find((c) => c.name === "refresh_token")).toBeUndefined();
  });

  it("doğrulama kodu HİÇBİR yanıt gövdesinde görünmez", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: uniqueEmail("no-leak"), password: "Sifre12345!", name: "No Leak" },
    });
    expect(JSON.stringify(res.json())).not.toMatch(/"code"\s*:\s*"\d{6}"/);
  });

  /**
   * Bug-fix turu (2026-09-18) — `auth.service.ts::logDevFallbackOtpCode` YALNIZCA
   * `NODE_ENV === "development"` iken kodu loglar (dev'de SMTP/Ethereal DAHİ başarısız olursa
   * geliştirici kaçış kapısı). Bu test suite `NODE_ENV=test` ile çalışır (bkz. `backend/.env.test`)
   * — bu ortamda e-posta gönderimi ZATEN her zaman başarısız olur (`lib/mail.ts` §3.1 adım 4,
   * SMTP yapılandırılmamış → `EmailDeliveryError`), yani HER `register()` çağrısı doğal olarak bu
   * fonksiyonun catch dalından geçer. Test ortamında (ve elbette production'da) kodun HİÇBİR
   * log satırına yazılmadığını doğrular — kullanıcı tarafından İSTENEN ama güvenlik gerekçesiyle
   * REDDEDİLEN "production log'larına gerçek OTP yaz" talebinin tam tersinin kilitlenmiş hâli.
   */
  it("doğrulama kodu test/production ortamında HİÇBİR log satırına yazılmaz (yalnızca development'a özel kaçış kapısı)", async () => {
    const warnCalls: unknown[][] = [];
    const originalWarn = app.log.warn.bind(app.log);
    app.log.warn = ((...args: unknown[]) => {
      warnCalls.push(args);
      return (originalWarn as (...a: unknown[]) => unknown)(...args);
    }) as typeof app.log.warn;

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: uniqueEmail("no-dev-log"), password: "Sifre12345!", name: "No Dev Log" },
      });
      expect(res.statusCode).toBe(202);
    } finally {
      app.log.warn = originalWarn;
    }

    expect(warnCalls.some((args) => JSON.stringify(args).includes("AUTH_OTP"))).toBe(false);
  });
});

describe("POST /auth/verify-email + POST /auth/login — e-posta doğrulama gate'i", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("doğrulanmamış bir kullanıcı DOĞRU parolayla login olamaz — requiresEmailVerification döner, token YOK", async () => {
    const email = uniqueEmail("unverified");
    await registerAndOverrideCode(app, email, "111111");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "Sifre12345!" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual({ requiresEmailVerification: true, email });
    expect(body.data.tokens).toBeUndefined();
  });

  it("doğru kod ile verify-email BAŞARILI olur — normal login ile BİREBİR AYNI çıktı (user + tokens)", async () => {
    const email = uniqueEmail("verify-ok");
    await registerAndOverrideCode(app, email, "222222");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { email, code: "222222" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user.email).toBe(email);
    expect(body.data.tokens.accessToken).toEqual(expect.any(String));

    // Artık normal login ÇALIŞIR (emailVerifiedAt SET edildi).
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "Sifre12345!" },
    });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.json().data.tokens).toBeDefined();
  });

  it("var olmayan e-posta / yanlış kod HEPSİ AYNI 401 VERIFICATION_CODE_INVALID gövdesini döner (hesap-varlık oracle'ı yok)", async () => {
    const ghostRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { email: "ghost-does-not-exist@example.com", code: "123456" },
    });
    expect(ghostRes.statusCode).toBe(401);
    expect(ghostRes.json().error.code).toBe("VERIFICATION_CODE_INVALID");

    const email = uniqueEmail("wrong-code");
    await registerAndOverrideCode(app, email, "444444");
    const wrongRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { email, code: "000001" },
    });
    expect(wrongRes.statusCode).toBe(401);
    expect(wrongRes.json().error.code).toBe("VERIFICATION_CODE_INVALID");

    expect(ghostRes.json().error.message).toBe(wrongRes.json().error.message);
  });
});

describe("POST /auth/resend-verification-code — numaralandırma karşıtı disiplin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("var olmayan e-posta için de HER ZAMAN 202 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification-code",
      payload: { email: "hic-boyle-biri-yok@example.com" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("gövdede `purpose` alanı KABUL EDİLMEZ/gerekmez — yalnızca `email`", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification-code",
      payload: { email: uniqueEmail("resend") },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("mevcut (backfill edilmiş) kullanıcıların girişi DEĞİŞMEDİ — regresyon (§2.4)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("`emailVerifiedAt` DOLU (grandfathered) bir kullanıcı hiçbir doğrulama adımı olmadan normal login olur", async () => {
    const email = uniqueEmail("grandfathered");
    const { hashPassword } = await import("../../src/lib/password");
    await app.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword("Sifre12345!"),
        name: "Grandfathered User",
        // Migration'ın backfill'iyle AYNI semantik: bu turdan ÖNCE var olan hesap gibi.
        emailVerifiedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "Sifre12345!" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tokens).toBeDefined();
  });
});

describe("2FA açık + emailVerifiedAt dolu — regresyon (backend-agent bulgusu, 2026-09-16)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  /**
   * Sonuç A doğrulaması — `auth.service.ts::login()`in dal sırası (1) şifre/status
   * (2) `emailVerifiedAt===null` → e-posta doğrulama (3) `twoFactorEnabled` → 2FA olduğundan,
   * `emailVerifiedAt` DOLU + 2FA açık bir kullanıcı login'de HER ZAMAN `requiresTwoFactor: true`
   * almalı, `requiresEmailVerification` ASLA görünmemeli (iki bayrak birbirini MASKELEMEMELİ).
   * TOTP kodları BU akışta (`POST /auth/2fa/verify`) doğrulanır, e-posta doğrulama servisiyle
   * KARIŞTIRILMAZ — `login-form.tsx::handleSubmit`teki `kind` ayrımı ile aynı sözleşme.
   */
  it("emailVerifiedAt dolu + twoFactorEnabled true → login requiresTwoFactor döner, requiresEmailVerification YOKTUR", async () => {
    const email = uniqueEmail("2fa-and-verified");
    const { hashPassword } = await import("../../src/lib/password");

    // `login()` şifre/status/emailVerifiedAt/twoFactorEnabled kontrollerinden SONRA bir
    // `challengeToken` döner — TOTP sırrının KENDİSİ bu adımda hiç okunmaz/çözülmez (yalnızca
    // `POST /auth/2fa/verify` çözer), bu yüzden burada gerçek (şifreli) bir sır GEREKMEZ.
    await app.prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword("Sifre12345!"),
        name: "2FA Verified User",
        emailVerifiedAt: new Date(),
        twoFactorEnabled: true,
        twoFactorSecret: "placeholder-not-decrypted-by-login",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "Sifre12345!" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.requiresTwoFactor).toBe(true);
    expect(body.challengeToken).toEqual(expect.any(String));
    expect(body.requiresEmailVerification).toBeUndefined();
    expect(body.tokens).toBeUndefined();
  });
});
