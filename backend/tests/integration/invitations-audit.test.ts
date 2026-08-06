import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `sendMail()` (bkz. src/lib/mail.ts) mock'lanır — invitations-email-success.test.ts ile AYNI
 * GEREKÇE: gerçek SMTP/Ethereal'a hiç dokunulmadan, `sendTemplateEmail` çağrısının render ettiği
 * `accept_url`'i (davetin ham token'ını) test içinde YAKALAMAK için — response body/log artık
 * bu token'ı hiç sızdırmıyor (bkz. security-agent kararı), bu yüzden `POST .../accept`'i tetiklemek
 * için tek meşru yol mocklanmış e-posta gönderiminden token'ı okumaktır.
 *
 * Amaç: backend-agent'ın 994ff56 commit'inde eklediği audit log kayıtlarını (`invitation.create`,
 * `invitation.accept`) doğru `actorId`/`targetType`/`targetId`/`metadata` ile doğrulamak.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

describe("invitation audit log — invitation.create ve invitation.accept", () => {
  let app: FastifyInstance;
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let invitee: Awaited<ReturnType<typeof registerTestUser>>;
  let orgId: string;
  let invitationId: string;
  let rawToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // Global test setup ORG_INVITATION şablonunu seed etmiyor (bkz. invitations-email-success.test.ts
    // ile aynı gerekçe) — elle ekliyoruz, aksi halde sendTemplateEmail şablon bulunamadı hatası atar.
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

    owner = await registerTestUser(app, { email: "audit-owner@example.com", name: "Audit Sahibi" });
    // Davet kabul akışı `invitation.email === request.user!.email` eşitliğini şart koşuyor
    // (bkz. invitations.routes.ts::acceptInvitationRoutes), bu yüzden invitee'yi davetten ÖNCE
    // aynı e-postayla kayıt ediyoruz.
    invitee = await registerTestUser(app, { email: "audit-invitee@example.com", name: "Audit Davetli" });

    const orgRes = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: authHeader(owner.accessToken),
      payload: { name: "Audit Org" },
    });
    expect(orgRes.statusCode).toBe(201);
    orgId = orgRes.json().data.id as string;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("davet oluşturulunca AuditLog'da doğru actorId/targetId/metadata ile 'invitation.create' kaydı oluşur", async () => {
    sendMailMock.mockClear();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/invitations`,
      headers: authHeader(owner.accessToken),
      payload: { email: invitee.email, role: "MEMBER" },
    });

    expect(res.statusCode).toBe(201);
    invitationId = res.json().data.id as string;

    const auditRow = await app.prisma.auditLog.findFirst({
      where: { action: "invitation.create", targetId: invitationId },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(owner.userId);
    expect(auditRow?.actorEmail).toBe(owner.email);
    expect(auditRow?.targetType).toBe("Invitation");
    expect(auditRow?.status).toBe("SUCCESS");
    expect(auditRow?.metadata).toMatchObject({ organizationId: orgId, email: invitee.email, role: "MEMBER" });
    // Savunma amaçlı: audit metadata'sı token/URL SIZDIRMAMALI (bkz. lib/audit.ts KURAL yorumu).
    expect(JSON.stringify(auditRow?.metadata)).not.toMatch(/accept/i);

    // Ham token'ı, mocklanmış sendMail çağrısından (yanıt gövdesinde asla dönmüyor) çıkarıyoruz.
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, mailInput] = sendMailMock.mock.calls[0] as unknown as [unknown, { html: string }];
    const tokenMatch = mailInput.html.match(/\/invitations\/([^/]+)\/accept/);
    expect(tokenMatch).not.toBeNull();
    rawToken = tokenMatch![1]!;
  });

  it("davet kabul edilince AuditLog'da doğru actorId/targetId/metadata ile 'invitation.accept' kaydı oluşur", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${rawToken}/accept`,
      headers: authHeader(invitee.accessToken),
    });

    expect(res.statusCode).toBe(200);
    const membershipId = res.json().data.id as string;
    expect(res.json().data.role).toBe("MEMBER");

    const auditRow = await app.prisma.auditLog.findFirst({
      where: { action: "invitation.accept", targetId: membershipId },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(invitee.userId);
    expect(auditRow?.actorEmail).toBe(invitee.email);
    expect(auditRow?.targetType).toBe("Membership");
    expect(auditRow?.status).toBe("SUCCESS");
    expect(auditRow?.metadata).toMatchObject({ organizationId: orgId, role: "MEMBER" });

    // Davet artık PENDING değil, üyelik ACTIVE olmalı — audit kaydı yan etkiyle tutarlı.
    const membership = await app.prisma.membership.findUnique({ where: { id: membershipId } });
    expect(membership?.status).toBe("ACTIVE");
    const invitation = await app.prisma.invitation.findUnique({ where: { id: invitationId } });
    expect(invitation?.status).toBe("ACCEPTED");
  });
});
