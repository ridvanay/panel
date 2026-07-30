import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";

export default fp(async function prismaPlugin(app: FastifyInstance) {
  const prisma = new PrismaClient({
    log: app.log.level === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  });

  await prisma.$connect();

  app.decorate("prisma", prisma);

  app.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
});
