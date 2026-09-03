import { z } from "zod";

export const AddCartItemRequestSchema = z.object({
  productId: z.string().uuid(),
  // Ürünün EN AZ BİR varyasyonu varsa ZORUNLUDUR (eksikse 422); varyasyonsuz üründe
  // gönderilirse 422 — bu çapraz-alan kuralı DB durumuna bağlı olduğu için burada DEĞİL,
  // route handler'da (cart.routes.ts) uygulanır (bkz. openapi.yaml::AddCartItemRequest).
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(99),
});
export type AddCartItemRequest = z.infer<typeof AddCartItemRequestSchema>;

export const UpdateCartItemRequestSchema = z.object({
  quantity: z.number().int().min(1).max(99),
});
export type UpdateCartItemRequest = z.infer<typeof UpdateCartItemRequestSchema>;

export const CartItemIdParamSchema = z.object({
  itemId: z.string().uuid(),
});
