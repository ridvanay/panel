import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `sendMail()` mock'lanır (bkz. tests/integration/auth-forgot-password-success.test.ts İLE AYNI
 * patern) — gerçek SMTP'ye hiç dokunulmaz. `../../src/lib/stripe` module'ü İSE BİLEREK
 * mock'LANMAZ: `stripe.webhooks.generateTestHeaderString`/`constructEvent` saf yerel HMAC
 * işlemleridir (ağ çağrısı YAPMAZ) — gerçek imza doğrulama kod yolunu uçtan uca test etmek için
 * kasıtlı olarak gerçek Stripe SDK kullanılır. Yalnızca abonelik regresyon testinde ağ çağrısı
 * yapan TEK metod (`stripe.subscriptions.retrieve`) `vi.spyOn` ile mock'lanır.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { stripe } from "../../src/lib/stripe";
import { env } from "../../src/config/env";

describe("webhooks/stripe — sepet siparişi (order) akışı (§10.9.3, KRİTİK)", () => {
  let app: FastifyInstance;

  async function createProduct(overrides: Partial<{ priceCents: number; stockQuantity: number }> = {}) {
    return app.prisma.product.create({
      data: {
        title: `Webhook Ürünü ${crypto.randomUUID()}`,
        slug: `webhook-urun-${crypto.randomUUID()}`,
        priceCents: overrides.priceCents ?? 10000,
        currency: "TRY",
        stockQuantity: overrides.stockQuantity ?? 5,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
  }

  async function createPendingOrder(
    product: { id: string; title: string; sku: string | null; priceCents: number; currency: string },
    quantity: number,
    customerEmail = `buyer-${crypto.randomUUID()}@example.com`
  ) {
    const unitPriceCents = product.priceCents;
    const lineTotalCents = unitPriceCents * quantity;
    return app.prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        customerEmail,
        customerName: "Test Müşteri",
        status: "PENDING",
        currency: product.currency,
        subtotalCents: lineTotalCents,
        discountCents: 0,
        taxCents: 0,
        totalCents: lineTotalCents,
        items: {
          create: [
            {
              productId: product.id,
              productTitle: product.title,
              productSku: product.sku,
              unitPriceCents,
              quantity,
              lineTotalCents,
            },
          ],
        },
      },
      include: { items: true },
    });
  }

  function buildCheckoutSessionEvent(
    orderId: string,
    type: "checkout.session.completed" | "checkout.session.expired" = "checkout.session.completed"
  ) {
    return {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000),
      type,
      data: {
        object: {
          id: `cs_test_${crypto.randomUUID()}`,
          object: "checkout.session",
          mode: "payment",
          metadata: { kind: "order", orderId },
        },
      },
    };
  }

  async function postWebhook(eventBody: unknown, opts: { signed?: boolean } = { signed: true }) {
    const payloadString = JSON.stringify(eventBody);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.signed !== false) {
      headers["stripe-signature"] = stripe.webhooks.generateTestHeaderString({
        payload: payloadString,
        secret: env.STRIPE_WEBHOOK_SECRET,
      });
    }
    return app.inject({ method: "POST", url: "/api/v1/webhooks/stripe", headers, payload: payloadString });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    // prisma/seed.ts'in kurduğu ORDER_CONFIRMATION şablonunun bir kopyası — global test setup'ı
    // seed script'ini çalıştırmıyor (bkz. tests/integration/auth-forgot-password-success.test.ts notu).
    await app.prisma.emailTemplate.create({
      data: {
        key: "ORDER_CONFIRMATION",
        name: "Sipariş Onay E-postası",
        subject: "Siparişiniz alındı — {{order_number}}",
        bodyHtml: "<p>{{customer_name}}, {{order_number}} numaralı siparişiniz alındı. Toplam: {{total_formatted}}. {{items_summary}}</p>",
        availableVariables: ["order_number", "customer_name", "items_summary", "total_formatted"],
      },
    });
  });

  afterEach(() => {
    sendMailMock.mockClear();
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("imzasız (stripe-signature header'ı olmayan) istek 400 döner", async () => {
    const product = await createProduct();
    const order = await createPendingOrder(product, 1);
    const res = await postWebhook(buildCheckoutSessionEvent(order.id), { signed: false });
    expect(res.statusCode).toBe(400);
  });

  it("geçersiz imzalı istek 400 döner", async () => {
    const product = await createProduct();
    const order = await createPendingOrder(product, 1);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/stripe",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      payload: JSON.stringify(buildCheckoutSessionEvent(order.id)),
    });
    expect(res.statusCode).toBe(400);
  });

  it("checkout.session.completed (mode:payment) → stok düşer, Order PAID olur, onay e-postası gönderilir", async () => {
    const product = await createProduct({ stockQuantity: 5 });
    const order = await createPendingOrder(product, 2);

    const res = await postWebhook(buildCheckoutSessionEvent(order.id));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    const updatedProduct = await app.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updatedProduct.stockQuantity).toBe(3);

    const updatedOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("PAID");
    expect(updatedOrder.paidAt).not.toBeNull();

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, mailInput] = sendMailMock.mock.calls[0] as unknown as [unknown, { to: string; subject: string; html: string }];
    expect(mailInput.to).toBe(order.customerEmail);
    expect(mailInput.subject).toContain(order.orderNumber);
  });

  it("AYNI event 2 kez gönderilirse (idempotency) stok SADECE 1 kez düşer, e-posta SADECE 1 kez gider", async () => {
    const product = await createProduct({ stockQuantity: 5 });
    const order = await createPendingOrder(product, 1);
    const event = buildCheckoutSessionEvent(order.id);

    const first = await postWebhook(event);
    expect(first.statusCode).toBe(200);
    const second = await postWebhook(event);
    expect(second.statusCode).toBe(200);

    const updatedProduct = await app.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updatedProduct.stockQuantity).toBe(4); // 5 - 1, İKİNCİ kez DÜŞMEDİ.

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("stok yetersizken webhook gelirse Order FAILED olur, HATA FIRLATMAZ (200 döner), stok değişmez", async () => {
    const product = await createProduct({ stockQuantity: 1 });
    const order = await createPendingOrder(product, 3); // istenen miktar mevcut stoktan fazla.

    const res = await postWebhook(buildCheckoutSessionEvent(order.id));
    expect(res.statusCode).toBe(200);

    const updatedOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("FAILED");
    expect(updatedOrder.errorSummary).toBe("insufficient_stock");

    const updatedProduct = await app.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updatedProduct.stockQuantity).toBe(1); // düşürülmedi.

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("EŞZAMANLILIK: aynı ürünün son adedine yarışan iki webhook — biri PAID, diğeri FAILED olur", async () => {
    const product = await createProduct({ stockQuantity: 1 });
    const orderA = await createPendingOrder(product, 1, "concurrent-a@example.com");
    const orderB = await createPendingOrder(product, 1, "concurrent-b@example.com");

    const [resA, resB] = await Promise.all([
      postWebhook(buildCheckoutSessionEvent(orderA.id)),
      postWebhook(buildCheckoutSessionEvent(orderB.id)),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    const [updatedA, updatedB] = await Promise.all([
      app.prisma.order.findUniqueOrThrow({ where: { id: orderA.id } }),
      app.prisma.order.findUniqueOrThrow({ where: { id: orderB.id } }),
    ]);

    const statuses = [updatedA.status, updatedB.status].sort();
    expect(statuses).toEqual(["FAILED", "PAID"]);

    const updatedProduct = await app.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updatedProduct.stockQuantity).toBe(0);
  });

  it("checkout.session.expired → PENDING sipariş EXPIRED olur", async () => {
    const product = await createProduct();
    const order = await createPendingOrder(product, 1);

    const res = await postWebhook(buildCheckoutSessionEvent(order.id, "checkout.session.expired"));
    expect(res.statusCode).toBe(200);

    const updatedOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("EXPIRED");
  });

  it("checkout.session.expired PENDING OLMAYAN bir siparişi ETKİLEMEZ (idempotent)", async () => {
    const product = await createProduct({ stockQuantity: 5 });
    const order = await createPendingOrder(product, 1);
    await postWebhook(buildCheckoutSessionEvent(order.id)); // önce PAID yap.

    const res = await postWebhook(buildCheckoutSessionEvent(order.id, "checkout.session.expired"));
    expect(res.statusCode).toBe(200);

    const updatedOrder = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe("PAID"); // EXPIRED'a DÖNMEDİ.
  });

  it("REGRESYON: mevcut abonelik webhook akışı (mode:subscription) HÂLÂ ÇALIŞIYOR", async () => {
    const owner = await registerTestUser(app, { email: `sub-owner-${crypto.randomUUID()}@example.com` });
    const org = await app.prisma.organization.create({
      data: { name: "Webhook Regresyon Org", slug: `webhook-regresyon-${crypto.randomUUID()}`, ownerId: owner.userId },
    });
    const plan = await app.prisma.plan.create({
      data: { name: "Regresyon Planı", priceMonthlyCents: 9900, priceYearlyCents: 99000, currency: "TRY" },
    });

    const fakeStripeSubscription = {
      id: `sub_test_${crypto.randomUUID()}`,
      status: "active",
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
      customer: `cus_test_${crypto.randomUUID()}`,
      metadata: {},
    };
    const retrieveSpy = vi
      .spyOn(stripe.subscriptions, "retrieve")
      // @ts-expect-error - testte yalnızca upsertSubscription'ın okuduğu alt küme sağlanıyor.
      .mockResolvedValue(fakeStripeSubscription);

    const event = {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      api_version: "2024-06-20",
      created: Math.floor(Date.now() / 1000),
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${crypto.randomUUID()}`,
          object: "checkout.session",
          mode: "subscription",
          subscription: fakeStripeSubscription.id,
          metadata: { organizationId: org.id, planId: plan.id },
        },
      },
    };

    const res = await postWebhook(event);
    expect(res.statusCode).toBe(200);
    expect(retrieveSpy).toHaveBeenCalledWith(fakeStripeSubscription.id);

    const subscription = await app.prisma.subscription.findUnique({ where: { organizationId: org.id } });
    expect(subscription).not.toBeNull();
    expect(subscription?.status).toBe("ACTIVE");
    expect(subscription?.stripeSubscriptionId).toBe(fakeStripeSubscription.id);

    retrieveSpy.mockRestore();
  });
});
