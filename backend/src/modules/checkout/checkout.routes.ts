import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ProductVariant } from "@prisma/client";
import type Stripe from "stripe";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
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
import { resolveUnitPriceCents } from "../../lib/product-pricing";
import { computeShipping, type ShippingSettingsInput } from "../../lib/shipping";
import { SETTINGS_ID } from "../settings/settings.routes";
import { buildVariantLabel, type ProductVariantOption } from "../products/lib/variants";

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

/**
 * §3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — kargo hesabının TEK girdi
 * kaynağı. `cart.routes.ts::readShippingSettings` ile AYNI (o dosyaya DOKUNULAMAZ, bkz. görev
 * notu) — küçük, tek satırlık bir okuma olduğu için kopyalanması bilinçlidir. Ayar satırı hiç
 * yoksa (henüz `PATCH /admin/settings` çağrılmadı) her iki alan da `null` — bugünkü davranışın
 * (kargo hesaplanmaz) birebir aynısıdır.
 */
async function readShippingSettings(app: FastifyInstance): Promise<ShippingSettingsInput> {
  const settings = await app.prisma.siteSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { shippingFlatFeeCents: true, freeShippingThresholdCents: true },
  });
  return {
    shippingFlatFeeCents: settings?.shippingFlatFeeCents ?? null,
    freeShippingThresholdCents: settings?.freeShippingThresholdCents ?? null,
  };
}

/**
 * `/checkout` prefix'i altında bağlanır (bkz. app.ts) — PUBLIC, `requireModuleEnabled("products")`.
 * `.claude/architect-scope-rbac-5-tier.md` §7.2 — `POST /session` isteğe bağlı kimlik
 * doğrulamalıdır: `Authorization: Bearer` header'ı VARSA ve geçerliyse `Order.siteUserId`
 * dolar; YOKSA mevcut misafir akışı aynen çalışır (401 ÜRETİLMEZ, bkz.
 * `middleware/authenticate.ts::authenticateOptional`).
 */
export async function checkoutRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("products"));
  server.addHook("preHandler", authenticateOptional);

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
      // §1.6 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — satılan birimin
      // varyasyonlu olup olmadığını çözebilmek için `variants` İLE BİRLİKTE okunur.
      const productIds = cart.items.map((item) => item.productId);
      const freshProducts = await app.prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { variants: true },
      });
      const productById = new Map(freshProducts.map((product) => [product.id, product]));

      const orderItemsData: {
        productId: string;
        productTitle: string;
        productSku: string | null;
        variantId: string | null;
        variantLabel: string | null;
        unitPriceCents: number;
        quantity: number;
        lineTotalCents: number;
      }[] = [];

      for (const cartItem of cart.items) {
        const product = productById.get(cartItem.productId);
        if (!product || product.deletedAt || product.status !== "PUBLISHED") {
          throw new ConflictError(`"${cartItem.product.title}" artık satın alınamıyor.`);
        }

        // §1.2/§1.6 — ürünün EN AZ BİR varyasyonu varsa satın alınabilir birim VARYASYONDUR;
        // stok/fiyat BURADAN okunur ve `Product.stockQuantity` YOK SAYILIR. `cart.routes.ts::
        // POST /cart/items` ile AYNI hata deseni (409 CONFLICT) — varyasyon silinmiş/pasife
        // alınmış/stoksuz kalmışsa checkout burada durur.
        const variantIdInput = cartItem.variantId ?? null;
        let variant: ProductVariant | null = null;
        if (variantIdInput) {
          variant = product.variants.find((row) => row.id === variantIdInput) ?? null;
          if (!variant) throw new ConflictError(`"${product.title}" için seçilen varyasyon artık mevcut değil.`);
          if (!variant.isActive) throw new ConflictError(`"${product.title}" için seçilen varyasyon artık satışta değil.`);
          if (variant.stockQuantity < cartItem.quantity) {
            throw new ConflictError(`"${product.title}" için yeterli stok yok.`);
          }
        } else if (product.stockQuantity < cartItem.quantity) {
          throw new ConflictError(`"${product.title}" için yeterli stok yok.`);
        }

        // §1.5 — fiyat ASLA istemciden alınmaz, TEK üretim noktasından (resolveUnitPriceCents)
        // taze hesaplanır (variant varsa miras/mutlak kuralı uygulanır).
        const unitPriceCents = resolveUnitPriceCents(product, variant);
        const axes = (product.variantOptions as ProductVariantOption[] | null) ?? [];
        const variantLabel = variant ? buildVariantLabel(variant.optionValues as Record<string, string>, axes) : null;
        // §1.3 — `productSku` SATILAN BİRİMİN sku'sunu taşır (varsa varyasyonunki).
        const productSku = variant?.sku ?? product.sku;

        orderItemsData.push({
          productId: product.id,
          productTitle: product.title,
          productSku,
          variantId: variant?.id ?? null,
          variantLabel,
          unitPriceCents,
          quantity: cartItem.quantity,
          lineTotalCents: unitPriceCents * cartItem.quantity,
        });
      }

      const currency = freshProducts[0]?.currency ?? cart.currency;
      const subtotalCents = orderItemsData.reduce((sum, item) => sum + item.lineTotalCents, 0);

      // §3.3 — kargo TEK yardımcıdan (computeShipping) hesaplanır, matematiği burada
      // TEKRARLANMAZ. `totalCents = subtotalCents - discountCents + shippingCents`.
      const shippingSettings = await readShippingSettings(app);
      const shipping = computeShipping(subtotalCents, shippingSettings);
      const totalCents = subtotalCents + shipping.feeCents;

      const order = await app.prisma.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          cartId: cart.id,
          // §7.2 — yalnızca `Authorization: Bearer` başlığı geçerliyse dolar; misafir checkout'ta
          // (mevcut, DEĞİŞMEYEN akış) `null` kalır.
          siteUserId: request.user?.id ?? null,
          customerEmail,
          customerName: customerName ?? null,
          status: "PENDING",
          currency,
          subtotalCents,
          discountCents: 0,
          taxCents: 0,
          shippingCents: shipping.feeCents,
          totalCents,
          items: { create: orderItemsData },
        },
        include: { items: true },
      });

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = orderItemsData.map((item) => ({
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: item.unitPriceCents,
          product_data: { name: item.variantLabel ? `${item.productTitle} (${item.variantLabel})` : item.productTitle },
        },
        quantity: item.quantity,
      }));

      // §3.3 (bağlayıcı) — kargo bedeli sepette gösteriliyorsa Stripe oturumuna da AYRI bir
      // `price_data` satırı olarak eklenir ve tahsil edilir (gösterilen ile tahsil edilen tutar
      // birebir aynı olmak zorunda). Stripe'ın kendi `shipping_options`/adres toplama özelliği
      // BİLİNÇLİ olarak KULLANILMAZ — tek satır yeterlidir.
      if (shipping.feeCents > 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: shipping.feeCents,
            product_data: { name: "Kargo" },
          },
          quantity: 1,
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: customerEmail,
        line_items: lineItems,
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
