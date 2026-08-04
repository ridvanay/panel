import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `sendMail()` (bkz. src/lib/mail.ts) mock'lanır — gerçek SMTP/Ethereal'a hiç dokunulmaz.
 * Amaç: `POST /organizations/:orgId/invitations` → `sendTemplateEmail(app, "ORG_INVITATION", ...)`
 * zincirinin DB'deki ORG_INVITATION şablonunu doğru değişkenlerle (`inviter_name`,
 * `organization_name`, `accept_url`) render edip `sendMail()`'e doğru `to/subject/html` ile
 * ulaştığını uçtan uca kanıtlamak (bkz. prisma/seed.ts::ORG_INVITATION upsert'i).
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("POST /organizations/:orgId/invitations — SMTP mock'lanmış (başarı senaryosu)", () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let orgId: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // prisma/seed.ts'in kurduğu ORG_INVITATION şablonunun bir kopyası — global test setup'ı
    // seed script'ini çalıştırmıyor (bkz. tests/setup/global-setup.ts), bu yüzden elle ekliyoruz.
    await app.prisma.emailTemplate.create({
      data: {
        key: "ORG_INVITATION",
        name: "Organizasyon Daveti",
        subject: "{{inviter_name}} seni {{organization_name}} organizasyonuna davet etti",
        bodyHtml:
          '<p>{{inviter_name}}, seni {{organization_name}} organizasyonuna davet etti.</p><p><a href="{{accept_url}}">Daveti Kabul Et</a></p>',
        availableVariables: ["inviter_name", "organization_name", "accept_url"],
      },
    });

    const owner = await registerTestUser(app, { email: "owner-success@example.com", name: "Ada Lovelace" });
    ownerToken = owner.accessToken;

    const orgRes = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: authHeader(ownerToken),
      payload: { name: "Analytical Engines" },
    });
    orgId = orgRes.json().data.id as string;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("ORG_INVITATION şablonunu doğru değişkenlerle render edip sendMail'e gönderir", async () => {
    sendMailMock.mockClear();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/invitations`,
      headers: authHeader(ownerToken),
      payload: { email: "invitee-success@example.com", role: "MEMBER" },
    });

    expect(res.statusCode).toBe(201);
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; subject: string; html: string }];
    expect(input.to).toBe("invitee-success@example.com");
    expect(input.subject).toBe("Ada Lovelace seni Analytical Engines organizasyonuna davet etti");
    expect(input.html).toContain("Ada Lovelace");
    expect(input.html).toContain("Analytical Engines");
    expect(input.html).toContain("/invitations/");
    expect(input.html).toContain("/accept");
  });
});
