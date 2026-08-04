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

function fakeApp() {
  return {
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as import("fastify").FastifyInstance;
}

function mockEnv(overrides: Partial<{ SMTP_HOST: string; NODE_ENV: string }>) {
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
