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
import { adminBlogCategoriesRoutes, adminBlogPostsRoutes, adminBlogTagsRoutes, publicBlogRoutes } from "./modules/blog/blog.routes";
import { adminProductCategoriesRoutes, adminProductsRoutes, publicProductsRoutes } from "./modules/products/products.routes";
import { adminPortfolioCategoriesRoutes, adminPortfolioRoutes, publicPortfolioRoutes } from "./modules/portfolio/portfolio.routes";
import { adminSlidersRoutes, publicSlidersRoutes } from "./modules/sliders/sliders.routes";
import { adminMediaRoutes } from "./modules/media/media.routes";
import { adminStatsRoutes } from "./modules/stats/stats.routes";
import { adminSettingsRoutes, publicSettingsRoutes } from "./modules/settings/settings.routes";
import { adminAppearanceRoutes, publicAppearanceRoutes } from "./modules/appearance/appearance.routes";
import { adminDemoTemplatesRoutes } from "./modules/demo-templates/demo-templates.routes";
import { adminSiteModulesRoutes, publicModulesRoutes } from "./modules/site-modules/site-modules.routes";
import { adminNavigationRoutes, publicNavigationRoutes } from "./modules/navigation/navigation.routes";
import { adminLocalesRoutes, publicLocalesRoutes } from "./modules/localization/localization.routes";
import { systemRoutes } from "./modules/system/system.routes";
import { emailTemplatesRoutes } from "./modules/email-templates/email-templates.routes";
import { adminContactRoutes, publicContactRoutes } from "./modules/contact/contact.routes";
import { registerContactRetentionScheduler } from "./lib/contact-retention";
import { securityTwoFactorRoutes, securitySessionsRoutes } from "./modules/security/security.routes";
import { adminImportRoutes } from "./modules/import/import.routes";
import { recoverStuckImportJobs } from "./modules/import/import.worker";
import { registerImportRetentionScheduler } from "./modules/import/import.retention";
import { adminReportsRoutes } from "./modules/reports/reports.routes";
import { recoverStuckExportJobs } from "./modules/reports/reports.worker";
import { registerExportRetentionScheduler } from "./modules/reports/reports.retention";
import { registerScheduledPublishSweeper } from "./lib/scheduled-publish";
import { cartRoutes } from "./modules/cart/cart.routes";
import { checkoutRoutes } from "./modules/checkout/checkout.routes";
import { ordersRoutes } from "./modules/orders/orders.routes";
import { registerCartRetentionSweeper } from "./lib/cart-retention";
import { apiKeysRoutes } from "./modules/api-keys/api-keys.routes";
import { outboundWebhooksRoutes } from "./modules/outbound-webhooks/outbound-webhooks.routes";
import { publicApiRoutes } from "./modules/public-api/public-api.routes";
import { registerWebhookDispatcher, recoverStuckWebhookDeliveries } from "./modules/outbound-webhooks/outbound-webhooks.dispatcher";
import { registerWebhookDeliveryRetentionScheduler } from "./modules/outbound-webhooks/outbound-webhooks.retention";

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
                // §10.13.3/§10.13.9 — API anahtarının/webhook secret'ının düz metin hâli YALNIZCA
                // ilgili 201/200 yanıtında bir kez döner; loglara ASLA yansımamalıdır.
                "plainKey",
                "plainSecret",
                "*.plainKey",
                "*.plainSecret",
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
      api.register(adminBlogTagsRoutes, { prefix: "/admin/blog/tags" });
      // §10.9.2 Ürünler Modülü — public uçlar `requireModuleEnabled("products")` ile korunur
      // (bkz. products.routes.ts), admin uçları modül durumundan BAĞIMSIZ her zaman çalışır.
      api.register(publicProductsRoutes, { prefix: "/products" });
      api.register(adminProductsRoutes, { prefix: "/admin/products" });
      api.register(adminProductCategoriesRoutes, { prefix: "/admin/products/categories" });
      // §10.9.4 Portföy Modülü — `products` ile AYNI desen: public uçlar
      // `requireModuleEnabled("portfolio")` ile korunur (bkz. portfolio.routes.ts), admin uçları
      // modül durumundan BAĞIMSIZ her zaman çalışır.
      api.register(publicPortfolioRoutes, { prefix: "/portfolio" });
      api.register(adminPortfolioRoutes, { prefix: "/admin/portfolio" });
      api.register(adminPortfolioCategoriesRoutes, { prefix: "/admin/portfolio/categories" });
      // Gelişmiş Slider / Hero Studio — bkz. .claude/architect-scope-advanced-slider.md §1.6:
      // `MODULE_REGISTRY`'ye EKLENMEZ (çekirdek bir araçtır), admin uçları da `requireModuleEnabled`
      // GEREKTİRMEZ. Public uç slug DEĞİL `sliderId` (uuid) ile erişilir.
      api.register(publicSlidersRoutes, { prefix: "/sliders" });
      api.register(adminSlidersRoutes, { prefix: "/admin/sliders" });
      api.register(adminMediaRoutes, { prefix: "/admin/media" });
      api.register(adminStatsRoutes, { prefix: "/admin/stats" });
      api.register(publicSettingsRoutes, { prefix: "/settings" });
      api.register(adminSettingsRoutes, { prefix: "/admin/settings" });
      // §10.12 Site Özelleştirme — bkz. ARCHITECTURE.md §10.12. `/admin/settings` NASIL ÇALIŞTIĞI,
      // bu ise NASIL GÖRÜNDÜĞÜ (rota sınırı §10.12.1).
      api.register(publicAppearanceRoutes, { prefix: "/appearance" });
      api.register(adminAppearanceRoutes, { prefix: "/admin/appearance" });
      // 1 Tıkla Hazır Demo / Şablon İçe Aktarıcı — bkz.
      // .claude/architect-scope-demo-template-import.md §1.4 (appearance kayıtlarından SONRA).
      api.register(adminDemoTemplatesRoutes, { prefix: "/admin/demo-templates" });
      api.register(publicNavigationRoutes, { prefix: "/navigation" });
      api.register(adminNavigationRoutes, { prefix: "/admin/navigation" });
      // §10.5 Çoklu Dil & Yerelleştirme — bkz. .claude/architect-scope-i18n.md.
      api.register(publicLocalesRoutes, { prefix: "/locales" });
      api.register(adminLocalesRoutes, { prefix: "/admin/locales" });
      // §10.9 Eklenti/Modül Yönetimi — bkz. ARCHITECTURE.md §10.9.
      api.register(publicModulesRoutes, { prefix: "/modules" });
      api.register(adminSiteModulesRoutes, { prefix: "/admin/modules" });
      // Route içinde `/health` path'i tanımlanır, nihai uç `/admin/health` olur.
      api.register(systemRoutes, { prefix: "/admin" });
      api.register(emailTemplatesRoutes, { prefix: "/admin/notifications/templates" });
      // §10.16 İletişim Formu — PUBLIC `/contact/*` kimlik doğrulama GEREKTİRMEZ; admin
      // `/admin/contact/*` form yapılandırması ADMIN-only, gönderim okuma ADMIN/EDITOR (bkz.
      // contact.routes.ts). Bir MODÜL DEĞİLDİR (MODULE_REGISTRY'ye eklenmez, §10.16.7).
      api.register(publicContactRoutes, { prefix: "/contact" });
      api.register(adminContactRoutes, { prefix: "/admin/contact" });
      // §10.4 Güvenlik & 2FA + Aktif Oturumlar — bkz. ARCHITECTURE.md §10.4.
      api.register(securityTwoFactorRoutes, { prefix: "/admin/settings/security/2fa" });
      api.register(securitySessionsRoutes, { prefix: "/admin/settings/security/sessions" });
      // §10.8 Toplu İçe Aktarma (Import) — bkz. ARCHITECTURE.md §10.8.
      api.register(adminImportRoutes, { prefix: "/admin/import/jobs" });
      // §10.8.10 Analitik Rapor Dışa Aktarma (Export) — bkz. ARCHITECTURE.md §10.8.10.
      api.register(adminReportsRoutes, { prefix: "/admin/reports/exports" });
      // §10.9.3 Sepet + Stripe Checkout — PUBLIC, `requireModuleEnabled("products")` guard'lı
      // (bkz. cart.routes.ts/checkout.routes.ts). Admin sipariş yönetimi modül durumundan
      // BAĞIMSIZDIR (veri korunumu, `adminProductsRoutes` ile AYNI karar).
      api.register(cartRoutes, { prefix: "/cart" });
      api.register(checkoutRoutes, { prefix: "/checkout" });
      api.register(ordersRoutes, { prefix: "/admin/orders" });
      // Kendi content-type parser'ını (raw body) kaydeder — kendi encapsulation
      // context'inde kaldığı için diğer /api/v1 uçlarının JSON parse'ını etkilemez.
      api.register(stripeWebhookRoutes, { prefix: "/webhooks/stripe" });
      // §10.13 Üçüncü Parti Entegrasyon: API Anahtarları + Public API + Giden Webhook'lar — bkz.
      // ARCHITECTURE.md §10.13. `apiKeysRoutes`/`outboundWebhooksRoutes` yalnızca SiteRole=ADMIN
      // (okuma dahil). `publicApiRoutes` TAMAMEN AYRI bir kimlik doğrulama katmanıdır (`X-Api-Key`,
      // bkz. middleware/api-key-auth.ts) — nihai yol `/api/v1/public/*`. DİKKAT: `outboundWebhooksRoutes`
      // (GİDEN, biz dışarıya POST atarız) `stripeWebhookRoutes` (GELEN, Stripe bize POST atar) İLE
      // KARIŞTIRILMAMALI — bkz. §10.13 isimlendirme çakışması uyarısı.
      api.register(apiKeysRoutes, { prefix: "/admin/settings/api-keys" });
      api.register(outboundWebhooksRoutes, { prefix: "/admin/settings/webhooks" });
      api.register(publicApiRoutes, { prefix: "/public" });
    },
    { prefix: "/api/v1" }
  );

  // §10.8.1 çökme/restart kurtarma (ZORUNLU) — `QUEUED`/`PROCESSING`'de kalmış içe aktarma
  // işleri sunucu her açılışında `FAILED` yapılır. Kök `app` üzerinde (encapsulated route
  // context'i DEĞİL) kayıtlıdır ki `app.prisma`'ya erişebilsin ve tüm plugin ağacı hazır
  // olduktan hemen sonra, dinlemeye başlamadan ÖNCE çalışsın (bkz. ARCHITECTURE.md §10.8.1 —
  // bu hook OLMADAN işler sonsuza dek `PROCESSING`'de asılı kalır ve UI sonsuz poll eder).
  app.addHook("onReady", async () => {
    // devops-agent bulgusu (2026-08-17, docker-compose lokal deploy) — bu 5 grup BİRBİRİNDEN
    // TAMAMEN BAĞIMSIZ alt sistemlerdir (import/export/scheduled-publish/cart/webhook); hiçbiri
    // diğerinin çalışması için ön koşul DEĞİLDİR. Önceden hiçbir try/catch olmadan art arda
    // `await` edildiklerinden, HERHANGİ birindeki geçici bir hata (örn. migration henüz
    // uygulanmadan container ayağa kalkarsa bir tablo eksik olabilir) `onReady` hook'unu reddedip
    // `server.ts`'teki `app.listen()`'i düşürüyor ve process.exit(1) ile TÜM backend'i (ilgisiz
    // 7 alt sistem + tüm route'lar dahil) öldürüyordu. Her grup kendi try/catch'i içinde
    // izole edilir: bir gruptaki hata SADECE o grubu (o oturum için) devre dışı bırakır
    // (graceful degradation — sessiz DEĞİL, `app.log.error` ile mutlaka loglanır, bkz. proje
    // CLAUDE.md § Kurallar madde 6/observability-agent), sunucunun geri kalanının açılmasını
    // ASLA engellemez.
    try {
      await recoverStuckImportJobs(app);

      // §10.8.8.1 compliance-agent kararı (2026-08-05, BLOCKER) — 30 günlük PII redaksiyonu +
      // 90 günlük ImportJob saklama süresi GERÇEK ZAMAN-TETİKLEMELİ uygulanır (bir sonraki
      // yüklemeye bağlı tembel tetikleme KABUL EDİLEMEZ, bkz. import.retention.ts). `app.prisma`
      // yalnızca burada (onReady, tüm plugin ağacı yüklendikten SONRA) güvenle kullanılabilir —
      // `recoverStuckImportJobs` ile AYNI gerekçe. `onClose` ile kendi interval'ını temizler.
      registerImportRetentionScheduler(app);
    } catch (err) {
      app.log.error({ err }, "İçe aktarma (import) kurtarma/scheduler kurulumu başarısız oldu — bu oturumda içe aktarma alt sistemi eksik kalabilir.");
    }

    try {
      // §10.8.10 Analitik Rapor Dışa Aktarma (Export) — `recoverStuckImportJobs` ile AYNI
      // gerekçeyle `onReady`'de: `PROCESSING`'de kalmış işleri `FAILED`e çevirir VE `PENDING`
      // işleri (in-process kuyruk restart'ta kaybolduğu için) yeniden kuyruğa alır.
      await recoverStuckExportJobs(app);
      registerExportRetentionScheduler(app);
    } catch (err) {
      app.log.error({ err }, "Dışa aktarma (export) kurtarma/scheduler kurulumu başarısız oldu — bu oturumda dışa aktarma alt sistemi eksik kalabilir.");
    }

    try {
      // İçerik editörü Faz 4 (zamanlanmış yayın) — `registerImportRetentionScheduler`/
      // `registerExportRetentionScheduler` ile AYNI gerekçeyle `onReady`'de: `app.prisma`
      // yalnızca burada (tüm plugin ağacı yüklendikten SONRA) güvenle kullanılabilir. Açılışta
      // hemen bir kez çalışır ki uzun süre kapalı kalmış bir sunucuda bekleyen zamanlamalar
      // dakikalık turu beklemeden anında yayınlansın (bkz. lib/scheduled-publish.ts).
      registerScheduledPublishSweeper(app);
    } catch (err) {
      app.log.error({ err }, "Zamanlanmış yayın (scheduled-publish) sweeper kurulumu başarısız oldu — bu oturumda bekleyen zamanlamalar süpürülmeyebilir.");
    }

    try {
      // §10.9.3 Sepet + Stripe Checkout — `registerImportRetentionScheduler`/
      // `registerScheduledPublishSweeper` ile AYNI gerekçeyle `onReady`'de: süresi geçmiş
      // sepetleri sessizce temizler (bkz. lib/cart-retention.ts).
      registerCartRetentionSweeper(app);
    } catch (err) {
      app.log.error({ err }, "Sepet (cart) saklama süresi sweeper kurulumu başarısız oldu — bu oturumda süresi geçmiş sepetler temizlenmeyebilir.");
    }

    try {
      // §10.13.8 Giden Webhook'lar — `recoverStuckImportJobs` İLE AYNI gerekçe: `SENDING`'de
      // kalmış teslimatlar sunucu her açılışında `RETRYING`'e çevrilir (çökme/restart kurtarması,
      // §10.8.1 deseni). `app.prisma` yalnızca burada (onReady, tüm plugin ağacı yüklendikten
      // SONRA) güvenle kullanılabilir.
      await recoverStuckWebhookDeliveries(app);
      registerWebhookDispatcher(app);
      registerWebhookDeliveryRetentionScheduler(app);
    } catch (err) {
      app.log.error({ err }, "Giden webhook kurtarma/dispatcher/scheduler kurulumu başarısız oldu — bu oturumda webhook alt sistemi eksik kalabilir.");
    }

    try {
      // §10.16.10 İletişim Formu PII saklama/redaksiyon — `registerImportRetentionScheduler` ile
      // AYNI gerekçeyle `onReady`'de, kendi izole try/catch bloğunda (6. grup): `app.prisma`
      // yalnızca burada (tüm plugin ağacı yüklendikten SONRA) güvenle kullanılabilir. Açılışta
      // hemen bir kez çalışır ki uzun süre kapalı kalmış bir sunucuda 30/180 günlük eşikler bir
      // sonraki saatlik turu beklemeden uygulansın (bkz. lib/contact-retention.ts).
      registerContactRetentionScheduler(app);
    } catch (err) {
      app.log.error({ err }, "İletişim formu saklama süresi scheduler kurulumu başarısız oldu — bu oturumda süresi geçmiş gönderimler temizlenmeyebilir.");
    }
  });

  return app;
}
