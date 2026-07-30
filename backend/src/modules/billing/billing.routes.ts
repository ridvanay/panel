import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireOrgRole } from "../../middleware/rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, OrgIdParamSchema } from "../../schemas/common";
import { SubscriptionSchema } from "../../schemas/entities";
import { toSubscriptionDto } from "../../mappers";
import * as billingService from "./billing.service";
import {
  BillingPortalResponseSchema,
  CheckoutSessionResponseSchema,
  CreateCheckoutSessionRequestSchema,
} from "./billing.schemas";

/** `/organizations/:orgId/subscription` prefix'i altında bağlanır (bkz. app.ts). */
export default async function billingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      preHandler: requireOrgRole(),
      schema: { params: OrgIdParamSchema, response: { 200: ApiSuccessSchema(SubscriptionSchema) } },
    },
    async (request, reply) => {
      const subscription = await billingService.getSubscription(app, request.params.orgId);
      return reply.send(ok(toSubscriptionDto(subscription)));
    }
  );

  server.post(
    "/checkout-session",
    {
      preHandler: requireOrgRole("OWNER"),
      schema: {
        params: OrgIdParamSchema,
        body: CreateCheckoutSessionRequestSchema,
        response: { 200: ApiSuccessSchema(CheckoutSessionResponseSchema) },
      },
    },
    async (request, reply) => {
      const checkoutUrl = await billingService.createCheckoutSession(app, request.params.orgId, request.body);
      return reply.send(ok({ checkoutUrl }));
    }
  );

  server.post(
    "/portal-session",
    {
      preHandler: requireOrgRole("OWNER"),
      schema: { params: OrgIdParamSchema, response: { 200: ApiSuccessSchema(BillingPortalResponseSchema) } },
    },
    async (request, reply) => {
      const portalUrl = await billingService.createPortalSession(app, request.params.orgId);
      return reply.send(ok({ portalUrl }));
    }
  );
}
