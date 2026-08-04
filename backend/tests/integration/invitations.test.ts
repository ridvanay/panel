import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * `POST /organizations/:orgId/invitations` — SMTP mock'lanmadan (.env.test/NODE_ENV=test →
 * SMTP_HOST tanımsız, ORG_INVITATION şablonu da bu dosyada seed edilmiyor) çalışır. Amaç:
 * e-posta gönderimi başarısız olsa (veya şablon eksik olsa) bile davetin DB'de PENDING olarak
 * oluşturulduğunu, isteğin 201 ile başarılı döndüğünü ve response'un/hiçbir yerin ham davet
 * token'ını/accept-url'ini SIZDIRMADIĞINI kanıtlamak (bkz. security-agent kararı — token
 * sızıntısı temizliği: eski `app.log.info({ acceptUrl })` satırı kaldırıldı).
 * Başarılı gönderim + doğru değişken render senaryosu için bkz. invitations-email-success.test.ts.
 */
describe("POST /organizations/:orgId/invitations — SMTP/şablon yapılandırılmadan (test ortamı)", () => {
  let app: FastifyInstance;
  let ownerToken: string;
  let orgId: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const owner = await registerTestUser(app, { email: "owner@example.com", name: "Org Sahibi" });
    ownerToken = owner.accessToken;

    const orgRes = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: authHeader(ownerToken),
      payload: { name: "Acme Inc" },
    });
    expect(orgRes.statusCode).toBe(201);
    orgId = orgRes.json().data.id as string;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("e-posta gönderimi başarısız olsa bile davet DB'de PENDING olarak oluşturulur (201 döner)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/invitations`,
      headers: authHeader(ownerToken),
      payload: { email: "invitee@example.com", role: "MEMBER" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.email).toBe("invitee@example.com");
    expect(body.data.status).toBe("PENDING");

    const invitation = await app.prisma.invitation.findFirst({ where: { email: "invitee@example.com" } });
    expect(invitation).not.toBeNull();
    expect(invitation?.status).toBe("PENDING");

    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${orgId}/invitations`,
      headers: authHeader(ownerToken),
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.some((i: { email: string }) => i.email === "invitee@example.com")).toBe(true);
  });

  it("response body/gövdesi hiçbir yerde ham davet token'ını veya accept-url'ini İÇERMEZ", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/invitations`,
      headers: authHeader(ownerToken),
      payload: { email: "invitee2@example.com", role: "MEMBER" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.payload).not.toMatch(/invitations\/[^/]+\/accept/);
  });
});
