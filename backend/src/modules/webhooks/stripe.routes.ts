import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import type { Order, OrderItem, SubscriptionStatus } from "@prisma/client";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";
import { runSerializable } from "../../lib/serializable-tx";
import { sendTemplateEmail } from "../email-templates/email-templates.service";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { buildWebhookOrderPayload } from "../../lib/webhook-order-payload";

function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

function mapStripeSubscriptionFields(sub: Stripe.Subscription) {
  return {
    status: mapStatus(sub.status),
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    stripeCustomerId: sub.customer as string,
  };
}

async function upsertSubscription(
  app: FastifyInstance,
  organizationId: string,
  planId: string | undefined,
  stripeSubscription: Stripe.Subscription
) {
  const existing = await app.prisma.subscription.findUnique({ where: { organizationId } });
  const resolvedPlanId = planId ?? existing?.planId;
  // Plan bilinmiyorsa (metadata eksik ve daha önce hiç kayıt yoksa) güvenli şekilde atla.
  if (!resolvedPlanId) return;

  await app.prisma.subscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: resolvedPlanId,
      stripeSubscriptionId: stripeSubscription.id,
      ...mapStripeSubscriptionFields(stripeSubscription),
    },
    update: {
      planId: resolvedPlanId,
      stripeSubscriptionId: stripeSubscription.id,
      ...mapStripeSubscriptionFields(stripeSubscription),
    },
  });
}

/**
 * §10.9.3 Sepet + Stripe Checkout — `checkout.session.completed` artık İKİ farklı akıştan
 * gelebilir (aynı Stripe hesabı hem org abonelikleri hem misafir ürün siparişleri için
 * kullanılıyor): `session.mode === "subscription"` ise bu, `billing.service.ts::
 * createCheckoutSession`'ın ürettiği MEVCUT akıştır — davranışı BİREBİR korunur (aşağıdaki
 * `organizationId`/`session.subscription` guard'ı öncekiyle AYNI). `session.mode === "payment"`
 * ise checkout.routes.ts'in ürettiği YENİ sepet siparişi akışıdır.
 */
async function handleCheckoutCompleted(app: FastifyInstance, session: Stripe.Checkout.Session) {
  if (session.mode === "payment") {
    await handleOrderPaid(app, session);
    return;
  }

  // Mevcut abonelik akışı — DOKUNULMADI.
  const organizationId = session.metadata?.organizationId;
  const planId = session.metadata?.planId;
  if (!organizationId || !session.subscription) return;

  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  await upsertSubscription(app, organizationId, planId, stripeSubscription);
}

/** `total_formatted` e-posta değişkeni için basit "123.45 TRY" biçimi. */
function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

type OrderWithItems = Order & { items: OrderItem[] };

/**
 * §10.9.3 — `checkout.session.completed` (mode:"payment") işleyicisi. `session.metadata.orderId`
 * ile `Order` bulunur; stok kontrolü + düşürme + `Order.status` güncellemesi TEK Serializable
 * transaction'da (bkz. lib/serializable-tx.ts::runSerializable) ATOMIK yapılır:
 *
 * - `order.status !== "PENDING"` ise idempotency: Stripe aynı event'i birden fazla gönderebilir
 *   (ayrıca `Order.stripeCheckoutSessionId @unique` ikinci savunma hattıdır) — sessizce döner,
 *   stok TEKRAR düşürülmez, e-posta TEKRAR gönderilmez.
 * - Her `OrderItem` için `Product.stockQuantity` transaction İÇİNDE okunur; yetersizse
 *   `Order.status = "FAILED"`, `errorSummary: "insufficient_stock"` yazılır ve transaction
 *   BAŞARIYLA biter (throw EDİLMEZ — para zaten Stripe üzerinden alınmış, bu bir hata değil bir
 *   iş akışı sonucudur; admin panelden manuel iade için `FAILED` durumunda düşer).
 * - Yeterliyse `Product.stockQuantity` düşürülür + `Order.status = "PAID"`, `paidAt = now()`.
 *
 * Serializable izolasyon + retry (P2034), aynı ürünün son adedine yarışan iki eşzamanlı
 * webhook çağrısında bir siparişin PAID, diğerinin (retry sonrası taze stok okumasıyla)
 * FAILED olmasını garanti eder — bkz. tests/integration/webhook-order.test.ts eşzamanlılık testi.
 */
async function handleOrderPaid(app: FastifyInstance, session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.orderId;
  if (!orderId) return;

  const outcome = await runSerializable(app, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return { order: null as OrderWithItems | null, justPaid: false };
    if (order.status !== "PENDING") return { order, justPaid: false };

    let insufficientProductTitle: string | null = null;
    for (const item of order.items) {
      if (!item.productId) continue;
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product || product.stockQuantity < item.quantity) {
        insufficientProductTitle = item.productTitle;
        break;
      }
    }

    if (insufficientProductTitle) {
      const failed = await tx.order.update({
        where: { id: order.id },
        data: { status: "FAILED", errorSummary: "insufficient_stock" },
        include: { items: true },
      });
      return { order: failed, justPaid: false };
    }

    for (const item of order.items) {
      if (!item.productId) continue;
      await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { decrement: item.quantity } } });
    }

    const paid = await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: new Date() },
      include: { items: true },
    });
    return { order: paid, justPaid: true };
  });

  if (!outcome.justPaid || !outcome.order) return;

  // Transaction SONRASI, best-effort: e-posta gönderimi asıl webhook isteğini BOZMAZ (mevcut
  // admin-users.routes.ts::sendPasswordResetEmail catch paterniyle AYNI yaklaşım).
  const order = outcome.order;

  // §10.13.8 — `ORDER_PAID`, sipariş `PAID`'e geçtikten SONRA (§10.13's giden webhook sistemi;
  // Stripe'ın BİZE gönderdiği GELEN webhook'la KARIŞTIRILMAMALI).
  await emitWebhookEvent(app, "ORDER_PAID", await buildWebhookOrderPayload(app, order));
  try {
    await sendTemplateEmail(app, "ORDER_CONFIRMATION", order.customerEmail, {
      order_number: order.orderNumber,
      customer_name: order.customerName ?? order.customerEmail,
      items_summary: order.items.map((item) => `${item.productTitle} x${item.quantity}`).join(", "),
      total_formatted: formatMoney(order.totalCents, order.currency),
    });
  } catch (err) {
    app.log.error({ err, orderId: order.id }, "Sipariş onay e-postası gönderilemedi");
  }
}

/**
 * §10.9.3 — `checkout.session.expired` işleyicisi. Sepet siparişi ödeme tamamlanmadan Stripe
 * Checkout oturumu süresi dolarsa (varsayılan 24 saat) tetiklenir. Yalnızca hâlâ `PENDING`
 * durumdaki siparişi `EXPIRED` yapar — `updateMany` ile TEK atomik ifade (idempotent: sipariş
 * zaten `PAID`/`FAILED` vb. ise `where` filtresi sayesinde no-op, ekstra `findUnique` GEREKMEZ).
 */
async function handleOrderExpired(app: FastifyInstance, session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.orderId;
  if (!orderId) return;

  await app.prisma.order.updateMany({
    where: { id: orderId, status: "PENDING" },
    data: { status: "EXPIRED" },
  });
}

async function handleSubscriptionChanged(app: FastifyInstance, stripeSubscription: Stripe.Subscription) {
  const organizationId = stripeSubscription.metadata?.organizationId;
  const planId = stripeSubscription.metadata?.planId;

  if (organizationId) {
    await upsertSubscription(app, organizationId, planId, stripeSubscription);
    return;
  }

  // metadata taşınmadıysa (ör. portal üzerinden yapılan değişiklik) mevcut kayıtla eşle.
  const existing = await app.prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  });
  if (!existing) return;

  await app.prisma.subscription.update({
    where: { id: existing.id },
    data: mapStripeSubscriptionFields(stripeSubscription),
  });
}

/** `/webhooks/stripe` altında bağlanır. İmza doğrulaması ham (parse edilmemiş) body gerektirir. */
export default async function stripeWebhookRoutes(app: FastifyInstance) {
  // Bu Fastify encapsulation context'ine özel content-type parser: yalnızca bu route'u etkiler,
  // uygulamanın geri kalanındaki JSON body parse'ını bozmaz.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.post("/", async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (!signature || typeof signature !== "string" || !env.STRIPE_WEBHOOK_SECRET) {
      return reply.code(400).send({ error: "invalid signature" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      request.log.warn({ err }, "Stripe webhook imza doğrulaması başarısız.");
      return reply.code(400).send({ error: "invalid signature" });
    }

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(app, event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
        await handleOrderExpired(app, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(app, event.data.object as Stripe.Subscription);
        break;
      default:
        request.log.debug({ type: event.type }, "İşlenmeyen Stripe webhook olayı.");
    }

    return reply.code(200).send({ received: true });
  });
}
