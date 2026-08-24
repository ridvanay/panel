import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { hashPassword } from "../../src/lib/password";

describe("admin orders — /admin/orders (§10.9.3 Sepet + Stripe Checkout)", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let adminId: string;
  let managerToken: string;
  let editorToken: string;
  let userToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserDirect(role: "ADMIN" | "MANAGER" | "EDITOR" | "USER") {
    const passwordHash = await hashPassword("Sifre12345!");
    return app.prisma.user.create({
      data: {
        email: `orders-user-${crypto.randomUUID()}@example.com`,
        name: "Test Kullanıcı",
        passwordHash,
        role,
        status: "ACTIVE",
      },
    });
  }

  async function loginAs(email: string, password = "Sifre12345!"): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
    expect(res.statusCode).toBe(200);
    return res.json().data.tokens.accessToken as string;
  }

  async function createOrder(status: "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED" | "FULFILLED", customerEmail?: string) {
    const email = customerEmail ?? `musteri-${crypto.randomUUID()}@example.com`;
    return app.prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        customerEmail: email,
        customerName: "Ada Lovelace",
        status,
        currency: "TRY",
        subtotalCents: 10000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 10000,
        ...(status === "PAID" || status === "FULFILLED" ? { paidAt: new Date() } : {}),
        items: {
          create: [
            { productTitle: "Test Ürün", productSku: "SKU-1", unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000 },
          ],
        },
      },
      include: { items: true },
    });
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);

    const admin = await registerTestUser(app, { email: "orders-admin@example.com" });
    adminToken = admin.accessToken;
    adminId = admin.userId;

    const manager = await createUserDirect("MANAGER");
    managerToken = await loginAs(manager.email);

    const editor = await createUserDirect("EDITOR");
    editorToken = await loginAs(editor.email);

    const standardUser = await createUserDirect("USER");
    userToken = await loginAs(standardUser.email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kimliksiz istek 401 döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders" });
    expect(res.statusCode).toBe(401);
  });

  it("EDITOR/USER 403 döner, MANAGER 200 döner (.claude/architect-scope-rbac-5-tier.md §5.3 satır 11 — ADMIN + MANAGER)", async () => {
    const editorRes = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: authHeader(editorToken) });
    expect(editorRes.statusCode).toBe(403);

    const userRes = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: authHeader(userToken) });
    expect(userRes.statusCode).toBe(403);

    const managerRes = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: authHeader(managerToken) });
    expect(managerRes.statusCode).toBe(200);
  });

  it("GET /admin/orders listede customerEmail MASKELENİR, GET /:orderId detayda MASKESİZ döner", async () => {
    const order = await createOrder("PENDING", "gizli.musteri@example.com");

    const listRes = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: authHeader(adminToken) });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json().data.find((o: { id: string }) => o.id === order.id);
    expect(listed).toBeDefined();
    expect(listed.customerEmail).toBe("g***@example.com");
    expect(listed.customerEmail).not.toBe("gizli.musteri@example.com");

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/v1/admin/orders/${order.id}`,
      headers: authHeader(adminToken),
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().data.customerEmail).toBe("gizli.musteri@example.com");
    expect(detailRes.json().data.items).toHaveLength(1);
  });

  it("status filtresi doğru çalışır", async () => {
    await createOrder("CANCELLED");
    const paidOrder = await createOrder("PAID");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/orders?status=PAID",
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((o: { id: string }) => o.id);
    expect(ids).toContain(paidOrder.id);
    for (const row of res.json().data) {
      expect(row.status).toBe("PAID");
    }
  });

  it("olmayan sipariş için GET /:orderId 404 döner", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/orders/${crypto.randomUUID()}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("PAID -> FULFILLED geçişi çalışır ve audit log yazılır", async () => {
    const order = await createOrder("PAID");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "FULFILLED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("FULFILLED");

    const auditRow = await app.prisma.auditLog.findFirst({
      where: { action: "order.status_change", targetId: order.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(adminId);
    expect(auditRow?.metadata).toMatchObject({ from: "PAID", to: "FULFILLED" });
  });

  it("PENDING -> CANCELLED geçişi çalışır", async () => {
    const order = await createOrder("PENDING");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "CANCELLED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("CANCELLED");
  });

  it("izin verilmeyen geçişler 409 döner (ör. PENDING -> FULFILLED, FAILED -> FULFILLED)", async () => {
    const pendingOrder = await createOrder("PENDING");
    const res1 = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${pendingOrder.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "FULFILLED" },
    });
    expect(res1.statusCode).toBe(409);

    const failedOrder = await createOrder("FAILED");
    const res2 = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${failedOrder.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "FULFILLED" },
    });
    expect(res2.statusCode).toBe(409);
  });

  it("EDITOR durum değiştiremez (403)", async () => {
    const order = await createOrder("PAID");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(editorToken),
      payload: { status: "FULFILLED" },
    });
    expect(res.statusCode).toBe(403);
  });

  /**
   * `.claude/architect-scope-customer-portal.md` §6 — genişletilmiş geçiş tablosu +
   * `trackingNumber` zorunluluğu. Bkz. plan §9 madde 11/12.
   */
  it("PATCH /:orderId/status → SHIPPED (takip no'suz) 422 döner", async () => {
    const order = await createOrder("PAID");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "SHIPPED" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("PAID -> SHIPPED -> FULFILLED zinciri çalışır (shippedAt/deliveredAt/trackingNumber dolar) + SHIPPED -> PAID denemesi 409", async () => {
    const order = await createOrder("PAID");

    const shipRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "SHIPPED", trackingNumber: "TRK-999", shippingCarrier: "Aras Kargo" },
    });
    expect(shipRes.statusCode).toBe(200);
    expect(shipRes.json().data).toMatchObject({ status: "SHIPPED", trackingNumber: "TRK-999", shippingCarrier: "Aras Kargo" });
    expect(shipRes.json().data.shippedAt).not.toBeNull();
    expect(shipRes.json().data.deliveredAt).toBeNull();

    const fulfillRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "FULFILLED" },
    });
    expect(fulfillRes.statusCode).toBe(200);
    expect(fulfillRes.json().data.status).toBe("FULFILLED");
    expect(fulfillRes.json().data.deliveredAt).not.toBeNull();
    // Kargo bilgisi FULFILLED'a geçişte KORUNUR (üzerine yazılmaz).
    expect(fulfillRes.json().data.trackingNumber).toBe("TRK-999");

    // Sipariş artık FULFILLED (terminal) — plan §9 madde 12'deki "SHIPPED -> PAID denemesi"nin
    // ruhu: geriye/yana doğru bir geçiş denemesi 409 almalı. `status: "PAID"` şema seviyesinde
    // (`UpdateOrderStatusRequestSchema`) zaten geçerli bir HEDEF DEĞİLDİR (yalnızca
    // SHIPPED/FULFILLED/CANCELLED kabul edilir); bu yüzden geçerli ama İZİN VERİLMEYEN bir
    // hedefle (`SHIPPED`) test edilir — `ALLOWED_TRANSITIONS["FULFILLED"]` tanımsızdır.
    const invalidTransitionRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "SHIPPED", trackingNumber: "TRK-000" },
    });
    expect(invalidTransitionRes.statusCode).toBe(409); // FULFILLED -> SHIPPED izinli değil.
  });

  it("PAID -> FULFILLED (SHIPPED atlanarak) hâlâ çalışır — dijital/kargosuz ürün akışı", async () => {
    const order = await createOrder("PAID");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "FULFILLED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("FULFILLED");
  });
});
