import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `.claude/architect-scope-order-management-pro.md` §6.2 — iptal e-postası tetikleyicisi
 * testleri için `sendMail()` mock'lanır (bkz. tests/integration/webhook-order.test.ts İLE AYNI
 * patern). Gerçek SMTP'ye hiç dokunulmaz.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "mocked-message-id" })));

vi.mock("../../src/lib/mail", () => ({
  sendMail: sendMailMock,
}));

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

  async function createOrder(
    status: "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED" | "FULFILLED" | "ON_HOLD" | "SHIPPED",
    customerEmail?: string,
    opts?: { siteUserId?: string }
  ) {
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
        ...(status === "PAID" || status === "FULFILLED" || status === "ON_HOLD" || status === "SHIPPED" ? { paidAt: new Date() } : {}),
        ...(opts?.siteUserId ? { siteUserId: opts.siteUserId } : {}),
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

    // `prisma/seed.ts`'in kurduğu `ORDER_CANCELLATION` şablonunun bir kopyası — global test
    // setup'ı seed script'ini çalıştırmıyor (bkz. tests/integration/webhook-order.test.ts notu).
    await app.prisma.emailTemplate.create({
      data: {
        key: "ORDER_CANCELLATION",
        name: "Sipariş İptal E-postası",
        purpose: "ORDER_CANCELLATION",
        editorMode: "RAW",
        isSystem: true,
        isActive: true,
        subject: "Siparişiniz iptal edildi — {{order_number}}",
        bodyHtml:
          "<p>{{customer_name}}, {{order_number}} numaralı siparişiniz iptal edildi. Neden: {{cancellation_reason}}. Toplam: {{total_formatted}}. {{items_summary}}</p>",
        availableVariables: ["order_number", "customer_name", "items_summary", "total_formatted", "cancellation_reason"],
      },
    });

    // `.claude/architect-scope-search-and-order-emails.md` §2.2a — `ORDER_SHIPPED` şablonunun
    // test kopyası (`prisma/seed.ts`'in seed ettiği gerçek şablonun aynısı, global test setup'ı
    // seed script'ini çalıştırmıyor — yukarıdaki ORDER_CANCELLATION İLE AYNI gerekçe).
    await app.prisma.emailTemplate.create({
      data: {
        key: "ORDER_SHIPPED",
        name: "Kargo Bildirim E-postası",
        purpose: "ORDER_SHIPPED",
        editorMode: "RAW",
        isSystem: true,
        isActive: true,
        subject: "Siparişiniz kargoya verildi — {{order_number}}",
        bodyHtml:
          "<p>{{customer_name}}, {{order_number}} numaralı siparişiniz kargoya verildi. Takip numarası: {{tracking_number}}. Toplam: {{total_formatted}}. {{items_summary}}</p>",
        availableVariables: [
          "order_number",
          "customer_name",
          "items_summary",
          "total_formatted",
          "tracking_number",
          "shipping_carrier",
        ],
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

  it("PENDING -> CANCELLED geçişi çalışır (cancellationReason zorunlu, ödenmemiş sipariş confirmWithoutRefund gerektirmez)", async () => {
    const order = await createOrder("PENDING");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/orders/${order.id}/status`,
      headers: authHeader(adminToken),
      payload: { status: "CANCELLED", cancellationReason: "Müşteri talebi", sendCustomerEmail: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("CANCELLED");
    expect(res.json().data.cancellationReason).toBe("Müşteri talebi");
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
    // geçerli bir hedeftir (§4.1, `ON_HOLD -> PAID` için) ama `ALLOWED_TRANSITIONS["FULFILLED"]`
    // tanımsız olduğu için HİÇBİR hedefe izin vermez; bu yüzden geçerli-şemalı ama İZİN
    // VERİLMEYEN bir hedefle (`SHIPPED`) test edilir.
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

  // ---------------------------------------------------------------------------------------
  // `.claude/architect-scope-order-management-pro.md` — ON_HOLD, RBAC daraltması, iptal
  // e-postası, düzenleme paneli, aktivite günlüğü (§4.1/§3.2/§3.5/§5.2/§5.3/§5.4).
  // ---------------------------------------------------------------------------------------

  describe("ON_HOLD geçiş tablosu (§4.1)", () => {
    it("PAID -> ON_HOLD (ADMIN) çalışır", async () => {
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "ON_HOLD" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("ON_HOLD");
    });

    it("ON_HOLD -> PAID (ADMIN, 'Siparişi Onayla') çalışır ve paidAt ÜZERİNE YAZILMAZ", async () => {
      const order = await createOrder("PAID");
      const originalPaidAt = order.paidAt?.toISOString();

      const holdRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "ON_HOLD" },
      });
      expect(holdRes.statusCode).toBe(200);

      const confirmRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "PAID" },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.json().data.status).toBe("PAID");
      expect(confirmRes.json().data.paidAt).toBe(originalPaidAt);
    });

    it("ON_HOLD -> CANCELLED: ödenmiş sipariş confirmWithoutRefund olmadan 409, onaylanınca 200", async () => {
      const order = await createOrder("ON_HOLD");

      const withoutConfirm = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "CANCELLED", cancellationReason: "Stok tükendi", sendCustomerEmail: false },
      });
      expect(withoutConfirm.statusCode).toBe(409);

      // Durum hâlâ ON_HOLD — reddedilen istek durumu DEĞİŞTİRMEMİŞ olmalı.
      const stillOnHold = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
      });
      expect(stillOnHold.json().data.status).toBe("ON_HOLD");

      const withConfirm = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: {
          status: "CANCELLED",
          cancellationReason: "Stok tükendi",
          sendCustomerEmail: false,
          confirmWithoutRefund: true,
        },
      });
      expect(withConfirm.statusCode).toBe(200);
      expect(withConfirm.json().data.status).toBe("CANCELLED");
      expect(withConfirm.json().data.cancellationReason).toBe("Stok tükendi");
    });

    it("race condition — aynı ON_HOLD siparişe eşzamanlı PAID ve CANCELLED istekleri: yalnızca biri kazanır (atomik claim)", async () => {
      const order = await createOrder("ON_HOLD");

      const [resToPaid, resToCancelled] = await Promise.all([
        app.inject({
          method: "PATCH",
          url: `/api/v1/admin/orders/${order.id}/status`,
          headers: authHeader(adminToken),
          payload: { status: "PAID" },
        }),
        app.inject({
          method: "PATCH",
          url: `/api/v1/admin/orders/${order.id}/status`,
          headers: authHeader(adminToken),
          payload: {
            status: "CANCELLED",
            cancellationReason: "Stok tükendi",
            sendCustomerEmail: false,
            confirmWithoutRefund: true,
          },
        }),
      ]);

      // Prisma'nın satır kilidi semantiği (bkz. POST /:orderId/refund'daki AYNI desen) sayesinde
      // her iki istek de aynı `existing.status` (ON_HOLD) görüntüsüyle geçiş kontrolünü geçebilir,
      // ama koşullu `updateMany({ where: { id, status: existing.status } })` yalnızca BİRİNİ
      // "kazandırır" — diğeri `claim.count === 0` ile 409 alır. "Son yazan kazanır" YOKTUR.
      const statusCodes = [resToPaid.statusCode, resToCancelled.statusCode].sort();
      expect(statusCodes).toEqual([200, 409]);

      const winnerBody = resToPaid.statusCode === 200 ? resToPaid.json().data : resToCancelled.json().data;
      const expectedWinnerStatus = resToPaid.statusCode === 200 ? "PAID" : "CANCELLED";
      expect(winnerBody.status).toBe(expectedWinnerStatus);

      // Nihai DB durumu kazananla TUTARLI olmalı — iki yazının "karışıp" tutarsız bir ara duruma
      // (ör. trackingNumber PAID'den ama status CANCELLED gibi) düşmediğini doğrular.
      const finalRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
      });
      expect(finalRes.json().data.status).toBe(expectedWinnerStatus);

      // Kaybeden istek hiçbir yan etkiye yol açmamalı — yalnızca kazanan tarafın
      // `order.status_change` audit kaydı oluşmalı, kaybedenden İKİNCİ bir kayıt OLUŞMAMALI.
      const statusChangeAuditCount = await app.prisma.auditLog.count({
        where: { targetType: "Order", targetId: order.id, action: "order.status_change" },
      });
      expect(statusChangeAuditCount).toBe(1);
    });

    it("PENDING -> ON_HOLD YASAKTIR (409) — §3.4", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "ON_HOLD" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("PAID -> CANCELLED DOĞRUDAN AÇILMAZ (409) — önce Askıya Al gerekir (§3.5)", async () => {
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "CANCELLED", cancellationReason: "x", sendCustomerEmail: false, confirmWithoutRefund: true },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("hedef-durum RBAC daraltması (§3.2)", () => {
    it("MANAGER, ON_HOLD/PAID/CANCELLED hedeflerine geçiremez (403) — SHIPPED/FULFILLED'a geçirebilir", async () => {
      const orderForHold = await createOrder("PAID");
      const holdRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${orderForHold.id}/status`,
        headers: authHeader(managerToken),
        payload: { status: "ON_HOLD" },
      });
      expect(holdRes.statusCode).toBe(403);

      const orderForCancel = await createOrder("PENDING");
      const cancelRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${orderForCancel.id}/status`,
        headers: authHeader(managerToken),
        payload: { status: "CANCELLED", cancellationReason: "x" },
      });
      expect(cancelRes.statusCode).toBe(403);

      const orderForConfirm = await createOrder("ON_HOLD");
      const confirmRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${orderForConfirm.id}/status`,
        headers: authHeader(managerToken),
        payload: { status: "PAID" },
      });
      expect(confirmRes.statusCode).toBe(403);

      const orderForShip = await createOrder("PAID");
      const shipRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${orderForShip.id}/status`,
        headers: authHeader(managerToken),
        payload: { status: "SHIPPED", trackingNumber: "TRK-1" },
      });
      expect(shipRes.statusCode).toBe(200);
    });

    it("MANAGER'ın reddedilen hedef-durum denemesi sipariş aktivite akışında FORBIDDEN olarak görünür (targetId taşır)", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(managerToken),
        payload: { status: "CANCELLED", cancellationReason: "x" },
      });
      expect(res.statusCode).toBe(403);

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      expect(activityRes.statusCode).toBe(200);
      const forbiddenEntry = activityRes
        .json()
        .data.find((e: { action: string; status: string }) => e.action === "order.status_change" && e.status === "FORBIDDEN");
      expect(forbiddenEntry).toBeDefined();
      expect(forbiddenEntry.metadata).toMatchObject({ from: "PENDING", to: "CANCELLED" });
    });
  });

  describe("status=CANCELLED gövde doğrulaması (§5.2)", () => {
    it("cancellationReason eksikse 422", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "CANCELLED" },
      });
      expect(res.statusCode).toBe(422);
    });

    it("status !== CANCELLED iken cancellationReason/sendCustomerEmail/confirmWithoutRefund gönderilirse 422", async () => {
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "SHIPPED", trackingNumber: "TRK-1", cancellationReason: "x" },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("iptal e-postası tetikleyicisi (§6.2)", () => {
    it("sendCustomerEmail varsayılan true iken order.cancel_email SUCCESS audit kaydı oluşur, sendMail çağrılır", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "CANCELLED", cancellationReason: "Müşteri talebi" },
      });
      expect(res.statusCode).toBe(200);
      expect(sendMailMock).toHaveBeenCalledTimes(1);

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      const emailEntry = activityRes
        .json()
        .data.find((e: { action: string }) => e.action === "order.cancel_email");
      expect(emailEntry).toBeDefined();
      expect(emailEntry.status).toBe("SUCCESS");
      expect(emailEntry.metadata).toMatchObject({ emailDelivered: true });

      const statusChangeEntry = activityRes
        .json()
        .data.find((e: { action: string }) => e.action === "order.status_change");
      expect(statusChangeEntry.metadata).toMatchObject({ customerEmailRequested: true, cancellationReason: "Müşteri talebi" });
    });

    it("sendCustomerEmail: false iken e-posta HİÇ denenmez ve order.cancel_email kaydı OLUŞMAZ", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "CANCELLED", cancellationReason: "Müşteri talebi", sendCustomerEmail: false },
      });
      expect(res.statusCode).toBe(200);
      expect(sendMailMock).not.toHaveBeenCalled();

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      const emailEntry = activityRes
        .json()
        .data.find((e: { action: string }) => e.action === "order.cancel_email");
      expect(emailEntry).toBeUndefined();
    });

    it("e-posta gönderimi başarısız olsa bile PATCH .../status 200 döner (best-effort)", async () => {
      sendMailMock.mockImplementationOnce(async () => {
        throw new Error("SMTP bağlantısı başarısız");
      });
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "CANCELLED", cancellationReason: "Müşteri talebi" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("CANCELLED");
    });
  });

  describe("kargo bildirim e-postası tetikleyicisi (§2.4B)", () => {
    it("SHIPPED + trackingNumber → sendMail çağrılır, order.shipped_email SUCCESS audit kaydı oluşur", async () => {
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "SHIPPED", trackingNumber: "TRK-SHIPPED-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(sendMailMock).toHaveBeenCalledTimes(1);

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      const emailEntry = activityRes.json().data.find((e: { action: string }) => e.action === "order.shipped_email");
      expect(emailEntry).toBeDefined();
      expect(emailEntry.status).toBe("SUCCESS");
      expect(emailEntry.metadata).toMatchObject({ emailDelivered: true });

      const statusChangeEntry = activityRes.json().data.find((e: { action: string }) => e.action === "order.status_change");
      expect(statusChangeEntry.metadata).toMatchObject({ customerEmailRequested: true });
    });

    it("sendCustomerEmail: false iken SHIPPED geçişinde e-posta HİÇ denenmez ve order.shipped_email kaydı OLUŞMAZ", async () => {
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "SHIPPED", trackingNumber: "TRK-SHIPPED-2", sendCustomerEmail: false },
      });
      expect(res.statusCode).toBe(200);
      expect(sendMailMock).not.toHaveBeenCalled();

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      const emailEntry = activityRes.json().data.find((e: { action: string }) => e.action === "order.shipped_email");
      expect(emailEntry).toBeUndefined();
    });

    it("e-posta gönderimi başarısız olsa bile PATCH .../status 200 döner ve FAILURE audit kaydı yazılır (best-effort)", async () => {
      sendMailMock.mockImplementationOnce(async () => {
        throw new Error("SMTP bağlantısı başarısız");
      });
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "SHIPPED", trackingNumber: "TRK-SHIPPED-3" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("SHIPPED");

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      const emailEntry = activityRes.json().data.find((e: { action: string }) => e.action === "order.shipped_email");
      expect(emailEntry.status).toBe("FAILURE");
      expect(emailEntry.metadata).toMatchObject({ emailDelivered: false });
    });

    it("sendCustomerEmail, status=FULFILLED ile gönderilirse 422 döner", async () => {
      const order = await createOrder("SHIPPED");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "FULFILLED", sendCustomerEmail: true },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("PATCH /admin/orders/:orderId — düzenleme paneli (§5.3)", () => {
    it("ADMIN müşteri iletişim/adres bilgisini günceller, adminNotes'u yazar, aktivite akışında order.update görünür", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
        payload: {
          customerName: "Yeni İsim",
          adminNotes: "Müşteri telefon ile aradı.",
          shippingAddress: {
            fullName: "Yeni İsim",
            phone: "+905551234567",
            country: "TR",
            city: "İstanbul",
            district: "Kadıköy",
            addressLine1: "Örnek Mahallesi No:1",
            postalCode: "34710",
          },
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.customerName).toBe("Yeni İsim");
      expect(res.json().data.adminNotes).toBe("Müşteri telefon ile aradı.");
      expect(res.json().data.shippingAddress).toMatchObject({ city: "İstanbul", district: "Kadıköy" });

      const activityRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      const updateEntry = activityRes.json().data.find((e: { action: string }) => e.action === "order.update");
      expect(updateEntry).toBeDefined();
      expect(updateEntry.metadata.fields).toEqual(expect.arrayContaining(["customerName", "adminNotes", "shippingAddress"]));
    });

    it("hiçbir alan gönderilmezse 422", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
        payload: {},
      });
      expect(res.statusCode).toBe(422);
    });

    it("MANAGER PATCH /:orderId çağıramaz (403)", async () => {
      const order = await createOrder("PENDING");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(managerToken),
        payload: { adminNotes: "deneme" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("SHIPPED/kapanmış siparişte iletişim/adres alanı değiştirilemez (409), adminNotes hâlâ düzenlenebilir", async () => {
      const order = await createOrder("SHIPPED");
      const blockedRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
        payload: { customerName: "Yeni İsim" },
      });
      expect(blockedRes.statusCode).toBe(409);

      const notesRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
        payload: { adminNotes: "Yalnızca not güncellemesi" },
      });
      expect(notesRes.statusCode).toBe(200);
      expect(notesRes.json().data.adminNotes).toBe("Yalnızca not güncellemesi");
    });
  });

  describe("GET /admin/orders/:orderId/activity (§5.4)", () => {
    it("ipAddress alanı yanıt gövdesinde HİÇ bulunmaz", async () => {
      const order = await createOrder("PAID");
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/orders/${order.id}/status`,
        headers: authHeader(adminToken),
        payload: { status: "SHIPPED", trackingNumber: "TRK-ACT-1" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(200);
      const raw = res.payload;
      expect(raw.includes("ipAddress")).toBe(false);
    });

    it("var olmayan sipariş için 404 döner", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${crypto.randomUUID()}/activity`,
        headers: authHeader(adminToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("MANAGER aktivite akışını okuyabilir (salt okunur, ADMIN+MANAGER)", async () => {
      const order = await createOrder("PAID");
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}/activity`,
        headers: authHeader(managerToken),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("§3.7 kritik regresyon — adminNotes/cancellationReason müşteri yüzeyine SIZMAZ", () => {
    it("GET /users/me/orders ve /users/me/orders/:orderId adminNotes/cancellationReason TAŞIMAZ", async () => {
      const customer = await registerTestUser(app, { email: "orders-customer-leak-check@example.com" });
      const order = await createOrder("CANCELLED", undefined, { siteUserId: customer.userId });
      await app.prisma.order.update({
        where: { id: order.id },
        data: { adminNotes: "GİZLİ dahili not", cancellationReason: "Stok tükendi" },
      });

      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/users/me/orders",
        headers: authHeader(customer.accessToken),
      });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.payload.includes("adminNotes")).toBe(false);
      expect(listRes.payload.includes("cancellationReason")).toBe(false);
      expect(listRes.payload.includes("GİZLİ dahili not")).toBe(false);

      const detailRes = await app.inject({
        method: "GET",
        url: `/api/v1/users/me/orders/${order.id}`,
        headers: authHeader(customer.accessToken),
      });
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.payload.includes("adminNotes")).toBe(false);
      expect(detailRes.payload.includes("cancellationReason")).toBe(false);
      expect(detailRes.payload.includes("GİZLİ dahili not")).toBe(false);

      // Admin uçları AYNI siparişte bu alanları GÖRMEYE devam eder (default-deny yalnızca
      // müşteri yüzeyi içindir).
      const adminRes = await app.inject({
        method: "GET",
        url: `/api/v1/admin/orders/${order.id}`,
        headers: authHeader(adminToken),
      });
      expect(adminRes.json().data.adminNotes).toBe("GİZLİ dahili not");
      expect(adminRes.json().data.cancellationReason).toBe("Stok tükendi");
    });
  });
});
