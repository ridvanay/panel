import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/jwt";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

/**
 * Rol/durum kasıtlı olarak JWT'ye GÖMÜLMEZ (güvenlik kararı): rol değişikliği veya
 * askıya alma, o kullanıcının mevcut access token'ı süresi dolana kadar beklemeden
 * bir sonraki istekte hemen etkili olsun diye her istekte DB'den taze okunur.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new UnauthorizedError("Geçersiz veya süresi dolmuş erişim token'ı.");
  }

  const user = await request.server.prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!user) throw new UnauthorizedError();
  if (user.status === "SUSPENDED") throw new ForbiddenError("Hesabınız askıya alınmış.");

  request.user = { id: user.id, email: user.email, role: user.role };
}
