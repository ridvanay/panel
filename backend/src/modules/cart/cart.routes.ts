import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { CartSchema } from "../../schemas/entities";
import { toCartDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { CART_COOKIE_NAME, CART_TOKEN_TTL_DAYS, cartCookieOptions } from "../../lib/cookies";
import { AddCartItemRequestSchema, CartItemIdParamSchema, UpdateCartItemRequestSchema } from "./cart.schemas";

/** `GET /cart`/`POST /cart/items` yanıtlarında ürün join'i için ortak `include` şekli. */
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
        },
      },
    },
  },
} as const;

function cartExpiresAt(): Date {
  return new Date(Date.now() + CART_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
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
      if (!cart) return reply.send(ok({ items: [], currency: null, subtotalCents: 0 }));

      return reply.send(ok(toCartDto(cart.items, cart.currency)));
    }
  );

  server.post(
    "/items",
    { schema: { body: AddCartItemRequestSchema, response: { 201: ApiSuccessSchema(CartSchema) } } },
    async (request, reply) => {
      const { productId, quantity } = request.body;

      const product = await app.prisma.product.findFirst({
        where: { id: productId, status: "PUBLISHED", deletedAt: null },
      });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");
      if (product.stockQuantity === 0) throw new ConflictError("Ürün tükendi.");

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

      const unitPriceCents = product.discountPriceCents ?? product.priceCents;
      const existingItem = cart.items.find((item) => item.productId === productId);

      if (existingItem) {
        const newQuantity = Math.min(existingItem.quantity + quantity, 99);
        await app.prisma.cartItem.update({ where: { id: existingItem.id }, data: { quantity: newQuantity } });
      } else {
        await app.prisma.cartItem.create({
          data: { cartId: cart.id, productId, quantity, unitPriceCents },
        });
      }

      const finalCart = await app.prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: WITH_ITEMS });

      if (rawToken) {
        reply.setCookie(CART_COOKIE_NAME, rawToken, cartCookieOptions());
      }

      return reply.code(201).send(ok(toCartDto(finalCart.items, finalCart.currency)));
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
      return reply.send(ok(toCartDto(finalCart.items, finalCart.currency)));
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
