import type { FastifyInstance } from "fastify";

export default async function healthRoutes(app: FastifyInstance) {
  app.get("/healthz", async (_request, reply) => {
    reply.send({ status: "ok" });
  });
}
