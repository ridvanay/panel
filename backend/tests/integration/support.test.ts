import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createUserDirect(app: FastifyInstance, role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
  const { hashPassword } = await import("../../src/lib/password");
  const passwordHash = await hashPassword("Sifre12345!");
  return app.prisma.user.create({
    data: {
      email: `support-user-${crypto.randomUUID()}@example.com`,
      name: "Test Personel",
      passwordHash,
      role,
      status: "ACTIVE",
    },
  });
}

async function loginAs(app: FastifyInstance, email: string, password = "Sifre12345!"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().data.tokens.accessToken as string;
}

async function setLiveChatEnabled(app: FastifyInstance, enabled: boolean) {
  await app.prisma.siteSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", liveChatEnabled: enabled, liveChatProvider: "internal" },
    update: { liveChatEnabled: enabled, liveChatProvider: "internal" },
  });
}

async function createSession(app: FastifyInstance, message = "Merhaba, yardım alabilir miyim?") {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/support/sessions",
    payload: { message, visitorName: "Ziyaretçi", visitorEmail: "ziyaretci@example.com" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data as { sessionId: string; accessToken: string; status: string; message: { id: string; seq: number } };
}

describe("Canlı Destek (Support)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await setLiveChatEnabled(app, true);
    const admin = await createUserDirect(app, "ADMIN");
    adminToken = await loginAs(app, admin.email);
  });

  afterEach(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  describe("Ziyaretçi yüzeyi", () => {
    it("liveChatEnabled=false iken POST /support/sessions 404 döner", async () => {
      await setLiveChatEnabled(app, false);
      const res = await app.inject({ method: "POST", url: "/api/v1/support/sessions", payload: { message: "Merhaba" } });
      expect(res.statusCode).toBe(404);
    });

    it("oturum + ilk mesaj birlikte oluşturulur, accessToken bir kez döner", async () => {
      const created = await createSession(app);
      expect(created.accessToken).toBeTruthy();
      expect(created.status).toBe("PENDING");
      expect(created.message.seq).toBeGreaterThan(0);

      const session = await app.prisma.supportChatSession.findUniqueOrThrow({ where: { id: created.sessionId } });
      expect(session.messageCount).toBe(1);
      // Ham token DB'de SAKLANMAZ, yalnızca hash.
      expect(session.accessTokenHash).not.toBe(created.accessToken);
    });

    it("yanlış/eksik token ile mesaj çekmek 404 döner (varlık sızdırılmaz)", async () => {
      const created = await createSession(app);

      const wrongToken = await app.inject({
        method: "GET",
        url: `/api/v1/support/sessions/${created.sessionId}/messages?t=yanlis-token`,
      });
      expect(wrongToken.statusCode).toBe(404);

      const noToken = await app.inject({ method: "GET", url: `/api/v1/support/sessions/${created.sessionId}/messages` });
      expect(noToken.statusCode).toBe(404);
    });

    it("doğru token ile mesajlar çekilir, meta.status/meta.lastSeq döner", async () => {
      const created = await createSession(app);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/support/sessions/${created.sessionId}/messages?t=${created.accessToken}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta.status).toBe("PENDING");
      expect(body.meta.lastSeq).toBe(created.message.seq);
    });

    it("CLOSED bir oturuma ziyaretçi mesajı 409 SUPPORT_SESSION_CLOSED döner", async () => {
      const created = await createSession(app);
      await app.prisma.supportChatSession.update({ where: { id: created.sessionId }, data: { status: "CLOSED" } });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/support/sessions/${created.sessionId}/messages?t=${created.accessToken}`,
        payload: { body: "Hala orada mısınız?" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("SUPPORT_SESSION_CLOSED");
    });

    it("201. mesaj denemesi 409 SUPPORT_MESSAGE_LIMIT döner", async () => {
      const created = await createSession(app);
      await app.prisma.supportChatSession.update({ where: { id: created.sessionId }, data: { messageCount: 200 } });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/support/sessions/${created.sessionId}/messages?t=${created.accessToken}`,
        payload: { body: "Bir tane daha" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("SUPPORT_MESSAGE_LIMIT");
    });

    it("ANSWERED bir oturuma ziyaretçi mesajı gönderince PENDING'e geri döner", async () => {
      const created = await createSession(app);
      await app.prisma.supportChatSession.update({ where: { id: created.sessionId }, data: { status: "ANSWERED" } });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/support/sessions/${created.sessionId}/messages?t=${created.accessToken}`,
        payload: { body: "Yine ben" },
      });
      expect(res.statusCode).toBe(201);

      const session = await app.prisma.supportChatSession.findUniqueOrThrow({ where: { id: created.sessionId } });
      expect(session.status).toBe("PENDING");
    });
  });

  describe("Yönetim yüzeyi", () => {
    it("EDITOR/USER → 403", async () => {
      const editorToken = await loginAs(app, (await createUserDirect(app, "EDITOR")).email);
      const userToken = await loginAs(app, (await createUserDirect(app, "USER")).email);

      for (const token of [editorToken, userToken]) {
        const res = await app.inject({ method: "GET", url: "/api/v1/admin/support/sessions", headers: authHeader(token) });
        expect(res.statusCode).toBe(403);
      }
    });

    it("ADMIN oturumları listeler, meta.counts TÜM oturumlar üzerinden hesaplanır", async () => {
      await createSession(app);
      await createSession(app);

      const res = await app.inject({ method: "GET", url: "/api/v1/admin/support/sessions", headers: authHeader(adminToken) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.counts.pending).toBe(2);
      expect(body.meta.counts.all).toBe(2);
    });

    it("GET /admin/support/sessions/{id} detayı döner ve support.session_viewed audit'i oturum+personel+gün başına BİR KEZ yazılır", async () => {
      const created = await createSession(app);

      const first = await app.inject({
        method: "GET",
        url: `/api/v1/admin/support/sessions/${created.sessionId}`,
        headers: authHeader(adminToken),
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "GET",
        url: `/api/v1/admin/support/sessions/${created.sessionId}`,
        headers: authHeader(adminToken),
      });
      expect(second.statusCode).toBe(200);

      // İki `GET` çağrısına RAĞMEN aynı gün+personel+oturum için TEK audit kaydı.
      const allViewedAudits = await app.prisma.auditLog.findMany({ where: { action: "support.session_viewed", targetId: created.sessionId } });
      expect(allViewedAudits).toHaveLength(1);
    });

    it("temsilci yanıtı gönderince ANSWERED'e geçer, atanmamışsa OTOMATİK sahiplenir", async () => {
      const created = await createSession(app);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/admin/support/sessions/${created.sessionId}/messages`,
        headers: authHeader(adminToken),
        payload: { body: "Size nasıl yardımcı olabilirim?" },
      });
      expect(res.statusCode).toBe(201);

      const session = await app.prisma.supportChatSession.findUniqueOrThrow({ where: { id: created.sessionId } });
      expect(session.status).toBe("ANSWERED");
      expect(session.assignedAgentId).not.toBeNull();

      const assignAudit = await app.prisma.auditLog.findFirst({ where: { action: "support.session_assigned", targetId: created.sessionId } });
      expect(assignAudit).not.toBeNull();
    });

    it("başkasına atanmış bir oturuma yanıt verilince atama DEĞİŞMEZ", async () => {
      const created = await createSession(app);
      const managerUser = await createUserDirect(app, "MANAGER");
      const managerToken = await loginAs(app, managerUser.email);

      await app.prisma.supportChatSession.update({
        where: { id: created.sessionId },
        data: { assignedAgentId: managerUser.id, assignedAt: new Date() },
      });

      await app.inject({
        method: "POST",
        url: `/api/v1/admin/support/sessions/${created.sessionId}/messages`,
        headers: authHeader(adminToken),
        payload: { body: "Ben de yardımcı olayım" },
      });

      const session = await app.prisma.supportChatSession.findUniqueOrThrow({ where: { id: created.sessionId } });
      expect(session.assignedAgentId).toBe(managerUser.id);
      void managerToken;
    });

    it("PATCH ile ANSWERED elle set edilemez → 422", async () => {
      const created = await createSession(app);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/support/sessions/${created.sessionId}`,
        headers: authHeader(adminToken),
        payload: { status: "ANSWERED" },
      });
      expect(res.statusCode).toBe(422);
    });

    it("agentId = EDITOR/USER/pasif ADMIN → 422", async () => {
      const created = await createSession(app);
      const editor = await createUserDirect(app, "EDITOR");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/support/sessions/${created.sessionId}/assign`,
        headers: authHeader(adminToken),
        payload: { agentId: editor.id },
      });
      expect(res.statusCode).toBe(422);
    });

    it("GET /admin/support/agents yalnızca {id,name,role} döner, email YOK", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/admin/support/agents", headers: authHeader(adminToken) });
      expect(res.statusCode).toBe(200);
      const agents = res.json().data as Record<string, unknown>[];
      expect(agents.length).toBeGreaterThan(0);
      for (const agent of agents) {
        expect(agent.email).toBeUndefined();
        expect(["ADMIN", "MANAGER"]).toContain(agent.role);
      }
    });

    it("DELETE oturumu ve mesajlarını KALICI siler", async () => {
      const created = await createSession(app);
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/support/sessions/${created.sessionId}`,
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(204);

      const gone = await app.prisma.supportChatSession.findUnique({ where: { id: created.sessionId } });
      expect(gone).toBeNull();
      const messages = await app.prisma.supportChatMessage.findMany({ where: { sessionId: created.sessionId } });
      expect(messages).toHaveLength(0);
    });
  });
});
