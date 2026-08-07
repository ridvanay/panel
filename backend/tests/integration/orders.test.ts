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
  let editorToken: string;
  let viewerToken: string;

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUserDirect(role: "ADMIN" | "EDITOR" | "VIEWER") {
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

    const editor = await createUserDirect("EDITOR");
    editorToken = await loginAs(editor.email);

    const viewer = await createUserDirect("VIEWER");
    viewerToken = await loginAs(viewer.email);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kimliksiz istek 401 döner", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/orders" });
    expect(res.statusCode).toBe(401);
  });

  it("EDITOR/VIEWER 403 döner (yalnızca ADMIN)", async () => {
    const editorRes = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: authHeader(editorToken) });
    expect(editorRes.statusCode).toBe(403);

    const viewerRes = await app.inject({ method: "GET", url: "/api/v1/admin/orders", headers: authHeader(viewerToken) });
    expect(viewerRes.statusCode).toBe(403);
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

  it("EDITOR/VIEWER durum değiştiremez (403)", async () => {
    const order = await createOrder("PAID");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(editorToken),
      payload: { status: "FULFILLED" },
    });
    expect(res.statusCode).toBe(403);
  });
});
