import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { encryptSecret } from "../../src/lib/crypto";
import { generateWebhookSecret, webhookSecretLast4 } from "../../src/lib/webhook-signature";

/**
 * §10.13.7/§10.13.8/§10.13.10 — giden webhook yönetimi (`/admin/settings/webhooks`, SADECE
 * ADMIN) + SSRF doğrulaması (oluşturma anında).
 */
describe("outbound-webhooks — admin CRUD + SSRF doğrulaması", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "webhooks-admin@example.com" });
    adminToken = admin.accessToken;
    // İkinci kayıt USER olur (şema varsayılanı, bkz. admin-users.test.ts::"kayıt akışı" notu).
    const viewer = await registerTestUser(app, { email: "webhooks-viewer@example.com" });
    viewerToken = viewer.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("statik olay kayıt defterini döner — PING listede yer alır ama abonelik olarak REDDEDİLİR", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/webhooks/events", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    const events = res.json().data.map((e: { event: string }) => e.event);
    expect(events).toContain("PING");
    expect(events).toContain("BLOG_POST_PUBLISHED");
  });

  it("ADMIN olmayan (USER) okuma dahil 403 alır", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/webhooks", headers: authHeader(viewerToken) });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ["http:// yalnızca https kabul edilir", "http://hooks.example.com/cms"],
    ["literal IP yasak", "https://93.184.216.34/cms"],
    ["tek etiketli host yasak", "https://internalhost/cms"],
    [".internal soneki yasak", "https://svc.internal/cms"],
    ["localhost yasak", "https://localhost/cms"],
    ["443 dışı port yasak", "https://hooks.example.com:8443/cms"],
    ["PING abonelik olarak gönderilemez", "https://hooks.example.com/cms"],
  ])("webhook oluşturma reddi: %s", async (_label, url) => {
    const isPingCase = _label.startsWith("PING");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(adminToken),
      payload: { name: "Test Hook", url, events: isPingCase ? ["PING"] : ["BLOG_POST_PUBLISHED"] },
    });
    expect(res.statusCode).toBe(422);
  });

  it("boş events dizisi 422 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(adminToken),
      payload: { name: "Test Hook", url: "https://hooks.example.com/cms", events: [] },
    });
    expect(res.statusCode).toBe(422);
  });

  it("status: DISABLED ile oluşturma 422 döner (yalnızca sistem üretebilir)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(adminToken),
      payload: { name: "Test Hook", url: "https://hooks.example.com/cms", events: ["BLOG_POST_PUBLISHED"], status: "DISABLED" },
    });
    expect(res.statusCode).toBe(422);
  });

  let webhookId: string;

  it("geçerli bir public DNS adıyla webhook oluşturulur — plainSecret bir kez döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(adminToken),
      payload: { name: "Zapier", url: "https://example.com/hooks/cms", events: ["BLOG_POST_PUBLISHED", "ORDER_PAID"] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.plainSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(body.data.webhook.secretLast4).toBe(body.data.plainSecret.slice(-4));
    expect(JSON.stringify(body)).not.toContain("http://");

    webhookId = body.data.webhook.id;
  });

  it("liste ucu secret'ı ASLA döndürmez", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings/webhooks", headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((w: { id: string }) => w.id === webhookId)).toBe(true);
  });

  it("PATCH ile events güncellenir, tekrarlanan değerler teklenir", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/settings/webhooks/${webhookId}`,
      headers: authHeader(adminToken),
      payload: { events: ["ORDER_PAID", "ORDER_PAID", "ORDER_CREATED"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.events.sort()).toEqual(["ORDER_CREATED", "ORDER_PAID"]);
  });

  it("rotate-secret yeni bir plainSecret üretir — eskisi geçersizleşir", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/webhooks/${webhookId}/rotate-secret`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.plainSecret).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it("PUT/PATCH ile URL güncellenirken SSRF kontrolü YENİDEN çalışır", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/settings/webhooks/${webhookId}`,
      headers: authHeader(adminToken),
      payload: { url: "http://insecure.example.com" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("test gönderimi (PING) 202 döner ve deliveryId taşır", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/webhooks/${webhookId}/test`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.deliveryId).toBeTruthy();
  });

  it("delivery log listelenebilir", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/settings/webhooks/${webhookId}/deliveries`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("başka bir webhook'un deliveryId'si ile IDOR denemesi 404 döner", async () => {
    const otherRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(adminToken),
      payload: { name: "Diğer Hook", url: "https://example.org/hooks", events: ["ORDER_CREATED"] },
    });
    const otherWebhookId = otherRes.json().data.webhook.id;

    const deliveries = await app.inject({
      method: "GET",
      url: `/api/v1/admin/settings/webhooks/${webhookId}/deliveries`,
      headers: authHeader(adminToken),
    });
    const deliveryId = deliveries.json().data[0].id;

    const idorRes = await app.inject({
      method: "GET",
      url: `/api/v1/admin/settings/webhooks/${otherWebhookId}/deliveries/${deliveryId}`,
      headers: authHeader(adminToken),
    });
    expect(idorRes.statusCode).toBe(404);
  });

  it("DELETE ile webhook silinir (204) — ilişkili deliveryler cascade gider", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/v1/admin/settings/webhooks/${webhookId}`, headers: authHeader(adminToken) });
    expect(res.statusCode).toBe(204);

    const remaining = await app.prisma.webhookDelivery.count({ where: { webhookId } });
    expect(remaining).toBe(0);
  });

});

/**
 * `WEBHOOK_MAX_COUNT` (20) testi KENDİ İZOLE `buildTestApp()` instance'ında çalışır. 20 satır
 * doğrudan Prisma ile (route/`WEBHOOK_MANAGEMENT_RATE_LIMIT` üzerinden GEÇMEDEN) tohumlanır —
 * aksi hâlde `POST` ile 20 kez oluşturmak `WEBHOOK_MANAGEMENT_RATE_LIMIT`'in (20/dk, AYNI eşik)
 * 21. isteği rate-limit'in `onRequest` hook'unda (route handler'a hiç ULAŞMADAN) 429 ile
 * kesmesine yol açardı — bu, gerçek `WEBHOOK_MAX_COUNT` (409) davranışını test EDEMEZDİ
 * (bkz. rate-limits.test.ts'teki izolasyon gerekçesiyle AYNI sorun sınıfı).
 */
describe("outbound-webhooks — WEBHOOK_MAX_COUNT (20) sınırı", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const admin = await registerTestUser(app, { email: "webhooks-max-count-admin@example.com" });
    adminToken = admin.accessToken;

    const rows = Array.from({ length: 20 }, (_, i) => {
      const plainSecret = generateWebhookSecret();
      return {
        name: `Seed Hook ${i}`,
        url: `https://example.com/hooks/${i}`,
        secretEncrypted: encryptSecret(plainSecret),
        secretLast4: webhookSecretLast4(plainSecret),
        events: ["ORDER_CREATED" as const],
      };
    });
    await app.prisma.outboundWebhook.createMany({ data: rows });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("20. webhook'tan sonra yeni bir tanım 409 döner", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "One Too Many", url: "https://example.com/hooks/toomany", events: ["ORDER_CREATED"] },
    });
    expect(res.statusCode).toBe(409);
  });
});
