import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/jwt";
import { UnauthorizedError } from "../lib/errors";

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    request.user = { id: payload.sub, email: payload.email };
  } catch {
    throw new UnauthorizedError("Geçersiz veya süresi dolmuş erişim token'ı.");
  }
}
