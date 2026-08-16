import type { FastifyInstance } from "fastify";
import type { Order, OrderItem } from "@prisma/client";
import type { WebhookOrderPayloadDto } from "../schemas/entities";

export type OrderWithItems = Order & { items: OrderItem[] };

/**
 * §10.13.9 — `ORDER_*` olaylarının `data` alanı. Public API'de sipariş ucu YOKTUR (`Order`
 * admin DTO'suyla KARIŞTIRILMAMALI — burada `customerEmail` MASKELENMEZ, bkz. §10.13.10).
 * `productSlug`, `OrderItem.productId` üzerinden TEK sorguda (N+1 YOK) çözülür — ürün silinmişse
 * (`productId: null` veya `Product` artık yoksa) `null` döner.
 */
export async function buildWebhookOrderPayload(
  app: FastifyInstance,
  order: OrderWithItems,
  previousStatus: Order["status"] | null = null
): Promise<WebhookOrderPayloadDto> {
  const productIds = order.items.map((item) => item.productId).filter((id): id is string => Boolean(id));
  const products = productIds.length > 0 ? await app.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, slug: true } }) : [];
  const slugById = new Map(products.map((p) => [p.id, p.slug]));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    previousStatus,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productSlug: item.productId ? (slugById.get(item.productId) ?? null) : null,
      productTitle: item.productTitle,
      productSku: item.productSku,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents,
    })),
  };
}
