import type { FastifyInstance } from "fastify";
import { emitWebhookEvent } from "./webhook-emitter";
import { toPublicBlogPostDto, toPublicPageDto, toPublicPortfolioItemDto } from "../modules/public-api/public-api.mappers";

/**
 * `import.retention.ts::IMPORT_RETENTION_SWEEP_INTERVAL_MS` İLE AYNI DESEN/GEREKÇE — gerçek
 * zaman-tetiklemeli, dakikalık kontrol (bir dakikalık zamanlama gecikmesi kabul edilebilir,
 * bkz. ARCHITECTURE.md Faz 4 zamanlanmış yayın notu).
 */
export const SCHEDULED_PUBLISH_SWEEP_INTERVAL_MS = 60 * 1000;

export interface ScheduledPublishSweepResult {
  publishedPages: number;
  publishedBlogPosts: number;
  publishedProducts: number;
  publishedPortfolioItems: number;
}

/**
 * Faz 4 (zamanlanmış yayın) — `Page`/`BlogPost`/`Product`/`PortfolioItem` ortak süreç-içi
 * yayınlama taraması. `status: "SCHEDULED"` ve `scheduledAt <= now()` olan satırları TEK bir
 * `updateMany` ile (satır satır DEĞİL — BATCH) `status: "PUBLISHED"`, `publishedAt: now()`,
 * `scheduledAt: null` yapar. Dört model de ayrı tablolar olduğu için ayrı `updateMany` gerekir,
 * ama iş mantığı BİREBİR aynı olduğundan kod tekrarını önlemek için TEK fonksiyonda toplanır
 * (blog.routes.ts, pages.routes.ts, products.routes.ts, portfolio.routes.ts'in ayrı sweeper'lara
 * ihtiyacı YOK). İDEMPOTENT'tir — zaten yayınlanmış satırlarda `where` filtresi
 * (status: "SCHEDULED") sayesinde no-op.
 */
export async function runScheduledPublishSweep(app: FastifyInstance): Promise<ScheduledPublishSweepResult> {
  const now = new Date();
  const dueWhere = { status: "SCHEDULED" as const, scheduledAt: { lte: now } };

  // §10.13.8 — `PAGE_PUBLISHED`/`BLOG_POST_PUBLISHED`/`PORTFOLIO_ITEM_PUBLISHED` bu sweeper'dan da
  // tetiklenir (bkz. emisyon noktaları tablosu). `Product`'ın karşılığı YOKTUR — `PRODUCT_*`
  // olayları BİLİNÇLİ olarak yalnızca `products.routes.ts` CRUD uçlarından tetiklenir, sweeper'dan
  // DEĞİL (o üçlü publish-transition'a değil doğrudan CRUD yaşam döngüsüne bağlıdır).
  const [duePages, dueBlogPosts, duePortfolioItems] = await Promise.all([
    app.prisma.page.findMany({ where: dueWhere }),
    app.prisma.blogPost.findMany({ where: dueWhere, include: { category: true } }),
    app.prisma.portfolioItem.findMany({ where: dueWhere, include: { category: true, coverMedia: true, images: { include: { media: true }, orderBy: { order: "asc" } } } }),
  ]);

  const [pages, blogPosts, products, portfolioItems] = await Promise.all([
    app.prisma.page.updateMany({
      where: dueWhere,
      data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null },
    }),
    app.prisma.blogPost.updateMany({
      where: dueWhere,
      data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null },
    }),
    app.prisma.product.updateMany({
      where: dueWhere,
      data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null },
    }),
    app.prisma.portfolioItem.updateMany({
      where: dueWhere,
      data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null },
    }),
  ]);

  for (const page of duePages) {
    await emitWebhookEvent(app, "PAGE_PUBLISHED", toPublicPageDto({ ...page, status: "PUBLISHED", publishedAt: now, scheduledAt: null }));
  }
  for (const post of dueBlogPosts) {
    await emitWebhookEvent(
      app,
      "BLOG_POST_PUBLISHED",
      toPublicBlogPostDto({ ...post, status: "PUBLISHED", publishedAt: now, scheduledAt: null })
    );
  }
  for (const item of duePortfolioItems) {
    await emitWebhookEvent(
      app,
      "PORTFOLIO_ITEM_PUBLISHED",
      toPublicPortfolioItemDto({ ...item, status: "PUBLISHED", publishedAt: now, scheduledAt: null })
    );
  }

  return {
    publishedPages: pages.count,
    publishedBlogPosts: blogPosts.count,
    publishedProducts: products.count,
    publishedPortfolioItems: portfolioItems.count,
  };
}

/**
 * `import.retention.ts::registerImportRetentionScheduler` İLE AYNI GEREKÇE/DESEN — gerçek
 * zaman-tetiklemeli süreç-içi `setInterval` (kuyruk/cron altyapısı YOK), açılışta hemen bir kez
 * çalışır (uzun süre kapalı kalmış bir sunucuda bekleyen zamanlamaların bir sonraki dakikalık
 * turu beklemeden anında yakalanması için), ardından her `SCHEDULED_PUBLISH_SWEEP_INTERVAL_MS`'de
 * bir tekrarlanır. `app.addHook("onClose", ...)` ile interval temizlenir — aksi hâlde
 * (özellikle testlerde, her `buildTestApp()` çağrısı yeni bir interval açar) süreç/test
 * process'i sonsuza dek canlı kalırdı.
 */
export function registerScheduledPublishSweeper(app: FastifyInstance): void {
  const runSweep = () => {
    runScheduledPublishSweep(app).catch((err) => {
      app.log.error({ err }, "Zamanlanmış yayın taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, SCHEDULED_PUBLISH_SWEEP_INTERVAL_MS);
  // Testlerde/kısa ömürlü process'lerde bu timer'ın event loop'u canlı tutmasını önler
  // (üretimde etkisi yoktur — process zaten sürekli açık kalır).
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
