import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";

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

async function handleCheckoutCompleted(app: FastifyInstance, session: Stripe.Checkout.Session) {
  const organizationId = session.metadata?.organizationId;
  const planId = session.metadata?.planId;
  if (!organizationId || !session.subscription) return;

  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  await upsertSubscription(app, organizationId, planId, stripeSubscription);
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
