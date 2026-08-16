import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ConflictError } from "../../lib/errors";
import { hashToken } from "../../lib/tokens";
import { CART_COOKIE_NAME } from "../../lib/cookies";
import { stripe } from "../../lib/stripe";
import { env } from "../../config/env";
import { CheckoutSessionResponseSchema, CreateCheckoutSessionRequestSchema } from "./checkout.schemas";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { buildWebhookOrderPayload } from "../../lib/webhook-order-payload";

// Diğer hassas/istismara açık PUBLIC uçlarla (ör. admin-users.routes.ts::ADMIN_USERS_RATE_LIMIT)
// AYNI route-level override paterni — global limitten (env.RATE_LIMIT_MAX) BAĞIMSIZ, para hareketi
// başlatan bu uca özel sıkı bir üst sınır (kaba kuvvet/otomatik Stripe session spam'ine karşı).
// Varsayılan keyGenerator zaten `request.ip` (IP bazlı), bkz. plugins/security.ts.
const CHECKOUT_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

/** `ORD-<zaman-base36>-<4 hex>` — okunabilir + pratikte benzersiz (zaman + rastgelelik). */
function generateOrderNumber(): string {
  const timePart = Date.now().toString(36).toUpperCase();
  const randomPart = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `ORD-${timePart}-${randomPart}`;
}

/** `/checkout` prefix'i altında bağlanır (bkz. app.ts) — PUBLIC, `requireModuleEnabled("products")`. */
export async function checkoutRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("products"));

  server.post(
    "/session",
    {
      config: { rateLimit: CHECKOUT_RATE_LIMIT },
      schema: {
        body: CreateCheckoutSessionRequestSchema,
        response: { 201: ApiSuccessSchema(CheckoutSessionResponseSchema) },
      },
    },
    async (request, reply) => {
      const { customerEmail, customerName } = request.body;

      const rawToken = request.cookies?.[CART_COOKIE_NAME];
      const cart = rawToken
        ? await app.prisma.cart.findFirst({
            where: { tokenHash: hashToken(rawToken), expiresAt: { gt: new Date() } },
            include: { items: { include: { product: true } } },
          })
        : null;

      if (!cart || cart.items.length === 0) {
        throw new ConflictError("Sepetiniz boş.");
      }

      // GÜVENLİK: istemciden (sepetteki dondurulmuş fiyattan) fiyat/stok ASLA kabul edilmez —
      // her satır, sipariş oluşturulmadan hemen önce DB'den TAZE okunur (bkz. görev notu).
      const productIds = cart.items.map((item) => item.productId);
      const freshProducts = await app.prisma.product.findMany({ where: { id: { in: productIds } } });
      const productById = new Map(freshProducts.map((product) => [product.id, product]));

      const orderItemsData: {
        productId: string;
        productTitle: string;
        productSku: string | null;
        unitPriceCents: number;
        quantity: number;
        lineTotalCents: number;
      }[] = [];

      for (const cartItem of cart.items) {
        const product = productById.get(cartItem.productId);
        if (!product || product.deletedAt || product.status !== "PUBLISHED") {
          throw new ConflictError(`"${cartItem.product.title}" artık satın alınamıyor.`);
        }
        if (product.stockQuantity < cartItem.quantity) {
          throw new ConflictError(`"${product.title}" için yeterli stok yok.`);
        }

        const unitPriceCents = product.discountPriceCents ?? product.priceCents;
        orderItemsData.push({
          productId: product.id,
          productTitle: product.title,
          productSku: product.sku,
          unitPriceCents,
          quantity: cartItem.quantity,
          lineTotalCents: unitPriceCents * cartItem.quantity,
        });
      }

      const currency = freshProducts[0]?.currency ?? cart.currency;
      const subtotalCents = orderItemsData.reduce((sum, item) => sum + item.lineTotalCents, 0);

      const order = await app.prisma.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          cartId: cart.id,
          customerEmail,
          customerName: customerName ?? null,
          status: "PENDING",
          currency,
          subtotalCents,
          discountCents: 0,
          taxCents: 0,
          totalCents: subtotalCents,
          items: { create: orderItemsData },
        },
        include: { items: true },
      });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: customerEmail,
        line_items: orderItemsData.map((item) => ({
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: item.unitPriceCents,
            product_data: { name: item.productTitle },
          },
          quantity: item.quantity,
        })),
        success_url: `${env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.FRONTEND_URL}/checkout/cancel`,
        metadata: { kind: "order", orderId: order.id },
      });

      if (!session.url) throw new ConflictError("Stripe checkout oturumu oluşturulamadı.");

      await app.prisma.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: session.id } });

      // §10.13.8 — `ORDER_CREATED`, checkout oturumu başarıyla açıldıktan SONRA tetiklenir.
      await emitWebhookEvent(app, "ORDER_CREATED", await buildWebhookOrderPayload(app, order));

      return reply.code(201).send(ok({ checkoutUrl: session.url }));
    }
  );
}
