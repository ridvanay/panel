import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { AddressSchema, OrderSchema, UserSchema, WishlistItemSchema } from "../../schemas/entities";
import { toAddressDto, toOrderDto, toUserDto, toWishlistItemDto } from "../../mappers";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/password";
import { REFRESH_COOKIE_NAME } from "../../lib/cookies";
import { hashToken } from "../../lib/tokens";
import { logAudit } from "../../lib/audit";
import { SENSITIVE_ACTION_RATE_LIMIT } from "../../lib/rate-limit";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import {
  UpdateUserRequestSchema,
  ChangePasswordRequestSchema,
  AddressIdParamSchema,
  CreateAddressRequestSchema,
  UpdateAddressRequestSchema,
  ProductIdParamSchema,
  AddWishlistItemRequestSchema,
  MAX_ADDRESSES_PER_USER,
  MAX_WISHLIST_ITEMS_PER_USER,
} from "./users.schemas";
import { ListOrdersQuerySchema, OrderIdParamSchema } from "../orders/orders.schemas";

/** `GET/POST /users/me/wishlist` yanıtında gömülü ürün özeti için ortak `select` — `toWishlistItemDto`'nun beklediği şekille BİREBİR. */
const WISHLIST_PRODUCT_SELECT = {
  id: true,
  title: true,
  slug: true,
  coverMedia: true,
  priceCents: true,
  discountPriceCents: true,
  currency: true,
  stockQuantity: true,
} as const;

export default async function usersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get("/me", { schema: { response: { 200: ApiSuccessSchema(UserSchema) } } }, async (request, reply) => {
    const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
    return reply.send(ok(toUserDto(user)));
  });

  server.patch(
    "/me",
    { schema: { body: UpdateUserRequestSchema, response: { 200: ApiSuccessSchema(UserSchema) } } },
    async (request, reply) => {
      const user = await app.prisma.user.update({
        where: { id: request.user!.id },
        data: request.body,
      });
      return reply.send(ok(toUserDto(user)));
    }
  );

  // Site-rol şartı YOK — herkes yalnızca KENDİ şifresini değiştirir (bkz. openapi.yaml
  // /users/me/change-password ve architect-scope-toast-and-account.md §3.2).
  server.post(
    "/me/change-password",
    {
      config: { rateLimit: SENSITIVE_ACTION_RATE_LIMIT },
      schema: { body: ChangePasswordRequestSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({ where: { id: request.user!.id } });
      if (!user || !(await verifyPassword(user.passwordHash, request.body.currentPassword))) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "security.password_change",
          status: "FAILURE",
          ipAddress: request.ip,
        });
        // Mesaj `/2fa/disable` ile birebir aynı — bilgi sızdırmama + terminoloji birliği.
        throw new UnauthorizedError("Şifre hatalı.");
      }

      if (request.body.newPassword === request.body.currentPassword) {
        throw new ValidationError("Yeni şifre mevcut şifreden farklı olmalı.", {
          newPassword: ["Yeni şifre mevcut şifreden farklı olmalı."],
        });
      }

      // argon2 async olduğu için hash'i transaction DIŞINDA hesaplıyoruz.
      const passwordHash = await hashPassword(request.body.newPassword);

      const rawRefreshToken = request.cookies[REFRESH_COOKIE_NAME];
      const currentHash = rawRefreshToken ? hashToken(rawRefreshToken) : undefined;

      await app.prisma.$transaction([
        app.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        }),
        // Mevcut oturum HARİÇ tüm refresh token'lar iptal edilir — `/2fa/disable` ile
        // birebir tutarlı politika (bkz. security.routes.ts:138-153).
        app.prisma.refreshToken.updateMany({
          where: {
            userId: user.id,
            revoked: false,
            ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
          },
          data: { revoked: true },
        }),
      ]);

      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "security.password_change",
        targetType: "User",
        targetId: user.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  /**
   * `.claude/architect-scope-rbac-5-tier.md` §7.4 — authenticated (5 rolün hepsi), ROL GUARD'I
   * EKLENMEZ: gerçek yetkilendirme kontrolü sahipliktir (`Order.siteUserId = request.user.id`).
   * Bir `USER`'ın çağırması boş liste döndürür (hard 403 DEĞİL) — terfi zamanlaması geciktiği an
   * (webhook kuyruğu) kullanıcının kendi siparişini görememesine yol açmaması için bilinçli karar.
   */
  server.get(
    "/me/orders",
    {
      schema: {
        querystring: ListOrdersQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(OrderSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      // openapi.yaml:545 — "`seq desc`, en yeni önce" (kontrat). Önceki `asc` sıralama bir
      // drift'ti (bkz. `.claude/architect-scope-customer-portal.md` §10 madde 1) — kontrat
      // kazanır. `desc` sıralamada cursor bir SONRAKİ (daha eski) sayfayı `seq < cursorSeq`
      // ile ister (asc'teki `seq > cursorSeq`'in TERSİ).
      const rows = await app.prisma.order.findMany({
        where: {
          siteUserId: request.user!.id,
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { seq: "desc" },
        take: limit,
        include: { items: true },
      });

      return reply.send(ok(rows.map(toOrderDto), buildPageMeta(rows, limit)));
    }
  );

  /**
   * `.claude/architect-scope-customer-portal.md` §2.1 — YENİ uç. `GET /me/orders` ile AYNI
   * yetkilendirme deseni (rol guard'ı YOK, sahiplik filtresi). Başka bir kullanıcının siparişi
   * VEYA var olmayan bir id → 404 (403 DEĞİL: sipariş id'sinin VARLIĞI dahi sızdırılmaz).
   * Modül guard'ı YOK (§3 — sipariş geçmişi mali kayıttır, `products` modülü kapalıyken de açık
   * kalır; bkz. `GET /me/orders` üzerindeki AYNI karar).
   */
  server.get(
    "/me/orders/:orderId",
    {
      schema: {
        params: OrderIdParamSchema,
        response: { 200: ApiSuccessSchema(OrderSchema) },
      },
    },
    async (request, reply) => {
      const order = await app.prisma.order.findFirst({
        where: { id: request.params.orderId, siteUserId: request.user!.id },
        include: { items: true },
      });
      if (!order) throw new NotFoundError("Sipariş bulunamadı.");

      return reply.send(ok(toOrderDto(order)));
    }
  );

  // ---------- §2.2 Adres defteri — sahiplik filtresi (`userId = me`), rol guard'ı YOK, modül
  // guard'ı YOK ("her zaman açık" sekmeler, bkz. plan §3 guard matrisi). ----------

  server.get(
    "/me/addresses",
    { schema: { response: { 200: ApiSuccessSchema(z.array(AddressSchema)) } } },
    async (request, reply) => {
      const rows = await app.prisma.address.findMany({
        where: { userId: request.user!.id },
        orderBy: { seq: "asc" },
      });
      return reply.send(ok(rows.map(toAddressDto)));
    }
  );

  server.post(
    "/me/addresses",
    { schema: { body: CreateAddressRequestSchema, response: { 201: ApiSuccessSchema(AddressSchema) } } },
    async (request, reply) => {
      const userId = request.user!.id;

      const count = await app.prisma.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES_PER_USER) {
        throw new ConflictError(`En fazla ${MAX_ADDRESSES_PER_USER} adres kaydedebilirsiniz.`);
      }

      const { isDefault, ...rest } = request.body;
      // İlk adres OTOMATİK varsayılandır (§2.2) — kullanıcı `isDefault` göndermese bile.
      const makeDefault = isDefault || count === 0;

      const address = await app.prisma.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        }
        return tx.address.create({ data: { ...rest, userId, isDefault: makeDefault } });
      });

      return reply.code(201).send(ok(toAddressDto(address)));
    }
  );

  server.patch(
    "/me/addresses/:addressId",
    {
      schema: {
        params: AddressIdParamSchema,
        body: UpdateAddressRequestSchema,
        response: { 200: ApiSuccessSchema(AddressSchema) },
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const existing = await app.prisma.address.findFirst({ where: { id: request.params.addressId, userId } });
      if (!existing) throw new NotFoundError("Adres bulunamadı.");

      const { isDefault, ...rest } = request.body;

      const address = await app.prisma.$transaction(async (tx) => {
        if (isDefault === true && !existing.isDefault) {
          await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        }
        return tx.address.update({
          where: { id: existing.id },
          data: { ...rest, ...(isDefault !== undefined ? { isDefault } : {}) },
        });
      });

      return reply.send(ok(toAddressDto(address)));
    }
  );

  server.delete(
    "/me/addresses/:addressId",
    { schema: { params: AddressIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const userId = request.user!.id;
      const existing = await app.prisma.address.findFirst({ where: { id: request.params.addressId, userId } });
      if (!existing) throw new NotFoundError("Adres bulunamadı.");

      await app.prisma.$transaction(async (tx) => {
        await tx.address.delete({ where: { id: existing.id } });

        // §2.2 — varsayılan adres silinirse `seq` en küçük kalan adres varsayılan olur.
        if (existing.isDefault) {
          const next = await tx.address.findFirst({ where: { userId }, orderBy: { seq: "asc" } });
          if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      });

      return reply.code(204).send();
    }
  );

  // ---------- §2.3 Favoriler (wishlist) — `requireModuleEnabled("products")` (§3 guard matrisi):
  // modül kapalıyken TÜM wishlist uçları 404 döner. Sahiplik filtresi, rol guard'ı YOK. ----------

  server.get(
    "/me/wishlist",
    {
      preHandler: requireModuleEnabled("products"),
      schema: { response: { 200: ApiSuccessSchema(z.array(WishlistItemSchema)) } },
    },
    async (request, reply) => {
      // §2.3 — yalnızca GÖRÜNÜR ürünler döner (`deletedAt: null`, `status: PUBLISHED`);
      // silinmiş/taslak ürünün favori satırı DB'de kalır ama listede/sayaçta görünmez.
      const rows = await app.prisma.wishlistItem.findMany({
        where: { userId: request.user!.id, product: { status: "PUBLISHED", deletedAt: null } },
        include: { product: { select: WISHLIST_PRODUCT_SELECT } },
        orderBy: { seq: "desc" },
      });
      return reply.send(ok(rows.map(toWishlistItemDto)));
    }
  );

  server.post(
    "/me/wishlist",
    {
      preHandler: requireModuleEnabled("products"),
      schema: {
        body: AddWishlistItemRequestSchema,
        response: { 200: ApiSuccessSchema(WishlistItemSchema), 201: ApiSuccessSchema(WishlistItemSchema) },
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { productId } = request.body;

      const product = await app.prisma.product.findFirst({ where: { id: productId, status: "PUBLISHED", deletedAt: null } });
      if (!product) throw new NotFoundError("Ürün bulunamadı.");

      // §2.3 — zaten favoriyse İDEMPOTENT 200 döner (409 DEĞİL: kalp ikonuna iki kez basmak hata değildir).
      const existing = await app.prisma.wishlistItem.findUnique({
        where: { userId_productId: { userId, productId } },
        include: { product: { select: WISHLIST_PRODUCT_SELECT } },
      });
      if (existing) {
        return reply.code(200).send(ok(toWishlistItemDto(existing)));
      }

      const count = await app.prisma.wishlistItem.count({ where: { userId } });
      if (count >= MAX_WISHLIST_ITEMS_PER_USER) {
        throw new ConflictError(`En fazla ${MAX_WISHLIST_ITEMS_PER_USER} ürünü favorilere ekleyebilirsiniz.`);
      }

      const created = await app.prisma.wishlistItem.create({
        data: { userId, productId },
        include: { product: { select: WISHLIST_PRODUCT_SELECT } },
      });
      return reply.code(201).send(ok(toWishlistItemDto(created)));
    }
  );

  server.delete(
    "/me/wishlist/:productId",
    {
      preHandler: requireModuleEnabled("products"),
      schema: { params: ProductIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      // §2.3 — kayıt yoksa da 204 (İDEMPOTENT); anahtar `productId`'dir (`wishlistItemId` DEĞİL).
      await app.prisma.wishlistItem.deleteMany({
        where: { userId: request.user!.id, productId: request.params.productId },
      });
      return reply.code(204).send();
    }
  );
}
