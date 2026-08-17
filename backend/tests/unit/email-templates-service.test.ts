import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * email-templates.service.ts, gönderim için lib/mail.ts::sendMail'i çağırır — burada gerçek SMTP'ye
 * hiç dokunmadan sadece render + sendMail çağrısının doğruluğunu test ediyoruz (mock'lanmış).
 *
 * §10.16.3 BREAKING — `sendTemplateEmail` artık `key` DEĞİL `purpose` ile çözümlenir
 * (`findFirst({ where: { purpose, isActive: true } })`); ayrıca her çağrıda `site_name`/`site_url`
 * otomatik enjekte etmek için `siteSettings`/`page`/`locale` de okunur (bkz. buildEmailRenderContext).
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "id-1" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import {
  sendTemplateEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSystemAnnouncement,
} from "../../src/modules/email-templates/email-templates.service";
import { NotFoundError } from "../../src/lib/errors";

function fakeApp(overrides: {
  findFirst?: ReturnType<typeof vi.fn>;
  findManyUsers?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    prisma: {
      emailTemplate: { findFirst: overrides.findFirst ?? vi.fn() },
      user: { findMany: overrides.findManyUsers ?? vi.fn() },
      siteSettings: { findUnique: vi.fn().mockResolvedValue({ siteName: "Test Site", logoUrl: null }) },
      page: { findMany: vi.fn().mockResolvedValue([]) },
      locale: { findMany: vi.fn().mockResolvedValue([]) },
      contactFormField: { findMany: vi.fn().mockResolvedValue([]) },
    },
  } as unknown as import("fastify").FastifyInstance;
}

describe("email-templates.service", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: "id-1" });
  });

  it("renders only allow-listed variables and calls sendMail with the rendered subject/html", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      purpose: "WELCOME",
      editorMode: "RAW",
      subject: "Merhaba {{user_name}}",
      bodyHtml: "<p>{{user_name}} - {{secret}}</p>",
      customVariables: [],
    });
    const app = fakeApp({ findFirst });

    await sendTemplateEmail(app, "WELCOME", "a@example.com", { user_name: "Alice", secret: "leak" });

    expect(findFirst).toHaveBeenCalledWith({ where: { purpose: "WELCOME", isActive: true } });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; subject: string; html: string }];
    expect(input.to).toBe("a@example.com");
    expect(input.subject).toBe("Merhaba Alice");
    // Allow-list dışı değişken ({{secret}}) render edilmeden OLDUĞU GİBİ bırakılmalı, değeri sızmamalı.
    expect(input.html).toContain("{{secret}}");
    expect(input.html).not.toContain("leak");
  });

  it("throws NotFoundError (does not call sendMail) when no active template exists for the purpose", async () => {
    const app = fakeApp({ findFirst: vi.fn().mockResolvedValue(null) });

    await expect(sendTemplateEmail(app, "WELCOME", "a@example.com", {})).rejects.toBeInstanceOf(NotFoundError);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sendWelcomeEmail resolves the active WELCOME template by purpose", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      purpose: "WELCOME",
      editorMode: "RAW",
      subject: "Hoş geldin {{user_name}}",
      bodyHtml: '<a href="{{login_url}}">giriş</a>',
      customVariables: [],
    });
    const app = fakeApp({ findFirst });

    await sendWelcomeEmail(app, { email: "bob@example.com", name: "Bob" });

    expect(findFirst).toHaveBeenCalledWith({ where: { purpose: "WELCOME", isActive: true } });
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string }];
    expect(input.to).toBe("bob@example.com");
  });

  it("sendPasswordResetEmail renders PASSWORD_RESET with the given resetUrl", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      purpose: "PASSWORD_RESET",
      editorMode: "RAW",
      subject: "Sıfırlama",
      bodyHtml: '<a href="{{reset_link}}">sıfırla</a>',
      customVariables: [],
    });
    const app = fakeApp({ findFirst });

    await sendPasswordResetEmail(app, { email: "c@example.com", name: "Carol" }, "https://x/reset?token=abc");

    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { html: string }];
    expect(input.html).toContain("https://x/reset?token=abc");
  });

  it("injects site_name/site_url globally even when the caller does not pass them", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      purpose: "WELCOME",
      editorMode: "RAW",
      subject: "{{site_name}}'e hoş geldin",
      bodyHtml: "<p>{{site_url}}</p>",
      customVariables: [],
    });
    const app = fakeApp({ findFirst });

    await sendTemplateEmail(app, "WELCOME", "a@example.com", { user_name: "Alice" });

    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { subject: string; html: string }];
    expect(input.subject).toBe("Test Site'e hoş geldin");
    expect(input.html).toContain("http://localhost:3000");
  });

  it("sendSystemAnnouncement continues past per-user failures and aggregates sent/failed", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      purpose: "SYSTEM_ANNOUNCEMENT",
      editorMode: "RAW",
      subject: "{{announcement_title}}",
      bodyHtml: "<p>{{user_name}} - {{announcement_body}}</p>",
      customVariables: [],
    });
    const findManyUsers = vi.fn().mockResolvedValue([
      { id: "u1", email: "u1@example.com", name: "U1" },
      { id: "u2", email: "u2@example.com", name: "U2" },
    ]);
    const app = fakeApp({ findFirst, findManyUsers });

    sendMailMock.mockResolvedValueOnce({ messageId: "ok" }).mockRejectedValueOnce(new Error("smtp down"));

    const result = await sendSystemAnnouncement(app, ["u1", "u2"], { title: "Bakım", body: "Yarın bakım var." });

    expect(result.sent).toEqual(["u1"]);
    expect(result.failed).toEqual([{ userId: "u2", error: "smtp down" }]);
  });
});
