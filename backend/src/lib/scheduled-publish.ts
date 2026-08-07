import type { FastifyInstance } from "fastify";

/**
 * `import.retention.ts::IMPORT_RETENTION_SWEEP_INTERVAL_MS` İLE AYNI DESEN/GEREKÇE — gerçek
 * zaman-tetiklemeli, dakikalık kontrol (bir dakikalık zamanlama gecikmesi kabul edilebilir,
 * bkz. ARCHITECTURE.md Faz 4 zamanlanmış yayın notu).
 */
export const SCHEDULED_PUBLISH_SWEEP_INTERVAL_MS = 60 * 1000;

export interface ScheduledPublishSweepResult {
  publishedPages: number;
  publishedBlogPosts: number;
}

/**
 * Faz 4 (zamanlanmış yayın) — `Page`/`BlogPost` ortak süreç-içi yayınlama taraması.
 * `status: "SCHEDULED"` ve `scheduledAt <= now()` olan satırları TEK bir `updateMany` ile
 * (satır satır DEĞİL — BATCH) `status: "PUBLISHED"`, `publishedAt: now()`, `scheduledAt: null`
 * yapar. `Page` ve `BlogPost` ayrı tablolar olduğu için iki ayrı `updateMany` gerekir, ama iş
 * mantığı BİREBİR aynı olduğundan kod tekrarını önlemek için TEK fonksiyonda toplanır (blog.routes.ts
 * ve pages.routes.ts'in ayrı sweeper'lara ihtiyacı YOK). İDEMPOTENT'tir — zaten yayınlanmış
 * satırlarda `where` filtresi (status: "SCHEDULED") sayesinde no-op.
 */
export async function runScheduledPublishSweep(app: FastifyInstance): Promise<ScheduledPublishSweepResult> {
  const now = new Date();

  const [pages, blogPosts] = await Promise.all([
    app.prisma.page.updateMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now } },
      data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null },
    }),
    app.prisma.blogPost.updateMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now } },
      data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null },
    }),
  ]);

  return { publishedPages: pages.count, publishedBlogPosts: blogPosts.count };
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
