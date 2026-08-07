import { z } from "zod";

// GÜVENLİK: bu uç PUBLIC + kimliksiz (bkz. checkout.routes.ts) — global bodyLimit ~5MB olduğundan
// üst sınırsız string alanlar (ör. e-posta/isim) DB'ye/Stripe'a/e-posta şablonuna aşırı büyük
// payload sızdırabilir (depolama/işlem israfı, kaba bir DoS vektörü). RFC 5321 e-posta üst sınırı
// 254 karakterdir; müşteri adı için 200 karakter makul bir pratik üst sınırdır.
export const CreateCheckoutSessionRequestSchema = z.object({
  customerEmail: z.string().email().max(254),
  customerName: z.string().min(1).max(200).optional(),
});
export type CreateCheckoutSessionRequest = z.infer<typeof CreateCheckoutSessionRequestSchema>;

export const CheckoutSessionResponseSchema = z.object({
  checkoutUrl: z.string(),
});
