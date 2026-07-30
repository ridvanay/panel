import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import { env } from "../config/env";

export default fp(async function securityPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    // Saf JSON API — HTML sunmuyoruz, CSP burada anlamsız ve istemci entegrasyonlarını kırabilir.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true, // refresh token httpOnly cookie için gerekli
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });
});
