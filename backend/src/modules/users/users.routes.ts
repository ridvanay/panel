import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { UserSchema } from "../../schemas/entities";
import { toUserDto } from "../../mappers";
import { NotFoundError } from "../../lib/errors";
import { UpdateUserRequestSchema } from "./users.schemas";

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
}
