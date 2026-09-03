import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ProductVariant } from "@prisma/client";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { CartSchema } from "../../schemas/entities";
import { toCartDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { CART_COOKIE_NAME, CART_TOKEN_TTL_DAYS, cartCookieOptions } from "../../lib/cookies";
import { resolveUnitPriceCents } from "../../lib/product-pricing";
import { computeShipping, type ShippingSettingsInput } from "../../lib/shipping";
import { SETTINGS_ID } from "../settings/settings.routes";
import { AddCartItemRequestSchema, CartItemIdParamSchema, UpdateCartItemRequestSchema } from "./cart.schemas";

/** `GET /cart`/`POST /cart/items` yanıtlarında ürün join'i için ortak `include` şekli.
 * `variantOptions` (product) + `variant` (item) — CartItemDto.variantLabel/stok TÜRETİMİ için
 * (bkz. mappers/index.ts::toCartItemDto, CartItem'da AYRICA saklanmaz). */
const WITH_ITEMS = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          stockQuantity: true,
          priceCents: true,
          discountPriceCents: true,
          currency: true,
          coverMedia: true,
          variantOptions: true,
        },
      },
      variant: true,
    },
  },
} as const;

function cartExpiresAt(): Date {
  return new Date(Date.now() + CART_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * §3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — kargo hesabının TEK girdi
 * kaynağı. Ayar satırı hiç yoksa (henüz `PATCH /admin/settings` çağrılmadı) her iki alan da
 * `null` — bugünkü davranışın (kargo hesaplanmaz) birebir aynısıdır.
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
 * Cookie'deki opak token'ın hash'iyle SÜRESİ GEÇMEMİŞ bir `Cart` arar. Cookie yoksa VEYA
 * eşleşen/geçerli bir sepet yoksa `null` döner — ÇAĞIRAN TARAF karar verir: `GET /cart` boş
 * sepet döner, `POST /cart/items` yeni bir sepet+token oluşturur (lazy create, bkz. görev notu).
 */
async function findCartFromCookie(app: FastifyInstance, request: FastifyRequest) {
  const rawToken = request.cookies?.[CART_COOKIE_NAME];
  if (!rawToken) return null;

  return app.prisma.cart.findFirst({
    where: { tokenHash: hashToken(rawToken), expiresAt: { gt: new Date() } },
    include: WITH_ITEMS,
  });
}

/** `/cart` prefix'i altında bağlanır (bkz. app.ts) — PUBLIC, `requireModuleEnabled("products")`. */
export async function cartRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("products"));

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(CartSchema) } } },
    async (request, reply) => {
      const cart = await findCartFromCookie(app, request);
      const shippingSettings = await readShippingSettings(app);

      if (!cart) {
        const shipping = computeShipping(0, shippingSettings);
        return reply.send(ok({ items: [], currency: null, subtotalCents: 0, shipping, totalCents: 0 }));
      }

      return reply.send(ok(toCartDto(cart.items, cart.currency, shippingSettings)));
    }
  );

  server.post(
    "/items",
    { schema: { body: AddCartItemRequestSchema, response: { 201: ApiSuccessSchema(CartSchema) } } },
    async (request, reply) => {
      const { productId, quantity } = request.body;
      const variantIdInput = request.body.variantId ?? null;

      const product = await app.prisma.product.findFirst({
        where: { id: productId, status: "PUBLISHED", deletedAt: null },
        include: { variants: true },
      });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      // §1.2/§1.3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — ürünün EN AZ
      // BİR varyasyonu varsa satın alınabilir birim VARYASYONDUR; `variantId` ZORUNLUDUR.
      // Varyasyonsuz üründe `variantId` gönderilirse 422 (openapi.yaml::AddCartItemRequest).
      const hasVariants = product.variants.length > 0;
      if (hasVariants && !variantIdInput) {
        throw new ValidationError("Bu ürünün varyasyonları var; `variantId` zorunludur.", {
          variantId: ["Bu ürün için bir varyasyon seçmelisiniz."],
        });
      }
      if (!hasVariants && variantIdInput) {
        throw new ValidationError("Bu ürünün varyasyonu yok; `variantId` gönderilmemelidir.", {
          variantId: ["Bu ürünün varyasyonu yok."],
        });
      }

      let variant: ProductVariant | null = null;
      if (variantIdInput) {
        variant = product.variants.find((row) => row.id === variantIdInput) ?? null;
        // Varyasyon başka bir ürüne aitse/pasifse/stoksuzsa 409 CONFLICT (openapi.yaml notu).
        if (!variant) throw new ConflictError("Seçilen varyasyon bu ürüne ait değil.");
        if (!variant.isActive) throw new ConflictError("Bu varyasyon artık satışta değil.");
        if (variant.stockQuantity === 0) throw new ConflictError("Bu varyasyon tükendi.");
      } else if (product.stockQuantity === 0) {
        throw new ConflictError("Ürün tükendi.");
      }

      let cart = await findCartFromCookie(app, request);
      let rawToken: string | undefined;

      if (!cart) {
        rawToken = generateOpaqueToken();
        cart = await app.prisma.cart.create({
          data: { tokenHash: hashToken(rawToken), currency: product.currency, expiresAt: cartExpiresAt() },
          include: WITH_ITEMS,
        });
      } else if (cart.items.length > 0 && cart.currency !== product.currency) {
        throw new ConflictError("Sepetinizdeki ürünlerle farklı para birimine sahip bir ürün ekleyemezsiniz.");
      } else if (cart.items.length === 0 && cart.currency !== product.currency) {
        // Boş sepette para birimi ilk eklenen ürüne göre yeniden belirlenebilir.
        await app.prisma.cart.update({ where: { id: cart.id }, data: { currency: product.currency } });
      }

      // §1.5 — fiyat DONDURMA: sepete eklerken TEK üretim noktasından (resolveUnitPriceCents)
      // okunur, variant varsa onun miras/mutlak kuralı uygulanır.
      const unitPriceCents = resolveUnitPriceCents(product, variant);

      // §1.4 (bağlayıcı, ATLANIRSA SESSİZ HATA) — dedupe anahtarı `(productId, variantId ?? null)`.
      // `@@unique([cartId, productId, variantId])` NULL'ları birbirine eşit SAYMADIĞI için bu
      // uygulama katmanı kontrolü, varyasyonsuz üründe eski `(cartId, productId)` korumasının
      // yerini alır (bkz. schema.prisma::CartItem notu).
      const existingItem = cart.items.find(
        (item) => item.productId === productId && (item.variantId ?? null) === variantIdInput
      );

      if (existingItem) {
        const newQuantity = Math.min(existingItem.quantity + quantity, 99);
        await app.prisma.cartItem.update({ where: { id: existingItem.id }, data: { quantity: newQuantity } });
      } else {
        await app.prisma.cartItem.create({
          data: { cartId: cart.id, productId, variantId: variantIdInput, quantity, unitPriceCents },
        });
      }

      const finalCart = await app.prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: WITH_ITEMS });

      if (rawToken) {
        reply.setCookie(CART_COOKIE_NAME, rawToken, cartCookieOptions());
      }

      const shippingSettings = await readShippingSettings(app);
      return reply.code(201).send(ok(toCartDto(finalCart.items, finalCart.currency, shippingSettings)));
    }
  );

  server.patch(
    "/items/:itemId",
    {
      schema: {
        params: CartItemIdParamSchema,
        body: UpdateCartItemRequestSchema,
        response: { 200: ApiSuccessSchema(CartSchema) },
      },
    },
    async (request, reply) => {
      const cart = await findCartFromCookie(app, request);
      const item = cart?.items.find((row) => row.id === request.params.itemId);
      if (!cart || !item) throw new NotFoundError("Sepet öğesi bulunamadı.");

      await app.prisma.cartItem.update({ where: { id: item.id }, data: { quantity: request.body.quantity } });

      const finalCart = await app.prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: WITH_ITEMS });
      const shippingSettings = await readShippingSettings(app);
      return reply.send(ok(toCartDto(finalCart.items, finalCart.currency, shippingSettings)));
    }
  );

  server.delete(
    "/items/:itemId",
    { schema: { params: CartItemIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const cart = await findCartFromCookie(app, request);
      const item = cart?.items.find((row) => row.id === request.params.itemId);
      if (!cart || !item) throw new NotFoundError("Sepet öğesi bulunamadı.");

      await app.prisma.cartItem.delete({ where: { id: item.id } });
      return reply.code(204).send();
    }
  );
}
