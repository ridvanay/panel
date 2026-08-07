import { z } from "zod";

export const AddCartItemRequestSchema = z.object({
  productId: z.string().uuid(),
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
