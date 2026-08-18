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
  // `DELETED` (yumuşak silme, bkz. DELETE /admin/users/{userId}) `SUSPENDED` ile BİREBİR aynı
  // şekilde ele alınır: silinen bir kullanıcı, access token'ının ömrü boyunca sistemi kullanmaya
  // devam edemesin diye (defense-in-depth — silme zaten refresh token'ları iptal eder, ama bu
  // kontrol token iptali eksik/gecikmeli olsa dahi tek başına yeterli bir güvenlik katmanıdır).
  if (user.status === "SUSPENDED" || user.status === "DELETED") {
    throw new ForbiddenError("Hesabınız askıya alınmış.");
  }

  request.user = { id: user.id, email: user.email, role: user.role };
}
