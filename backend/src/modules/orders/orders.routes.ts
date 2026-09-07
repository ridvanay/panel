import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { OrderStatus } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { stripe } from "../../lib/stripe";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { AdminOrderSchema, OrderActivityEntrySchema } from "../../schemas/entities";
import { toAdminOrderDto, toOrderActivityEntryDto } from "../../mappers";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { maskEmail, maskNationalId } from "../../lib/pii-mask";
import { logAudit } from "../../lib/audit";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { buildWebhookOrderPayload } from "../../lib/webhook-order-payload";
import { sendTemplateEmail } from "../email-templates/email-templates.service";
import {
  ListOrdersQuerySchema,
  OrderIdParamSchema,
  RefundOrderRequestSchema,
  UpdateOrderRequestSchema,
  UpdateOrderStatusRequestSchema,
} from "./orders.schemas";

/**
 * Manuel iade ile hedeflenebilecek kaynak durumlar — bkz. orders.routes.ts::server.post("/:orderId/refund").
 * `.claude/architect-scope-customer-portal.md` §6 — `SHIPPED` eklendi (kargoya verilmiş ama
 * henüz teslim edilmemiş bir sipariş de iade edilebilmelidir).
 * `.claude/architect-scope-order-management-pro.md` §3.5/§4.1 — `ON_HOLD` EKLENDİ: askıya
 * alınmış bir sipariş için doğru kapanış yolu iadedir ve doğrudan erişilebilir olmalıdır.
 */
const REFUNDABLE_STATUSES: OrderStatus[] = ["PAID", "SHIPPED", "FULFILLED", "ON_HOLD"];

const WITH_ITEMS = { items: true } as const;

/**
 * `.claude/architect-scope-order-management-pro.md` §4.1 (bağlayıcı, ÖNCEKİ tabloyu REVİZE eder)
 * — geçiş tablosu: `PENDING -> CANCELLED`, `PAID -> ON_HOLD|SHIPPED|FULFILLED`,
 * `ON_HOLD -> PAID|CANCELLED`, `SHIPPED -> FULFILLED`. Listede OLMAYAN bir kaynak durum
 * (ör. `FAILED`/`EXPIRED`/`REFUNDED`) hiçbir hedefe İZİN VERMEZ — bu uçtan DEĞİŞTİRİLEMEZ.
 * `PAID -> CANCELLED` BİLİNÇLİ OLARAK AÇILMAZ (§3.5) — ödenmiş bir siparişi iptal etmek için
 * admin önce Askıya Al, sonra İptal Et adımlarını izler.
 */
const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ["CANCELLED"],
  PAID: ["ON_HOLD", "SHIPPED", "FULFILLED"],
  ON_HOLD: ["PAID", "CANCELLED"],
  SHIPPED: ["FULFILLED"],
};

/**
 * `.claude/architect-scope-order-management-pro.md` §3.2/§5.2 — hedef durum bazlı RBAC
 * daraltması. Bu hedeflere geçiş İSTİSNAİDİR/geri alınamaz (para/stok mutabakatını etkiler,
 * müşteriye e-posta tetikler) → YALNIZCA ADMIN. Diğer hedefler (SHIPPED/FULFILLED) günlük
 * operasyondur → ADMIN + MANAGER (router seviyesindeki hook zaten bunu sağlıyor).
 */
const ADMIN_ONLY_TARGETS: OrderStatus[] = ["ON_HOLD", "PAID", "CANCELLED"];

const EDITABLE_CONTACT_STATUSES: OrderStatus[] = ["PENDING", "PAID", "ON_HOLD"];

const ORDER_ACTIVITY_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

/** `total_formatted` e-posta değişkeni için basit "123.45 TRY" biçimi — `stripe.routes.ts::formatMoney` ile AYNI. */
function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

/**
 * `/admin/orders` prefix'i altında bağlanır (bkz. app.ts).
 * `.claude/architect-scope-order-management-pro.md` §3.2 (ÖNCEKİ `.claude/architect-scope-rbac-5-tier.md`
 * §5.3 satır 11'i REVİZE eder) — router hook'u ADMIN + MANAGER (panel kapısı) olarak KALIR;
 * istisnai/geri alınamaz eylemler (§3.2 tablosu) handler İÇİNDE veya route seviyesinde ADMIN'e
 * daraltılır.
 *
 * PII maskeleme kararı: `customerEmail` LİSTEDE (`GET /`) maskelenir (`lib/pii-mask.ts::maskEmail`,
 * `a***@domain.com`), DETAYDA (`GET /:orderId`) maskesiz döner. Gerekçe: liste ekranı toplu
 * göz atma/triage amaçlıdır (ör. ekran paylaşımı, çoklu sipariş taraması) ve tam e-posta ORADA
 * gerekli değildir; detay ekranı ise fiilen kargo/iletişim amacıyla AÇILIR ve admin'in müşteriyle
 * iletişime geçmesi (ör. teslimat sorunu) için tam adrese ihtiyacı vardır — maskeli bir adresle
 * bu iş akışı imkânsız hale gelir. Bu, mevcut RBAC hardening turundaki "liste maskeli, detay
 * açık" kararıyla AYNI yaklaşımdır.
 *
 * `.claude/architect-scope-checkout-redesign.md` §5.5 — `billing.nationalId` (TCKN) AYNI kararla
 * LİSTEDE `lib/pii-mask.ts::maskNationalId` (`123*****901`) ile maskelenir, DETAYDA maskesiz
 * döner (admin fatura kesmek için gerçek numaraya ihtiyaç duyar).
 *
 * `.claude/architect-scope-order-management-pro.md` §5.1/§3.7 — TÜM uçlar artık `AdminOrder`
 * (`toAdminOrderDto`) döner; `toOrderDto`/`OrderSchema` (müşteri yüzeyi) BURADA KULLANILMAZ.
 */
export async function ordersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/",
    {
      schema: {
        querystring: ListOrdersQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AdminOrderSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.order.findMany({
        where: { ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}), ...(status ? { status } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_ITEMS,
      });

      const dtos = rows.map((row) => {
        const dto = toAdminOrderDto(row);
        return {
          ...dto,
          customerEmail: maskEmail(row.customerEmail),
          billing: dto.billing && dto.billing.nationalId ? { ...dto.billing, nationalId: maskNationalId(dto.billing.nationalId) } : dto.billing,
        };
      });
      return reply.send(ok(dtos, buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/:orderId",
    { schema: { params: OrderIdParamSchema, response: { 200: ApiSuccessSchema(AdminOrderSchema) } } },
    async (request, reply) => {
      const order = await app.prisma.order.findUnique({ where: { id: request.params.orderId }, include: WITH_ITEMS });
      if (!order) throw new NotFoundError("Sipariş bulunamadı.");

      return reply.send(ok(toAdminOrderDto(order)));
    }
  );

  /**
   * `.claude/architect-scope-order-management-pro.md` §5.4 — sipariş bazlı aktivite günlüğü.
   * ADMIN + MANAGER (router hook'u zaten uyguluyor, ek preHandler GEREKMEZ). Cursor sayfalama
   * YOK — bir siparişin olay sayısı doğal olarak küçüktür (`take: 50`).
   */
  server.get(
    "/:orderId/activity",
    {
      config: { rateLimit: ORDER_ACTIVITY_RATE_LIMIT },
      schema: { params: OrderIdParamSchema, response: { 200: ApiSuccessSchema(z.array(OrderActivityEntrySchema)) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.order.findUnique({ where: { id: request.params.orderId }, select: { id: true } });
      if (!existing) throw new NotFoundError("Sipariş bulunamadı.");

      const rows = await app.prisma.auditLog.findMany({
        where: { targetType: "Order", targetId: existing.id, action: { startsWith: "order." } },
        orderBy: { seq: "desc" },
        take: 50,
      });

      return reply.send(ok(rows.map(toOrderActivityEntryDto)));
    }
  );

  server.patch(
    "/:orderId/status",
    {
      schema: {
        params: OrderIdParamSchema,
        body: UpdateOrderStatusRequestSchema,
        response: { 200: ApiSuccessSchema(AdminOrderSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.order.findUnique({ where: { id: request.params.orderId } });
      if (!existing) throw new NotFoundError("Sipariş bulunamadı.");

      const {
        status: targetStatus,
        trackingNumber,
        shippingCarrier,
        cancellationReason,
        sendCustomerEmail,
        confirmWithoutRefund,
      } = request.body;

      // §3.2/§5.2 adım 2 — hedef durum İSTİSNAİ listesindeyse ve aktör ADMIN DEĞİLSE, reddedilen
      // deneme sipariş aktivite akışında da GÖRÜNSÜN diye `targetId` TAŞIYAN AYRI bir FORBIDDEN
      // kaydı yazılır (`requireSiteRole`'ün kendi FORBIDDEN kaydı `targetId` taşımaz).
      if (ADMIN_ONLY_TARGETS.includes(targetStatus) && request.user!.role !== "ADMIN") {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "order.status_change",
          status: "FORBIDDEN",
          targetType: "Order",
          targetId: existing.id,
          metadata: { from: existing.status, to: targetStatus },
          ipAddress: request.ip,
        });
        throw new ForbiddenError("Bu durum değişikliği için ADMIN yetkisi gerekir.");
      }

      if (!(ALLOWED_TRANSITIONS[existing.status] ?? []).includes(targetStatus)) {
        throw new ConflictError(`"${existing.status}" durumundaki bir sipariş "${targetStatus}" durumuna geçirilemez.`);
      }

      // §3.5/§5.2 adım 4 — ödenmiş bir sipariş, para geri ödenmeden terminal `CANCELLED`
      // durumuna geçirilemez; istemci bilerek `confirmWithoutRefund: true` göndermelidir.
      if (targetStatus === "CANCELLED" && existing.paidAt != null && confirmWithoutRefund !== true) {
        throw new ConflictError(
          "Bu siparişin ödemesi alınmış. İptal etmek parayı OTOMATİK İADE ETMEZ — önce 'İade Et' ile Stripe iadesi yapın (durum REFUNDED olur) veya iadeyi kendiniz yürüteceğinizi onaylayın."
        );
      }

      // Çifte durum geçişi / race koruması: `POST /:orderId/refund`'daki AYNI atomik "claim"
      // deseni — `updateMany({ where: { id, status: existing.status } })`. Aynı siparişe
      // eşzamanlı gelen iki geçiş isteği (örn. ON_HOLD→PAID ve ON_HOLD→CANCELLED) aynı
      // `existing.status` görüntüsüyle geçiş kontrolünü geçse bile yalnızca BİRİ bu koşullu
      // `UPDATE`'i "kazanır"; diğeri `claim.count === 0` ile 409 alır ve hiçbir yan etkiye
      // (audit log, webhook, iptal e-postası) yol açmaz.
      const claim = await app.prisma.order.updateMany({
        where: { id: existing.id, status: existing.status },
        data: {
          status: targetStatus,
          ...(trackingNumber !== undefined ? { trackingNumber } : {}),
          ...(shippingCarrier !== undefined ? { shippingCarrier } : {}),
          // `paidAt` ile AYNI desen — ilgili duruma İLK geçişte doldurulur, tekrar geçilse
          // (teorik olarak bu route'tan mümkün değil ama savunmacı) ÜZERİNE YAZILMAZ.
          ...(targetStatus === "SHIPPED" && !existing.shippedAt ? { shippedAt: new Date() } : {}),
          ...(targetStatus === "FULFILLED" && !existing.deliveredAt ? { deliveredAt: new Date() } : {}),
          // §4.2/§5.2 adım 5 — `paidAt` HİÇBİR KOŞULDA burada yazılmaz/silinmez (§3.4).
          ...(targetStatus === "CANCELLED" ? { cancellationReason } : {}),
        },
      });
      if (claim.count === 0) {
        throw new ConflictError(`"${existing.status}" durumundaki bir sipariş "${targetStatus}" durumuna geçirilemez.`);
      }

      const order = (await app.prisma.order.findUnique({ where: { id: existing.id }, include: WITH_ITEMS }))!;

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "order.status_change",
        targetType: "Order",
        targetId: order.id,
        metadata: {
          from: existing.status,
          to: targetStatus,
          ...(targetStatus === "CANCELLED"
            ? { cancellationReason, customerEmailRequested: sendCustomerEmail ?? true }
            : {}),
        },
        ipAddress: request.ip,
      });

      // §10.13.8 — `ORDER_STATUS_CHANGED`, durum güncellemesi commit'inden SONRA tetiklenir.
      await emitWebhookEvent(app, "ORDER_STATUS_CHANGED", await buildWebhookOrderPayload(app, order, existing.status));

      // §6.2 (notification-agent sözleşmesi, TAM OLARAK bu sırayla) — DB commit + webhook
      // emisyonundan SONRA, best-effort iptal e-postası. Hata API'yi ASLA kırmaz.
      if (targetStatus === "CANCELLED" && sendCustomerEmail !== false) {
        let delivered = false;
        try {
          await sendTemplateEmail(app, "ORDER_CANCELLATION", order.customerEmail, {
            order_number: order.orderNumber,
            customer_name: order.customerName ?? order.customerEmail,
            items_summary: order.items
              .map((item) => `${item.productTitle}${item.variantLabel ? ` (${item.variantLabel})` : ""} x${item.quantity}`)
              .join(", "),
            total_formatted: formatMoney(order.totalCents, order.currency),
            cancellation_reason: cancellationReason!,
          });
          delivered = true;
        } catch (err) {
          app.log.error({ err, orderId: order.id }, "Sipariş iptal e-postası gönderilemedi");
        }
        // Alıcı adresi metadata'ya YAZILMAZ (KVKK minimizasyonu) — `targetId` zaten alıcıyı
        // siparişten türetilebilir kılar. `sendCustomerEmail: false` iken bu blok HİÇ çalışmaz,
        // dolayısıyla bu kayıt da OLUŞMAZ (§6.2 bağlayıcı kural).
        await logAudit(app, {
          action: "order.cancel_email",
          status: delivered ? "SUCCESS" : "FAILURE",
          targetType: "Order",
          targetId: order.id,
          metadata: { emailDelivered: delivered },
        });
      }

      return reply.send(ok(toAdminOrderDto(order)));
    }
  );

  /**
   * `.claude/architect-scope-order-management-pro.md` §5.3 — YENİ, yalnızca ADMIN. Müşteri
   * iletişim + teslimat/fatura adresi + `adminNotes` düzenleme ucu. Router seviyesindeki
   * ADMIN+MANAGER hook'una EK OLARAK route seviyesinde ADMIN şartı uygulanır (`appearance.routes.ts`
   * ile AYNI desen).
   */
  server.patch(
    "/:orderId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        params: OrderIdParamSchema,
        body: UpdateOrderRequestSchema,
        response: { 200: ApiSuccessSchema(AdminOrderSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.order.findUnique({ where: { id: request.params.orderId } });
      if (!existing) throw new NotFoundError("Sipariş bulunamadı.");

      const { customerEmail, customerName, shippingAddress, billing, adminNotes } = request.body;

      const touchesContactFields =
        customerEmail !== undefined || customerName !== undefined || shippingAddress !== undefined || billing !== undefined;
      if (touchesContactFields && !EDITABLE_CONTACT_STATUSES.includes(existing.status)) {
        throw new ConflictError("Kargoya verilmiş veya kapanmış bir siparişin iletişim/adres bilgisi değiştirilemez.");
      }

      const changedFields: string[] = [];
      if (customerEmail !== undefined) changedFields.push("customerEmail");
      if (customerName !== undefined) changedFields.push("customerName");
      if (shippingAddress !== undefined) changedFields.push("shippingAddress");
      if (billing !== undefined) changedFields.push("billing");
      if (adminNotes !== undefined) changedFields.push("adminNotes");

      const order = await app.prisma.order.update({
        where: { id: existing.id },
        data: {
          ...(customerEmail !== undefined ? { customerEmail } : {}),
          ...(customerName !== undefined ? { customerName } : {}),
          ...(shippingAddress !== undefined
            ? {
                shippingAddressFullName: shippingAddress.fullName,
                shippingAddressPhone: shippingAddress.phone,
                shippingAddressCountry: shippingAddress.country,
                shippingAddressCity: shippingAddress.city,
                shippingAddressDistrict: shippingAddress.district,
                shippingAddressNeighborhood: shippingAddress.neighborhood ?? null,
                shippingAddressLine1: shippingAddress.addressLine1,
                shippingAddressLine2: shippingAddress.addressLine2 ?? null,
                shippingAddressPostalCode: shippingAddress.postalCode ?? null,
              }
            : {}),
          ...(billing !== undefined
            ? {
                billingType: billing.billingType,
                billingCompanyName: billing.companyName ?? null,
                billingTaxOffice: billing.taxOffice ?? null,
                billingTaxNumber: billing.taxNumber ?? null,
                billingNationalId: billing.nationalId ?? null,
                billingAddressFullName: billing.address.fullName,
                billingAddressPhone: billing.address.phone,
                billingAddressCountry: billing.address.country,
                billingAddressCity: billing.address.city,
                billingAddressDistrict: billing.address.district,
                billingAddressNeighborhood: billing.address.neighborhood ?? null,
                billingAddressLine1: billing.address.addressLine1,
                billingAddressLine2: billing.address.addressLine2 ?? null,
                billingAddressPostalCode: billing.address.postalCode ?? null,
              }
            : {}),
          ...(adminNotes !== undefined ? { adminNotes } : {}),
        },
        include: WITH_ITEMS,
      });

      // §5.3 — YALNIZCA değişen alan ADLARI; eski/yeni değerler (adres, e-posta, TCKN) audit
      // metadata'sına ASLA yazılmaz (KVKK veri minimizasyonu). `ORDER_STATUS_CHANGED` YAYILMAZ.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "order.update",
        targetType: "Order",
        targetId: order.id,
        metadata: { fields: changedFields },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminOrderDto(order)));
    }
  );

  /**
   * Manuel iade — ADMIN + MANAGER (router seviyesindeki `requireSiteRole(...ROLES_ADMIN_MANAGER)`
   * hook'u zaten uygulanıyor). Gerçek parayı Stripe üzerinden GERİ ÖDER (`stripe.refunds.create`,
   * `Order.stripePaymentIntentId` üzerinden) — yalnızca DB durumunu değiştirip parayı olduğu
   * gibi bırakan "sahte" bir iade DEĞİLDİR.
   *
   * Çifte iade / race koruması: durum geçişi `updateMany({ where: { status: { in: PAID|FULFILLED } } })`
   * ile ATOMİK "claim" edilir (bkz. `Postgres.README` yok — standart satır kilidi semantiği: aynı
   * satıra eşzamanlı gelen ikinci `UPDATE`, birincinin commit'ini bekler ve `WHERE`'i YENİDEN
   * değerlendirir). Bu sayede iki eşzamanlı `POST /refund` isteğinden yalnızca BİRİ Stripe'a gerçek
   * iade isteği gönderebilir — diğeri `claim.count === 0` ile 409 alır ve Stripe'a HİÇ gitmez.
   * (Faz 2b'deki `runSerializable` — bkz. lib/serializable-tx.ts — burada gerekli DEĞİL: o, birden
   * çok tabloyu/satırı kapsayan çok adımlı okuma+yazmalar için; burada tek satırlık koşullu UPDATE
   * yeterli ve dış bir ağ çağrısını [Stripe] bir DB transaction'ı içinde tutmaktan kaçınır.)
   *
   * Ayrıca `stripe.refunds.create`'e siparişe göre DETERMİNİSTİK bir `idempotencyKey` verilir —
   * ağ hatası/timeout sonrası bir retry (istemci ya da Stripe SDK'sının kendi iç retry mekanizması)
   * AYNI Stripe iade kaydını döner, ikinci bir gerçek para hareketi TETİKLEMEZ.
   */
  server.post(
    "/:orderId/refund",
    {
      schema: {
        params: OrderIdParamSchema,
        body: RefundOrderRequestSchema,
        response: { 200: ApiSuccessSchema(AdminOrderSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.order.findUnique({ where: { id: request.params.orderId } });
      if (!existing) throw new NotFoundError("Sipariş bulunamadı.");

      if (!REFUNDABLE_STATUSES.includes(existing.status)) {
        throw new ConflictError(`"${existing.status}" durumundaki bir sipariş iade edilemez.`);
      }
      if (!existing.stripePaymentIntentId) {
        throw new ConflictError("Sipariş için bir Stripe ödeme kaydı bulunamadı, iade edilemez.");
      }

      const claim = await app.prisma.order.updateMany({
        where: { id: existing.id, status: { in: REFUNDABLE_STATUSES } },
        data: { status: "REFUNDED" },
      });
      if (claim.count === 0) {
        throw new ConflictError("Sipariş durumu değişti, iade edilemedi. Lütfen sayfayı yenileyip tekrar deneyin.");
      }

      let refund: Stripe.Refund;
      try {
        refund = await stripe.refunds.create(
          { payment_intent: existing.stripePaymentIntentId, reason: "requested_by_customer" },
          { idempotencyKey: `order-refund-${existing.id}` }
        );
      } catch (err) {
        // Stripe isteği başarısız oldu — claim'i GERİ AL, sipariş yeniden iade edilebilir kalsın.
        await app.prisma.order.update({ where: { id: existing.id }, data: { status: existing.status } });
        const message = err instanceof Stripe.errors.StripeError ? err.message : "Stripe iade isteği başarısız oldu.";
        throw new ConflictError(`İade işlemi Stripe tarafından reddedildi: ${message}`);
      }

      const { reason } = request.body;
      const order = await app.prisma.order.findUnique({ where: { id: existing.id }, include: WITH_ITEMS });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "order.refund",
        targetType: "Order",
        targetId: existing.id,
        metadata: { from: existing.status, to: "REFUNDED", reason: reason ?? null, stripeRefundId: refund.id },
        ipAddress: request.ip,
      });

      // §10.13.8 — iade de bir `ORDER_STATUS_CHANGED`dir (orders.routes.ts status PATCH ile AYNI olay).
      await emitWebhookEvent(app, "ORDER_STATUS_CHANGED", await buildWebhookOrderPayload(app, order!, existing.status));

      return reply.send(ok(toAdminOrderDto(order!)));
    }
  );
}
