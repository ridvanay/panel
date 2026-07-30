import { z } from "zod";

export const CreateCheckoutSessionRequestSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: z.enum(["monthly", "yearly"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const CheckoutSessionResponseSchema = z.object({
  checkoutUrl: z.string().url(),
});

export const BillingPortalResponseSchema = z.object({
  portalUrl: z.string().url(),
});
