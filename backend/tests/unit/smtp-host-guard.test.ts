import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `.claude/security-review-smtp-settings.md` KARAR 2 (bağlayıcı) — `EmailSettings.smtpHost`
 * SSRF/sözdizimi doğrulaması. `lib/mail.ts` gibi `env`'i module-level okuduğu için
 * `SMTP_ALLOW_PRIVATE_HOST` senaryolarında `vi.resetModules()` + `vi.doMock` gerekir.
 */

function mockEnv(overrides: Partial<{ SMTP_ALLOW_PRIVATE_HOST: boolean }> = {}) {
  vi.doMock("../../src/config/env", () => ({
    env: { SMTP_ALLOW_PRIVATE_HOST: false, ...overrides },
    isProd: false,
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("../../src/config/env");
});

describe("validateSmtpHostSyntax — Katman A (KARAR 2.2)", () => {
  it("çok-etiketli bir public hostname'i kabul eder", async () => {
    mockEnv();
    const { validateSmtpHostSyntax } = await import("../../src/lib/smtp-host-guard");
    expect(validateSmtpHostSyntax("smtp.example.com")).toEqual({ host: "smtp.example.com", isIpLiteral: false });
  });

  it("bir IPv4 literal'ini kabul eder (webhook politikasından KASITLI sapma)", async () => {
    mockEnv();
    const { validateSmtpHostSyntax } = await import("../../src/lib/smtp-host-guard");
    expect(validateSmtpHostSyntax("203.0.113.5")).toEqual({ host: "203.0.113.5", isIpLiteral: true });
  });

  it("boş string'i reddeder", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("")).toThrow(SmtpHostValidationError);
  });

  it("kimlik bilgisi içeren host'u reddeder (user:pass@)", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("user:pass@smtp.example.com")).toThrow(SmtpHostValidationError);
  });

  it("şema eki içeren host'u reddeder (smtp://)", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("smtp://smtp.example.com")).toThrow(SmtpHostValidationError);
  });

  it("gömülü port içeren host'u reddeder (host string'inin İÇİNDE : olamaz)", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("smtp.example.com:587")).toThrow(SmtpHostValidationError);
  });

  it("boşluk içeren host'u reddeder", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("smtp example.com")).toThrow(SmtpHostValidationError);
  });

  it("kontrol karakteri içeren host'u reddeder", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("smtp.example.com\n")).toThrow(SmtpHostValidationError);
  });

  it("253 karakterden uzun host'u reddeder", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    const longHost = `${"a".repeat(250)}.com`;
    expect(() => validateSmtpHostSyntax(longHost)).toThrow(SmtpHostValidationError);
  });

  it("ne IP literal ne RFC1123 desenine uyan host'u reddeder", async () => {
    mockEnv();
    const { validateSmtpHostSyntax, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    expect(() => validateSmtpHostSyntax("-invalid-.example.com")).toThrow(SmtpHostValidationError);
  });
});

describe("validateSmtpHostNetwork — Katman B (KARAR 2.4)", () => {
  it("varsayılan (SMTP_ALLOW_PRIVATE_HOST=false) iken özel/loopback/metadata bir IP literal'ini reddeder", async () => {
    mockEnv({ SMTP_ALLOW_PRIVATE_HOST: false });
    const { validateSmtpHostNetwork, SmtpHostValidationError } = await import("../../src/lib/smtp-host-guard");
    await expect(validateSmtpHostNetwork("127.0.0.1", true)).rejects.toBeInstanceOf(SmtpHostValidationError);
    await expect(validateSmtpHostNetwork("10.0.5.20", true)).rejects.toBeInstanceOf(SmtpHostValidationError);
    // 169.254.169.254 — bulut metadata endpoint'i (KARAR 2.1 gerekçesi, IAM kimlik bilgisi hırsızlığı sınıfı).
    await expect(validateSmtpHostNetwork("169.254.169.254", true)).rejects.toBeInstanceOf(SmtpHostValidationError);
  });

  it("varsayılan iken public bir IP literal'ini kabul eder", async () => {
    mockEnv({ SMTP_ALLOW_PRIVATE_HOST: false });
    const { validateSmtpHostNetwork } = await import("../../src/lib/smtp-host-guard");
    // 8.8.8.8 — bilinen bir public unicast adres (Google DNS), hiçbir RFC 5737/1918/... bloğuna düşmez.
    await expect(validateSmtpHostNetwork("8.8.8.8", true)).resolves.toBeUndefined();
  });

  it("SMTP_ALLOW_PRIVATE_HOST=true iken özel/loopback/metadata bir IP literal'ine izin verir (escape hatch, kısmi gevşetme YOK)", async () => {
    mockEnv({ SMTP_ALLOW_PRIVATE_HOST: true });
    const { validateSmtpHostNetwork } = await import("../../src/lib/smtp-host-guard");
    await expect(validateSmtpHostNetwork("10.0.5.20", true)).resolves.toBeUndefined();
    await expect(validateSmtpHostNetwork("169.254.169.254", true)).resolves.toBeUndefined();
    await expect(validateSmtpHostNetwork("127.0.0.1", true)).resolves.toBeUndefined();
  });
});
