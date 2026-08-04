import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * email-templates.service.ts, gönderim için lib/mail.ts::sendMail'i çağırır — burada gerçek SMTP'ye
 * hiç dokunmadan sadece render + sendMail çağrısının doğruluğunu test ediyoruz (mock'lanmış).
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

function fakeApp(overrides: { findUnique?: ReturnType<typeof vi.fn>; findMany?: ReturnType<typeof vi.fn> } = {}) {
  return {
    log: { info: vi.fn(), error: vi.fn() },
    prisma: {
      emailTemplate: { findUnique: overrides.findUnique ?? vi.fn() },
      user: { findMany: overrides.findMany ?? vi.fn() },
    },
  } as unknown as import("fastify").FastifyInstance;
}

describe("email-templates.service", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({ messageId: "id-1" });
  });

  it("renders only allow-listed variables and calls sendMail with the rendered subject/html", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      key: "WELCOME",
      subject: "Merhaba {{user_name}}",
      bodyHtml: "<p>{{user_name}} - {{secret}}</p>",
      availableVariables: ["user_name"],
    });
    const app = fakeApp({ findUnique });

    await sendTemplateEmail(app, "WELCOME", "a@example.com", { user_name: "Alice", secret: "leak" });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; subject: string; html: string }];
    expect(input.to).toBe("a@example.com");
    expect(input.subject).toBe("Merhaba Alice");
    // Allow-list dışı değişken ({{secret}}) render edilmeden OLDUĞU GİBİ bırakılmalı, değeri sızmamalı.
    expect(input.html).toContain("{{secret}}");
    expect(input.html).not.toContain("leak");
  });

  it("throws NotFoundError (does not call sendMail) when the template key does not exist in the DB", async () => {
    const app = fakeApp({ findUnique: vi.fn().mockResolvedValue(null) });

    await expect(sendTemplateEmail(app, "MISSING", "a@example.com", {})).rejects.toBeInstanceOf(NotFoundError);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sendWelcomeEmail fetches the WELCOME template", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      key: "WELCOME",
      subject: "Hoş geldin {{user_name}}",
      bodyHtml: '<a href="{{login_url}}">giriş</a>',
      availableVariables: ["user_name", "login_url"],
    });
    const app = fakeApp({ findUnique });

    await sendWelcomeEmail(app, { email: "bob@example.com", name: "Bob" });

    expect(findUnique).toHaveBeenCalledWith({ where: { key: "WELCOME" } });
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string }];
    expect(input.to).toBe("bob@example.com");
  });

  it("sendPasswordResetEmail renders PASSWORD_RESET with the given resetUrl", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      key: "PASSWORD_RESET",
      subject: "Sıfırlama",
      bodyHtml: '<a href="{{reset_link}}">sıfırla</a>',
      availableVariables: ["user_name", "reset_link"],
    });
    const app = fakeApp({ findUnique });

    await sendPasswordResetEmail(app, { email: "c@example.com", name: "Carol" }, "https://x/reset?token=abc");

    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { html: string }];
    expect(input.html).toContain("https://x/reset?token=abc");
  });

  it("sendSystemAnnouncement continues past per-user failures and aggregates sent/failed", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      key: "SYSTEM_ANNOUNCEMENT",
      subject: "{{announcement_title}}",
      bodyHtml: "<p>{{user_name}} - {{announcement_body}}</p>",
      availableVariables: ["user_name", "announcement_title", "announcement_body"],
    });
    const findMany = vi.fn().mockResolvedValue([
      { id: "u1", email: "u1@example.com", name: "U1" },
      { id: "u2", email: "u2@example.com", name: "U2" },
    ]);
    const app = fakeApp({ findUnique, findMany });

    sendMailMock.mockResolvedValueOnce({ messageId: "ok" }).mockRejectedValueOnce(new Error("smtp down"));

    const result = await sendSystemAnnouncement(app, ["u1", "u2"], { title: "Bakım", body: "Yarın bakım var." });

    expect(result.sent).toEqual(["u1"]);
    expect(result.failed).toEqual([{ userId: "u2", error: "smtp down" }]);
  });
});
