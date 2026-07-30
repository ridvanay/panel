import type { FastifyInstance } from "fastify";
import { stripe } from "../../lib/stripe";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { env } from "../../config/env";

async function getOrCreateStripeCustomer(app: FastifyInstance, organizationId: string, ownerEmail: string) {
  const subscription = await app.prisma.subscription.findUnique({ where: { organizationId } });
  if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;

  const customer = await stripe.customers.create({ email: ownerEmail, metadata: { organizationId } });
  return customer.id;
}

export async function createCheckoutSession(
  app: FastifyInstance,
  organizationId: string,
  input: { planId: string; billingCycle: "monthly" | "yearly"; successUrl: string; cancelUrl: string }
): Promise<string> {
  const org = await app.prisma.organization.findUnique({
    where: { id: organizationId },
    include: { owner: true },
  });
  if (!org) throw new NotFoundError("Organizasyon bulunamadı.");

  const plan = await app.prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new NotFoundError("Plan bulunamadı.");

  const priceId = input.billingCycle === "monthly" ? plan.stripePriceIdMonthly : plan.stripePriceIdYearly;
  if (!priceId) throw new ConflictError("Bu plan için Stripe fiyatı tanımlı değil.");

  const customerId = await getOrCreateStripeCustomer(app, organizationId, org.owner.email);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { organizationId, planId: plan.id },
    subscription_data: { metadata: { organizationId, planId: plan.id } },
  });

  if (!session.url) throw new ConflictError("Stripe checkout oturumu oluşturulamadı.");
  return session.url;
}

export async function createPortalSession(app: FastifyInstance, organizationId: string): Promise<string> {
  const subscription = await app.prisma.subscription.findUnique({ where: { organizationId } });
  if (!subscription?.stripeCustomerId) {
    throw new NotFoundError("Bu organizasyon için önce bir abonelik oluşturulmalı.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.FRONTEND_URL}/settings/billing`,
  });

  return session.url;
}

export async function getSubscription(app: FastifyInstance, organizationId: string) {
  const subscription = await app.prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  if (!subscription) throw new NotFoundError("Bu organizasyon için abonelik bulunamadı.");
  return subscription;
}
