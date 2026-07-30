import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { env } from "./config/env";

import prismaPlugin from "./plugins/prisma";
import securityPlugin from "./plugins/security";
import errorHandlerPlugin from "./plugins/error-handler";
import uploadsPlugin from "./plugins/uploads";

import healthRoutes from "./modules/health/health.routes";
import authRoutes from "./modules/auth/auth.routes";
import usersRoutes from "./modules/users/users.routes";
import { adminUsersRoutes } from "./modules/users/admin-users.routes";
import { logsRoutes } from "./modules/logs/logs.routes";
import organizationsRoutes from "./modules/organizations/organizations.routes";
import membersRoutes from "./modules/members/members.routes";
import { acceptInvitationRoutes, orgInvitationsRoutes } from "./modules/invitations/invitations.routes";
import plansRoutes from "./modules/plans/plans.routes";
import billingRoutes from "./modules/billing/billing.routes";
import stripeWebhookRoutes from "./modules/webhooks/stripe.routes";
import { adminPagesRoutes, publicPagesRoutes } from "./modules/pages/pages.routes";
import { adminBlogCategoriesRoutes, adminBlogPostsRoutes, publicBlogRoutes } from "./modules/blog/blog.routes";
import { adminMediaRoutes } from "./modules/media/media.routes";
import { adminStatsRoutes } from "./modules/stats/stats.routes";
import { adminSettingsRoutes, publicSettingsRoutes } from "./modules/settings/settings.routes";
import { adminNavigationRoutes, publicNavigationRoutes } from "./modules/navigation/navigation.routes";
import { systemRoutes } from "./modules/system/system.routes";

export function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.NODE_ENV === "production" ? "info" : "debug",
            transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
          },
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Sıra önemli: hata yakalayıcı ve güvenlik eklentileri route'lardan önce kayıtlı olmalı.
  app.register(errorHandlerPlugin);
  app.register(securityPlugin);
  app.register(prismaPlugin);
  app.register(uploadsPlugin);

  app.register(healthRoutes, { prefix: "/api/v1" });

  app.register(
    async (api) => {
      api.register(authRoutes, { prefix: "/auth" });
      api.register(usersRoutes, { prefix: "/users" });
      api.register(adminUsersRoutes, { prefix: "/admin/users" });
      api.register(logsRoutes, { prefix: "/admin/logs" });
      api.register(organizationsRoutes, { prefix: "/organizations" });
      api.register(membersRoutes, { prefix: "/organizations/:orgId/members" });
      api.register(orgInvitationsRoutes, { prefix: "/organizations/:orgId/invitations" });
      api.register(acceptInvitationRoutes, { prefix: "/invitations" });
      api.register(plansRoutes, { prefix: "/plans" });
      api.register(billingRoutes, { prefix: "/organizations/:orgId/subscription" });
      api.register(publicPagesRoutes, { prefix: "/pages" });
      api.register(adminPagesRoutes, { prefix: "/admin/pages" });
      api.register(publicBlogRoutes, { prefix: "/blog" });
      api.register(adminBlogPostsRoutes, { prefix: "/admin/blog" });
      api.register(adminBlogCategoriesRoutes, { prefix: "/admin/blog/categories" });
      api.register(adminMediaRoutes, { prefix: "/admin/media" });
      api.register(adminStatsRoutes, { prefix: "/admin/stats" });
      api.register(publicSettingsRoutes, { prefix: "/settings" });
      api.register(adminSettingsRoutes, { prefix: "/admin/settings" });
      api.register(publicNavigationRoutes, { prefix: "/navigation" });
      api.register(adminNavigationRoutes, { prefix: "/admin/navigation" });
      // Route içinde `/health` path'i tanımlanır, nihai uç `/admin/health` olur.
      api.register(systemRoutes, { prefix: "/admin" });
      // Kendi content-type parser'ını (raw body) kaydeder — kendi encapsulation
      // context'inde kaldığı için diğer /api/v1 uçlarının JSON parse'ını etkilemez.
      api.register(stripeWebhookRoutes, { prefix: "/webhooks/stripe" });
    },
    { prefix: "/api/v1" }
  );

  return app;
}
