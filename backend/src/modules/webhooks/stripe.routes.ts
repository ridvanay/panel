import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import type { Order, OrderItem, SubscriptionStatus } from "@prisma/client";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";
import { runSerializable } from "../../lib/serializable-tx";
import { sendTemplateEmail } from "../email-templates/email-templates.service";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { buildWebhookOrderPayload } from "../../lib/webhook-order-payload";
import { logAudit } from "../../lib/audit";
import { BookingNotPayableError } from "../../lib/errors";
import { confirmBookingPayment } from "../telehealth/lib/booking";
import { triggerAppointmentConfirmationEmail } from "../telehealth/lib/notifications";

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
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 KARAR G (bağlayıcı) —
 * `checkout.session.completed` (`mode: "payment"`, `metadata.bookingId` taşıyan) dalı.
 * integration-agent'ın TEK SAHASI — booking/randevu durum geçişinin İŞ MANTIĞI
 * `lib/booking.ts::confirmBookingPayment`'ta (backend-agent) YAŞAR; bu fonksiyon YALNIZCA
 * Stripe'a özgü kısmı (session okuma, idempotency ön-kontrolü, e-posta tetikleyicisi) taşır —
 * `handleOrderPaid` İLE AYNI iş bölümü.
 *
 * **İdempotency (§9.7.1 madde 4, bağlayıcı):** `confirmBookingPayment` booking ZATEN
 * `PENDING` DIŞINDA bir durumdaysa `BookingNotPayableError` (409) fırlatır — Stripe aynı
 * event'i tekrar gönderirse (retry/aynı event iki kez) bu burada YAKALANIR ve SESSİZCE
 * dönülür (webhook YİNE DE `200` döner, randevular İKİNCİ kez `SCHEDULED`'a geçmez, e-posta
 * İKİNCİ kez gönderilmez).
 *
 * **accessToken rotasyonu kararı (görev notu KRİTİK TASARIM NOTU, bkz.
 * `telehealth.checkout.routes.ts` yorumu):** `session.metadata.rawAccessToken` VARSA (misafir
 * `?t=` ile checkout-session açıldıysa) `knownRawAccessToken` olarak geçirilir — booking'in
 * `accessTokenHash`'i ROTATE EDİLMEZ, hastanın orijinal magic-link'i ödeme SONRASI da ÇALIŞIR.
 * YOKSA (oturumlu/Bearer akışı) `confirmBookingPayment` YENİ bir token üretir (rotate) — bu
 * hastanın erişimini KAYBETTİRMEZ, çünkü oturumlu hastanın zaten `/patient/bookings` üzerinden
 * kimlik-doğrulamalı erişimi vardır.
 */
async function handleTelehealthBookingPaid(app: FastifyInstance, session: Stripe.Checkout.Session): Promise<void> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const stripePaymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const knownRawAccessToken = session.metadata?.rawAccessToken || undefined;

  let result: Awaited<ReturnType<typeof confirmBookingPayment>>;
  try {
    result = await confirmBookingPayment(app, {
      bookingId,
      paidBy: "stripe",
      stripePaymentIntentId,
      knownRawAccessToken,
    });
  } catch (err) {
    if (err instanceof BookingNotPayableError) {
      // GÜVENLİK NOTU (security-agent, görev özeti madde 2) — `BookingNotPayableError` İKİ
      // FARKLI durumu KAPSAR: (a) booking ZATEN `PAID` (Stripe'ın aynı olayı ikinci kez
      // göndermesi — GERÇEK/ZARARSIZ idempotency, bkz. dosya üstü yorum) VEYA (b) booking
      // `EXPIRED`/`FAILED` durumuna düşmüş (hasta Stripe'ta ödemeyi TAMAMLADI ama internal hold
      // bu arada süresi doldu/süpürüldü — `telehealth.checkout.routes.ts`'teki senkronizasyon
      // düzeltmesi bunu BÜYÜK ÖLÇÜDE önler ama saat kayması/nadir yarış durumları TAMAMEN
      // dışlanamaz). (b) durumunda PARA ALINMIŞTIR ama randevu ASLA `SCHEDULED` OLMAZ — bu
      // SESSİZCE yutulursa kayıp bir ödeme fark edilmeden kalır (iade mekanizması bu turda
      // YOKTUR, §9.7.1 madde 8). Bu yüzden (a)/(b) ayrımı AÇIKÇA yapılır: (a) `app.log.info` ile
      // no-op, (b) `app.log.error` + `logAudit` ile OPERASYONEL MÜDAHALE gerektiren bir olay
      // olarak İZ BIRAKILIR (manuel iade/telafi ADMIN'in takdirindedir — bu fonksiyon bir iade
      // BAŞLATMAZ, yalnızca durumu GÖRÜNÜR kılar).
      const current = await app.prisma.appointmentBooking.findUnique({
        where: { id: bookingId },
        select: { paymentStatus: true },
      });

      if (current?.paymentStatus === "PAID") {
        app.log.info({ bookingId }, "Stripe webhook: booking zaten ödenmiş durumda (idempotent no-op).");
        return;
      }

      app.log.error(
        { bookingId, bookingPaymentStatus: current?.paymentStatus ?? "unknown" },
        "Stripe webhook: ödeme Stripe'ta tamamlandı ama booking artık ödenebilir durumda DEĞİL (muhtemelen süresi doldu/süpürüldü) — MANUEL İNCELEME GEREKİR (iade/telafi)."
      );
      await logAudit(app, {
        actorId: null,
        actorEmail: null,
        action: "telehealth.booking.paid_after_expiry",
        status: "FAILURE",
        targetType: "AppointmentBooking",
        targetId: bookingId,
        metadata: { bookingPaymentStatus: current?.paymentStatus ?? "unknown", stripePaymentIntentId },
      });
      return;
    }
    throw err;
  }

  // §9.7.8 (notification-agent'ın HOOK'u, integration-agent burada ÇAĞIRIR) — booking
  // ÖDENDİĞİNDE tetiklenir; best-effort'tur (fonksiyonun kendi içinde try/catch VAR, bu akışı
  // BOZMAZ, bkz. lib/notifications.ts::triggerAppointmentConfirmationEmail).
  await triggerAppointmentConfirmationEmail(app, {
    booking: result.booking,
    appointments: result.appointments,
    rawAccessToken: result.rawAccessToken,
  });
}

/**
 * §9.7.1 madde 3 (bağlayıcı) — `payment_intent.payment_failed`. `metadata.bookingId`
 * `payment_intent_data.metadata`'dan gelir (bkz. `telehealth.checkout.routes.ts::
 * stripe.checkout.sessions.create`). YALNIZCA `paymentStatus = FAILED` + `errorSummary` yazar —
 * randevu satırlarına DOKUNMAZ (hâlâ `PENDING_PAYMENT`; hasta tekrar ödeme deneyebilir/booking
 * süresi dolarsa süpürücü zaten temizler). `updateMany` ile İDEMPOTENT: booking ZATEN
 * `PENDING` DIŞINDAYSA (ör. bu arada başka bir oturumla ödendi) no-op.
 */
async function handleTelehealthPaymentFailed(app: FastifyInstance, paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const bookingId = paymentIntent.metadata?.bookingId;
  if (!bookingId) return;

  const errorSummary = paymentIntent.last_payment_error?.message ?? "payment_failed";

  await app.prisma.appointmentBooking.updateMany({
    where: { id: bookingId, paymentStatus: "PENDING" },
    data: { paymentStatus: "FAILED", errorSummary },
  });
}

/**
 * §10.9.3 Sepet + Stripe Checkout — `checkout.session.completed` artık ÜÇ farklı akıştan
 * gelebilir (aynı Stripe hesabı org abonelikleri, misafir ürün siparişleri VE [TCT] §9.7.1
 * telehealth booking ödemeleri için kullanılıyor): `session.mode === "subscription"` ise bu,
 * `billing.service.ts::createCheckoutSession`'ın ürettiği MEVCUT akıştır — davranışı BİREBİR
 * korunur (aşağıdaki `organizationId`/`session.subscription` guard'ı öncekiyle AYNI).
 * `session.mode === "payment"` içinde `session.metadata.bookingId` VARSA [TCT] §9.7.1
 * (integration-agent) booking akışıdır; YOKSA checkout.routes.ts'in ürettiği sepet siparişi
 * akışıdır — **YENİ bir webhook path'i AÇILMADI** (§9.7.1 madde 4, bağlayıcı), mevcut uç
 * `metadata` içeriğine göre dallanır (`handleOrderPaid` İLE AYNI `kind` ayrımı deseni).
 */
async function handleCheckoutCompleted(app: FastifyInstance, session: Stripe.Checkout.Session) {
  if (session.mode === "payment") {
    if (session.metadata?.bookingId) {
      await handleTelehealthBookingPaid(app, session);
      return;
    }
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

/**
 * `.claude/architect-scope-rbac-5-tier.md` §7.2 — `USER → CUSTOMER` terfisi. Yalnızca `USER`
 * rolündeki kullanıcılar terfi eder; `CUSTOMER` zaten hedef durumdadır (no-op) ve
 * `ADMIN`/`MANAGER`/`EDITOR` hiçbir koşulda değiştirilmez (panel yetkisi bir ayrıcalık
 * kaybına dönüştürülmez). Otomatik GERİ DÜŞÜRME YOKTUR — bu fonksiyon yalnızca ileri yönde
 * çağrılır. Koşullu `updateMany` ile atomik "yalnızca hâlâ USER ise" claim edilir; audit
 * yalnızca gerçekten bir geçiş olduğunda yazılır (`actorId: null` — sistem aktörü).
 */
async function promoteUserToCustomerIfNeeded(app: FastifyInstance, siteUserId: string, orderId: string): Promise<void> {
  const promoted = await app.prisma.user.updateMany({
    where: { id: siteUserId, role: "USER" },
    data: { role: "CUSTOMER" },
  });
  if (promoted.count === 0) return;

  await logAudit(app, {
    actorId: null,
    actorEmail: null,
    action: "user.role_change",
    targetType: "User",
    targetId: siteUserId,
    metadata: { from: "USER", to: "CUSTOMER", reason: "order_paid", orderId },
  });
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

    // §1.6 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — Serializable paterni
    // AYNI kalır; içindeki tek satır genelleşir: `item.variantId` doluysa `tx.productVariant`
    // (satılan birim VARYASYON — §1.2), boşsa mevcut `tx.product` akışı (DEĞİŞMEDEN). Okuma ve
    // düşürme AYNI transaction içinde kalır (yarış koşulu koruması buradan gelir).
    let insufficientProductTitle: string | null = null;
    for (const item of order.items) {
      if (item.variantId) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant || variant.stockQuantity < item.quantity) {
          insufficientProductTitle = item.productTitle;
          break;
        }
      } else if (item.productId) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stockQuantity < item.quantity) {
          insufficientProductTitle = item.productTitle;
          break;
        }
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
      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stockQuantity: { decrement: item.quantity } },
        });
      } else if (item.productId) {
        await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { decrement: item.quantity } } });
      }
      // `.claude/architect-scope-products-catalog.md` §5.2 — architect'in bu tek satır için
      // yazılı istisna verdiği canlı `salesCount` artırımı (`sort=bestselling`'in kaynağı).
      // Ürün seviyesinde tutulur — satılan birim varyasyon olsa BİLE `Product.salesCount` artar.
      if (item.productId) {
        await tx.product.update({ where: { id: item.productId }, data: { salesCount: { increment: item.quantity } } });
      }
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

  // `.claude/architect-scope-rbac-5-tier.md` §7.2 — `USER → CUSTOMER` terfisi, yalnızca
  // kimliği doğrulanmış (siteUserId dolu) bir sipariş ÖDENDİĞİNDE tetiklenir. Yalnızca `USER`
  // rolü değişir; `EDITOR`/`MANAGER`/`ADMIN`/`CUSTOMER` hiçbir koşulda değiştirilmez (bir ADMIN
  // alışveriş yaparsa rolü düşürülemez). Best-effort — bu adımın başarısız olması ödeme/sipariş
  // akışını ASLA bozmaz.
  if (order.siteUserId) {
    try {
      await promoteUserToCustomerIfNeeded(app, order.siteUserId, order.id);
    } catch (err) {
      app.log.error({ err, orderId: order.id, siteUserId: order.siteUserId }, "USER -> CUSTOMER terfisi başarısız oldu");
    }
  }

  // §10.13.8 — `ORDER_PAID`, sipariş `PAID`'e geçtikten SONRA (§10.13's giden webhook sistemi;
  // Stripe'ın BİZE gönderdiği GELEN webhook'la KARIŞTIRILMAMALI).
  await emitWebhookEvent(app, "ORDER_PAID", await buildWebhookOrderPayload(app, order));
  try {
    await sendTemplateEmail(app, "ORDER_CONFIRMATION", order.customerEmail, {
      order_number: order.orderNumber,
      customer_name: order.customerName ?? order.customerEmail,
      // §1.3/§3.3 (.claude/architect-scope-ecommerce-pro-template.md) — varyasyon etiketi VARSA
      // özet metnine yansıtılır (`items_summary` MEVCUT sistem değişkenidir, e-posta şablon
      // sözleşmesine YENİ bir değişken EKLENMEZ — bkz. lib/email-variables.ts, architect/
      // documentation-agent onayı gerektirir). Kargo bedeli AYRICA satırlanmaz: `total_formatted`
      // zaten `order.totalCents`'ten (`subtotal - discount + shipping`) üretilir, dolayısıyla
      // tahsil edilen tutarla e-postada gösterilen tutar HER ZAMAN birebir tutarlıdır.
      items_summary: order.items
        .map((item) => `${item.productTitle}${item.variantLabel ? ` (${item.variantLabel})` : ""} x${item.quantity}`)
        .join(", "),
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
      // [TCT] §9.7.1 madde 3 (bağlayıcı) — YALNIZCA `paymentStatus = FAILED` + `errorSummary`.
      // `payment_intent.succeeded` KASITLI OLARAK dinlenmez (§9.7.1 madde 3 — onay olayı
      // `checkout.session.completed`'dır, ikinci bir onay yolu AÇILMAZ).
      case "payment_intent.payment_failed":
        await handleTelehealthPaymentFailed(app, event.data.object as Stripe.PaymentIntent);
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
