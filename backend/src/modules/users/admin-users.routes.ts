import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma, type SiteRole, type SiteUserStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema } from "../../schemas/common";
import { AdminUserSchema } from "../../schemas/entities";
import { toAdminUserDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { hashPassword } from "../../lib/password";
import { createPasswordResetToken } from "../auth/auth.service";
import { logAudit } from "../../lib/audit";
import { env } from "../../config/env";
import {
  AdminUserIdParamSchema,
  CreateAdminUserRequestSchema,
  UpdateAdminUserRoleRequestSchema,
  UpdateAdminUserStatusRequestSchema,
} from "./admin-users.schemas";

const CreateAdminUserResponseSchema = z.object({
  user: AdminUserSchema,
  setPasswordUrl: z.string(),
});

/**
 * Bir kullanıcının hâlâ en az bir aktif ADMIN'in kalıp kalmayacağını kontrol eder.
 * `excludeUserId` üzerinde işlem yapılan kullanıcıdır (rol/durum değişikliği henüz
 * uygulanmadan önce çağrılır, bu yüzden hedef kullanıcı sayıma dahil edilmez).
 *
 * `tx` parametresi ÖNEMLİ: bu her zaman aşağıdaki `update` ile AYNI Serializable
 * transaction içinde çağrılmalıdır. Aksi halde check (count) ve write (update) ayrı
 * ayrı yürütülür ve iki eşzamanlı istek (ör. iki farklı admin'i aynı anda demote/suspend
 * etmek) TOCTOU (check-then-act) race'i ile sistemde sıfır aktif admin bırakabilir.
 */
async function assertNotLastActiveAdmin(tx: Prisma.TransactionClient, excludeUserId: string): Promise<void> {
  const remainingAdmins = await tx.user.count({
    where: { role: "ADMIN", status: "ACTIVE", id: { not: excludeUserId } },
  });
  if (remainingAdmins === 0) {
    throw new ConflictError("Sistemde en az bir yönetici kalmalı.");
  }
}

/**
 * "Son admin kalmadı" kontrolü + update'i tek bir Serializable transaction'da serialize eder.
 * Postgres, Serializable izolasyonda çakışan eşzamanlı transaction'lardan birini
 * P2034 (write conflict) ile reddeder — bunu birkaç kez retry ediyoruz (düşük trafikli
 * bir admin panelinde çakışma son derece nadir, ama olası olduğunda sessizce yanlış
 * sonuca değil, ya başarıya ya da açık bir hataya varmalıyız).
 */
async function runSerializable<T>(
  app: FastifyInstance,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await app.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      const isSerializationConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isSerializationConflict || attempt === attempts) throw err;
    }
  }
  /* istanbul ignore next — döngü ya `return` ya da `throw` ile biter. */
  throw new Error("unreachable");
}

/** `/admin/users` prefix'i altında bağlanır (bkz. app.ts) — tüm uçlar yalnızca ADMIN. */
export async function adminUsersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole("ADMIN"));

  server.get(
    "/",
    { schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(AdminUserSchema)) } } },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.user.findMany({
        where: cursorSeq ? { seq: { gt: cursorSeq } } : {},
        orderBy: { seq: "asc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toAdminUserDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/",
    {
      schema: { body: CreateAdminUserRequestSchema, response: { 201: ApiSuccessSchema(CreateAdminUserResponseSchema) } },
    },
    async (request, reply) => {
      const { name, email, role } = request.body;

      // Kullanılamaz rastgele bir şifre ile oluşturulur; gerçek şifresini aşağıdaki
      // reset token'ıyla kendisi belirler (bkz. createPasswordResetToken).
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

      const user = await app.prisma.user.create({
        data: { name, email: email.toLowerCase(), passwordHash, role: role ?? "EDITOR" },
      });

      const rawToken = await createPasswordResetToken(app, user.id);
      // MVP/dev-only seçim: gerçek bir e-posta sağlayıcısı entegre edilene kadar
      // (bkz. auth.service.ts::forgotPassword TODO) bağlantı response'ta döner ve loglanır.
      const setPasswordUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
      app.log.info({ setPasswordUrl }, "Yeni admin kullanıcı — şifre belirleme bağlantısı (dev-log)");

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.create",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email, role: user.role },
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok({ user: toAdminUserDto(user), setPasswordUrl }));
    }
  );

  server.patch(
    "/:userId/role",
    {
      schema: {
        params: AdminUserIdParamSchema,
        body: UpdateAdminUserRoleRequestSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      const { role } = request.body;
      let previousRole: SiteRole | undefined;

      const user = await runSerializable(app, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: request.params.userId } });
        if (!target) throw new NotFoundError("Kullanıcı bulunamadı.");
        previousRole = target.role;

        if (target.role === "ADMIN" && role !== "ADMIN") {
          await assertNotLastActiveAdmin(tx, target.id);
        }

        return tx.user.update({ where: { id: target.id }, data: { role } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.role_change",
        targetType: "User",
        targetId: user.id,
        metadata: { from: previousRole, to: role },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );

  server.patch(
    "/:userId/status",
    {
      schema: {
        params: AdminUserIdParamSchema,
        body: UpdateAdminUserStatusRequestSchema,
        response: { 200: ApiSuccessSchema(AdminUserSchema) },
      },
    },
    async (request, reply) => {
      if (request.params.userId === request.user!.id) {
        throw new ConflictError("Kendi hesabınızı askıya alamazsınız.");
      }

      const { status } = request.body;
      let previousStatus: SiteUserStatus | undefined;

      const user = await runSerializable(app, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: request.params.userId } });
        if (!target) throw new NotFoundError("Kullanıcı bulunamadı.");
        previousStatus = target.status;

        if (target.role === "ADMIN" && status === "SUSPENDED") {
          await assertNotLastActiveAdmin(tx, target.id);
        }

        return tx.user.update({ where: { id: target.id }, data: { status } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "user.status_change",
        targetType: "User",
        targetId: user.id,
        metadata: { from: previousStatus, to: status },
        ipAddress: request.ip,
      });

      return reply.send(ok(toAdminUserDto(user)));
    }
  );
}
