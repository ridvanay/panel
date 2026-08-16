import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * §10.13.8 — `emitWebhookEvent` yalnızca o olaya abone `ACTIVE` webhook'lar için bir
 * `WebhookDelivery` satırı oluşturur. `*_PUBLISHED` YALNIZCA duruma GEÇİŞTE (`BLOG_POST_UPDATED`
 * ise yayındaki içerik TEKRAR kaydedildiğinde) tetiklenir — qa-agent kritik akış (i).
 *
 * Gerçek ağ gönderimi (dispatcher) burada TEST EDİLMEZ — yalnızca `emitWebhookEvent`'in
 * `WebhookDelivery` satırını DOĞRU olayla/webhook'la kuyrukladığı doğrulanır (satır oluşumu
 * PATCH isteğinin kendi await zincirinde SENKRON tamamlanır, dispatcher'ın gerçek gönderimi
 * ayrı bir `setImmediate` turudur ve bu testi ETKİLEMEZ).
 */
describe("webhook emisyonu — *_PUBLISHED yalnızca duruma geçişte, abone olmayan webhook tetiklenmez", () => {
  let app: FastifyInstance;
  let accessToken: string;

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app, { email: "webhook-emission-admin@example.com" }));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("BLOG_POST_PUBLISHED yalnızca DRAFT→PUBLISHED geçişinde, BLOG_POST_UPDATED ise sonraki kayıtlarda tetiklenir", async () => {
    const subscribedRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(),
      payload: { name: "Abone Hook", url: "https://example.com/hooks/blog", events: ["BLOG_POST_PUBLISHED", "BLOG_POST_UPDATED"] },
    });
    expect(subscribedRes.statusCode).toBe(201);
    const subscribedWebhookId = subscribedRes.json().data.webhook.id;

    // Farklı bir olaya abone webhook — HİÇ tetiklenmemeli (sıfır maliyet kuralı).
    const unrelatedRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(),
      payload: { name: "İlgisiz Hook", url: "https://example.org/hooks/orders", events: ["ORDER_CREATED"] },
    });
    const unrelatedWebhookId = unrelatedRes.json().data.webhook.id;

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/blog",
      headers: authHeader(),
      payload: { title: "Webhook Testi", status: "DRAFT" },
    });
    const postId = createRes.json().data.id;

    // DRAFT → PUBLISHED geçişi: BLOG_POST_PUBLISHED tetiklenir.
    const publishRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/blog/${postId}`,
      headers: authHeader(),
      payload: { status: "PUBLISHED" },
    });
    expect(publishRes.statusCode).toBe(200);

    const afterPublish = await app.prisma.webhookDelivery.findMany({ where: { webhookId: subscribedWebhookId } });
    expect(afterPublish.map((d) => d.event)).toEqual(["BLOG_POST_PUBLISHED"]);
    expect(afterPublish[0]!.containsPii).toBe(false);

    const unrelatedDeliveries = await app.prisma.webhookDelivery.findMany({ where: { webhookId: unrelatedWebhookId } });
    expect(unrelatedDeliveries).toHaveLength(0);

    // Zaten PUBLISHED olan içerik tekrar kaydedilir: BLOG_POST_PUBLISHED TEKRAR tetiklenmez,
    // yalnızca BLOG_POST_UPDATED tetiklenir.
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/blog/${postId}`,
      headers: authHeader(),
      payload: { title: "Webhook Testi (güncellendi)" },
    });
    expect(updateRes.statusCode).toBe(200);

    const afterUpdate = await app.prisma.webhookDelivery.findMany({ where: { webhookId: subscribedWebhookId }, orderBy: { seq: "asc" } });
    expect(afterUpdate.map((d) => d.event)).toEqual(["BLOG_POST_PUBLISHED", "BLOG_POST_UPDATED"]);

    // Gönderilen zarf (payload) tüm olaylarda AYNI şekle sahiptir ve public DTO alanlarını taşır.
    const publishedPayload = afterUpdate[0]!.payload as { event: string; data: { title: string; author?: unknown } };
    expect(publishedPayload.event).toBe("BLOG_POST_PUBLISHED");
    expect(publishedPayload.data.title).toBe("Webhook Testi");
    expect(publishedPayload.data).not.toHaveProperty("author");
  });

  it("PAUSED/DISABLED webhook'lar emisyonda ATLANIR", async () => {
    const pausedRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(),
      payload: { name: "Duraklatılmış Hook", url: "https://example.net/hooks/pages", events: ["PAGE_PUBLISHED"], status: "PAUSED" },
    });
    const pausedWebhookId = pausedRes.json().data.webhook.id;

    const pageRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/pages",
      headers: authHeader(),
      payload: { title: "Duraklatılmış Test Sayfası", status: "DRAFT" },
    });
    const pageId = pageRes.json().data.id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/pages/${pageId}`,
      headers: authHeader(),
      payload: { status: "PUBLISHED" },
    });

    const deliveries = await app.prisma.webhookDelivery.findMany({ where: { webhookId: pausedWebhookId } });
    expect(deliveries).toHaveLength(0);
  });
});
