import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { env } from "./config/env";
import { initSentry } from "./lib/sentry";

import prismaPlugin from "./plugins/prisma";
import securityPlugin from "./plugins/security";
import errorHandlerPlugin from "./plugins/error-handler";
import requestIdPlugin from "./plugins/request-id";
import uploadsPlugin, { MAX_UPLOAD_BYTES } from "./plugins/uploads";

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
import { emailTemplatesRoutes } from "./modules/email-templates/email-templates.routes";
import { securityTwoFactorRoutes, securitySessionsRoutes } from "./modules/security/security.routes";

export function buildApp() {
  // `SENTRY_DSN` tanımsızsa no-op (bkz. lib/sentry.ts) — her `buildApp()` çağrısında
  // (test dahil) güvenle tekrar çağrılabilir, Sentry SDK'sı çoklu init'i kendi içinde tolere eder.
  initSentry();

  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.NODE_ENV === "production" ? "info" : "debug",
            transport: env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
            // Güvenlik ağı (defense-in-depth) — Fastify'ın varsayılan `req` serializer'ı zaten
            // header'ları (authorization/cookie dahil) HİÇ loglamaz (bkz. node_modules/fastify/
            // lib/logger.js — sadece method/url/hostname/remoteAddress), bu yüzden onlar için
            // ayrı bir redact GEREKMEZ. admin-users.routes.ts / invitations.routes.ts artık ham
            // `setPasswordUrl`/`acceptUrl` içeren HİÇBİR `log.info({...})` çağrısı YAPMIYOR
            // (bkz. security-agent kararı — token sızıntısı temizliği, gerçek gönderim artık
            // email-templates.service.ts üzerinden yapılıyor). Aşağıdaki path'ler yine de
            // ikinci savunma katmanı olarak kalır — ileride biri yanlışlıkla `request.body`'yi
            // veya benzer bir token/URL alanını loglarsa maskeler. `censor` ile değer tamamen
            // gizlenir, anahtar adı log'da kalır (hangi alanın redakte edildiği hâlâ görülebilir,
            // ama değeri asla).
            redact: {
              paths: [
                "setPasswordUrl",
                "acceptUrl",
                "password",
                "newPassword",
                "currentPassword",
                "token",
                "rawToken",
                "refreshToken",
                "accessToken",
                "*.setPasswordUrl",
                "*.acceptUrl",
                "*.password",
                "*.newPassword",
                "*.currentPassword",
                "*.token",
                "*.rawToken",
                "*.refreshToken",
                "*.accessToken",
              ],
              censor: "[REDACTED]",
            },
          },
    // Güvenli varsayım: production'da önde henüz gerçek bir reverse-proxy tanımlı değilse
    // (bkz. docker-compose.yml — backend doğrudan host portuna map ediliyor) `false` kalmalı.
    // bkz. config/env.ts::TRUST_PROXY.
    trustProxy: env.TRUST_PROXY,
    // Trace correlation (bkz. proje kökü CLAUDE.md § Kurallar) — istemci `x-request-id`
    // header'ı gönderirse Fastify onu `request.id` olarak kabul eder (bkz. plugins/request-id.ts
    // bu id'yi response header'ında geri yansıtır), göndermezse burada üretilen bir UUID kullanılır.
    // Varsayılan `genReqId` (basit process-içi sayaç, bkz. node_modules/fastify/lib/
    // reqIdGenFactory.js) süreç yeniden başladığında sıfırlanır ve birden fazla instance'ta
    // çakışabilir — dağıtık log korelasyonu için uygun değildir.
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    // Fastify'ın varsayılan bodyLimit'i (1 MiB) plugins/uploads.ts'teki multipart `fileSize`
    // limitinden (MAX_UPLOAD_BYTES, 5MB) küçük — bu yüzden 1MB'ı aşan HER yükleme, multipart
    // parser'a hiç ulaşmadan Fastify core tarafından 413 ile reddediliyordu. Tek kaynaktan
    // (MAX_UPLOAD_BYTES) türetip multipart alan adları/boundary overhead'i için pay bırakıyoruz.
    bodyLimit: MAX_UPLOAD_BYTES + 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Sıra önemli: hata yakalayıcı ve güvenlik eklentileri route'lardan önce kayıtlı olmalı.
  app.register(errorHandlerPlugin);
  app.register(securityPlugin);
  app.register(requestIdPlugin);
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
      api.register(emailTemplatesRoutes, { prefix: "/admin/notifications/templates" });
      // §10.4 Güvenlik & 2FA + Aktif Oturumlar — bkz. ARCHITECTURE.md §10.4.
      api.register(securityTwoFactorRoutes, { prefix: "/admin/settings/security/2fa" });
      api.register(securitySessionsRoutes, { prefix: "/admin/settings/security/sessions" });
      // Kendi content-type parser'ını (raw body) kaydeder — kendi encapsulation
      // context'inde kaldığı için diğer /api/v1 uçlarının JSON parse'ını etkilemez.
      api.register(stripeWebhookRoutes, { prefix: "/webhooks/stripe" });
    },
    { prefix: "/api/v1" }
  );

  return app;
}
