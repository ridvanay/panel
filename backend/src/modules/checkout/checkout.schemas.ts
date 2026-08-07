import { z } from "zod";

export const CreateCheckoutSessionRequestSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().min(1).optional(),
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>;

export const CheckoutSessionResponseSchema = z.object({
  checkoutUrl: z.string(),
});
