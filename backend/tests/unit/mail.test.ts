import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/mail.ts, `config/env.ts`'teki tekil (module-level) `env` objesini import zamanında okur —
 * bu yüzden farklı SMTP_HOST senaryolarını test edebilmek için her testte `vi.resetModules()` +
 * `vi.doMock("../../src/config/env", ...)` ile modülü sıfırdan (farklı env değerleriyle) import
 * ediyoruz. `nodemailer`'ın kendisi de mock'lanır — testler gerçek bir ağ çağrısı YAPMAZ.
 */

const sendMailFn = vi.hoisted(() => vi.fn());
const createTransportFn = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMailFn })));
const createTestAccountFn = vi.hoisted(() => vi.fn());
const getTestMessageUrlFn = vi.hoisted(() => vi.fn((): string | false => false));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportFn,
    createTestAccount: createTestAccountFn,
    getTestMessageUrl: getTestMessageUrlFn,
  },
}));

/**
 * `lib/mail.ts` artık her `sendMail()` çağrısında `app.prisma.emailSettings.findUnique(...)`
 * okur (§3.1/§3.4, bağlayıcı) — `fakeApp()` bu yüzden bir `prisma` saplaması taşır. Varsayılan
 * `null` (hiç `EmailSettings` satırı yok) — bu, §3.1 öncelik zincirinin 2-5. adımlarının (env/
 * ethereal/hata) test edildiği ESKİ testlerin davranışını DEĞİŞTİRMEZ.
 */
function fakeApp(emailSettingsRow: unknown = null) {
  return {
    log: { info: vi.fn(), error: vi.fn() },
    prisma: { emailSettings: { findUnique: vi.fn().mockResolvedValue(emailSettingsRow) } },
  } as unknown as import("fastify").FastifyInstance;
}

// 32 byte, base64 — yalnızca test amaçlı sabit bir anahtar (gerçek bir sır DEĞİL). `lib/mail.ts`
// artık (DB parolası çözme yolu üzerinden) `lib/crypto.ts`'i transitively import ediyor; o modül
// import ANINDA `env.ENCRYPTION_KEY`'i doğrular — mock edilen `env` nesnesi bu alanı İÇERMELİDİR,
// aksi halde `await import("../../src/lib/mail")` modül yükleme anında fırlar.
const TEST_ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function mockEnv(overrides: Partial<{ SMTP_HOST: string; NODE_ENV: string; SMTP_ALLOW_PRIVATE_HOST: boolean }>) {
  vi.doMock("../../src/config/env", () => ({
    env: {
      NODE_ENV: "test",
      SMTP_HOST: "",
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "No-Reply <no-reply@example.com>",
      FRONTEND_URL: "http://localhost:3000",
      ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      SMTP_ALLOW_PRIVATE_HOST: false,
      ...overrides,
    },
    isProd: overrides.NODE_ENV === "production",
  }));
}

beforeEach(() => {
  vi.resetModules();
  sendMailFn.mockReset();
  createTransportFn.mockClear();
  createTestAccountFn.mockReset();
  getTestMessageUrlFn.mockReset().mockReturnValue(false);
});

afterEach(() => {
  vi.doUnmock("../../src/config/env");
});

describe("lib/mail sendMail", () => {
  it("sends through the configured SMTP transport when SMTP_HOST is set", async () => {
    mockEnv({ SMTP_HOST: "smtp.example.com" });
    sendMailFn.mockResolvedValue({ messageId: "msg-123" });

    const { sendMail } = await import("../../src/lib/mail");
    const app = fakeApp();

    const result = await sendMail(app, { to: "user@example.com", subject: "Konu", html: "<p>Merhaba</p>" });

    expect(result.messageId).toBe("msg-123");
    expect(createTransportFn).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 587 })
    );
    expect(sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com", subject: "Konu", html: "<p>Merhaba</p>" })
    );
  });

  it("throws EmailDeliveryError (does not swallow) when the SMTP transport rejects", async () => {
    mockEnv({ SMTP_HOST: "smtp.example.com" });
    sendMailFn.mockRejectedValue(new Error("connection refused"));

    const { sendMail } = await import("../../src/lib/mail");
    const { EmailDeliveryError } = await import("../../src/lib/errors");
    const app = fakeApp();

    await expect(sendMail(app, { to: "user@example.com", subject: "Konu", html: "<p>x</p>" })).rejects.toBeInstanceOf(
      EmailDeliveryError
    );
    // Hata loglanmalı (stack + hedef adres) — ama şifre/token gibi hassas veri geçmemeli.
    expect(app.log.error).toHaveBeenCalled();
    const [loggedPayload] = (app.log.error as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(loggedPayload).toMatchObject({ to: "user@example.com" });
    expect(JSON.stringify(loggedPayload)).not.toMatch(/token|password|şifre/i);
  });

  it("throws a clear EmailDeliveryError when SMTP_HOST is unset outside development (e.g. test/production)", async () => {
    mockEnv({ SMTP_HOST: "", NODE_ENV: "test" });

    const { sendMail } = await import("../../src/lib/mail");
    const { EmailDeliveryError } = await import("../../src/lib/errors");
    const app = fakeApp();

    await expect(sendMail(app, { to: "user@example.com", subject: "Konu", html: "<p>x</p>" })).rejects.toBeInstanceOf(
      EmailDeliveryError
    );
    expect(createTestAccountFn).not.toHaveBeenCalled();
    expect(sendMailFn).not.toHaveBeenCalled();
  });

  it("auto-creates an Ethereal test account when SMTP_HOST is unset in development", async () => {
    mockEnv({ SMTP_HOST: "", NODE_ENV: "development" });
    createTestAccountFn.mockResolvedValue({
      user: "ethereal-user",
      pass: "ethereal-pass",
      smtp: { host: "smtp.ethereal.email", port: 587, secure: false },
    });
    sendMailFn.mockResolvedValue({ messageId: "msg-ethereal" });
    getTestMessageUrlFn.mockReturnValue("https://ethereal.email/message/abc");

    const { sendMail } = await import("../../src/lib/mail");
    const app = fakeApp();

    const result = await sendMail(app, { to: "user@example.com", subject: "Konu", html: "<p>x</p>" });

    expect(createTestAccountFn).toHaveBeenCalledTimes(1);
    expect(result.previewUrl).toBe("https://ethereal.email/message/abc");
  });
});

/**
 * `.claude/architect-scope-smtp-settings.md` §3.1/§3.4 + `.claude/security-review-smtp-settings.md`
 * KARAR 4 — DB (`EmailSettings`) öncelik zinciri, transporter parmak izi ve `ENCRYPTION_KEY`
 * rotasyonunda fail-closed davranış. `lib/smtp-host-guard.ts` (gerçek DNS çözümlemesi yapar) BU
 * BLOKTA mock'lanır — birim testler ağ çağrısı YAPMAZ, SSRF doğrulamasının kendisi
 * `tests/unit/smtp-host-guard.test.ts`'te AYRICA test edilir.
 */
describe("lib/mail — EmailSettings (DB) öncelik zinciri, transporter parmak izi, decrypt hatası", () => {
  function mockSmtpHostGuard() {
    vi.doMock("../../src/lib/smtp-host-guard", () => ({
      validateSmtpHost: vi.fn().mockResolvedValue(undefined),
      SmtpHostValidationError: class SmtpHostValidationError extends Error {
        reason = "mocked";
      },
    }));
  }

  afterEach(() => {
    vi.doUnmock("../../src/lib/smtp-host-guard");
  });

  function dbRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      enabled: true,
      smtpHost: "db-smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: null,
      smtpPasswordCiphertext: null,
      fromAddress: null,
      fromName: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("enabled=true && smtpHost dolu iken env dolu olsa bile DB yapılandırmasını kullanır (DB kazanır)", async () => {
    mockEnv({ SMTP_HOST: "env-smtp.example.com" });
    mockSmtpHostGuard();
    sendMailFn.mockResolvedValue({ messageId: "msg-db" });

    const { encryptSecret } = await import("../../src/lib/crypto");
    const { sendMail } = await import("../../src/lib/mail");
    const app = fakeApp(
      dbRow({
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "db-user",
        smtpPasswordCiphertext: encryptSecret("db-pass"),
        fromAddress: "db-from@example.com",
        fromName: "DB Gönderen",
      })
    );

    const result = await sendMail(app, { to: "user@example.com", subject: "Konu", html: "<p>x</p>" });

    expect(result.messageId).toBe("msg-db");
    expect(createTransportFn).toHaveBeenCalledWith(expect.objectContaining({ host: "db-smtp.example.com", port: 465, secure: true }));
    expect(sendMailFn).toHaveBeenCalledWith(expect.objectContaining({ from: "DB Gönderen <db-from@example.com>" }));
  });

  it("enabled=false iken smtpHost dolu olsa bile env yapılandırmasına düşer (§3.1 adım 2)", async () => {
    mockEnv({ SMTP_HOST: "env-smtp.example.com" });
    mockSmtpHostGuard();
    sendMailFn.mockResolvedValue({ messageId: "msg-env" });

    const { sendMail } = await import("../../src/lib/mail");
    const app = fakeApp(dbRow({ enabled: false }));

    await sendMail(app, { to: "user@example.com", subject: "Konu", html: "<p>x</p>" });

    expect(createTransportFn).toHaveBeenCalledWith(expect.objectContaining({ host: "env-smtp.example.com" }));
  });

  it("DB yapılandırması değişince (updatedAt parmak izi) transporter yeniden kurulur, değişmezse önbellekten kullanılır", async () => {
    mockEnv({ SMTP_HOST: "" });
    mockSmtpHostGuard();
    sendMailFn.mockResolvedValue({ messageId: "msg-1" });

    const { sendMail } = await import("../../src/lib/mail");
    const app = fakeApp(dbRow());

    await sendMail(app, { to: "a@example.com", subject: "s", html: "h" });
    expect(createTransportFn).toHaveBeenCalledTimes(1);

    // Aynı parmak izi (updatedAt değişmedi) — transporter YENİDEN KURULMAZ.
    await sendMail(app, { to: "a@example.com", subject: "s", html: "h" });
    expect(createTransportFn).toHaveBeenCalledTimes(1);

    // `updatedAt` değişti (yeni bir PATCH) — transporter yeniden kurulmalı.
    (app.prisma.emailSettings.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      dbRow({ smtpHost: "db-smtp-2.example.com", updatedAt: new Date("2026-01-02T00:00:00.000Z") })
    );
    await sendMail(app, { to: "a@example.com", subject: "s", html: "h" });
    expect(createTransportFn).toHaveBeenCalledTimes(2);
    expect(createTransportFn).toHaveBeenLastCalledWith(expect.objectContaining({ host: "db-smtp-2.example.com" }));
  });

  it("resetMailTransporter() çağrıldıktan sonra parmak izi AYNI kalsa bile transporter yeniden kurulur", async () => {
    mockEnv({ SMTP_HOST: "" });
    mockSmtpHostGuard();
    sendMailFn.mockResolvedValue({ messageId: "msg-1" });

    const { sendMail, resetMailTransporter } = await import("../../src/lib/mail");
    const app = fakeApp(dbRow());

    await sendMail(app, { to: "a@example.com", subject: "s", html: "h" });
    expect(createTransportFn).toHaveBeenCalledTimes(1);

    resetMailTransporter();
    await sendMail(app, { to: "a@example.com", subject: "s", html: "h" });
    expect(createTransportFn).toHaveBeenCalledTimes(2);
  });

  it("kayıtlı parola çözülemezse (ENCRYPTION_KEY rotasyonu) fail-closed EmailDeliveryError fırlatır, env'e SESSİZCE düşmez", async () => {
    mockEnv({ SMTP_HOST: "env-smtp.example.com" });
    mockSmtpHostGuard();

    const { sendMail } = await import("../../src/lib/mail");
    const { EmailDeliveryError } = await import("../../src/lib/errors");
    const app = fakeApp(dbRow({ smtpUser: "db-user", smtpPasswordCiphertext: "not-a-valid-ciphertext" }));

    await expect(sendMail(app, { to: "user@example.com", subject: "s", html: "h" })).rejects.toBeInstanceOf(EmailDeliveryError);
    // env'e SESSİZCE düşmedi — createTransport hiç env host'uyla çağrılmadı.
    expect(createTransportFn).not.toHaveBeenCalled();
  });

  it("hiç EmailSettings satırı yoksa (null) ve env de boşsa, test ortamında EmailDeliveryError fırlatır (regresyon)", async () => {
    mockEnv({ SMTP_HOST: "", NODE_ENV: "test" });
    mockSmtpHostGuard();

    const { sendMail } = await import("../../src/lib/mail");
    const { EmailDeliveryError } = await import("../../src/lib/errors");
    const app = fakeApp(null);

    await expect(sendMail(app, { to: "user@example.com", subject: "s", html: "h" })).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});

describe("lib/mail computeEffectiveEmailSource", () => {
  it("enabled && smtpHost dolu iken 'database' döner (env dolu olsa bile)", async () => {
    mockEnv({ SMTP_HOST: "env-smtp.example.com" });
    const { computeEffectiveEmailSource } = await import("../../src/lib/mail");
    expect(computeEffectiveEmailSource({ enabled: true, smtpHost: "db-smtp.example.com" })).toBe("database");
  });

  it("enabled=false iken (smtpHost dolu olsa bile) env'e düşer", async () => {
    mockEnv({ SMTP_HOST: "env-smtp.example.com" });
    const { computeEffectiveEmailSource } = await import("../../src/lib/mail");
    expect(computeEffectiveEmailSource({ enabled: false, smtpHost: "db-smtp.example.com" })).toBe("env");
  });

  it("satır yok/smtpHost boş ve env de boşken development'ta 'ethereal', diğer ortamlarda 'none' döner", async () => {
    mockEnv({ SMTP_HOST: "", NODE_ENV: "development" });
    const dev = await import("../../src/lib/mail");
    expect(dev.computeEffectiveEmailSource(null)).toBe("ethereal");

    vi.resetModules();
    mockEnv({ SMTP_HOST: "", NODE_ENV: "production" });
    const prod = await import("../../src/lib/mail");
    expect(prod.computeEffectiveEmailSource(null)).toBe("none");
  });
});
