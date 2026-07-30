import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { PlanSchema } from "../../schemas/entities";
import { toPlanDto } from "../../mappers";

export default async function plansRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(PlanSchema)) } } },
    async (_request, reply) => {
      const plans = await app.prisma.plan.findMany({
        where: { isActive: true },
        orderBy: { priceMonthlyCents: "asc" },
      });
      return reply.send(ok(plans.map(toPlanDto)));
    }
  );
}
