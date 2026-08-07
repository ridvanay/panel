import type { FastifyInstance } from "fastify";

/**
 * `import.retention.ts::IMPORT_RETENTION_SWEEP_INTERVAL_MS` / `scheduled-publish.ts::
 * SCHEDULED_PUBLISH_SWEEP_INTERVAL_MS` İLE AYNI DESEN — gerçek zaman-tetiklemeli, dakikalık
 * kontrol yeterli hassasiyette (bir dakikalık gecikme terk edilmiş sepetler için önemsiz).
 */
export const CART_RETENTION_SWEEP_INTERVAL_MS = 60 * 1000;

export interface CartRetentionSweepResult {
  deletedCarts: number;
}

/**
 * §10.9.3 Sepet + Stripe Checkout — süresi geçmiş (`expiresAt < now()`) sepetleri SESSİZCE
 * siler. `CartItem` `onDelete: Cascade` olduğundan çocuk satırlar otomatik gider (bkz.
 * prisma/schema.prisma::CartItem). Kullanıcıya bildirim YOK (bkz. görev notu — kullanıcı kararı,
 * terk edilmiş bir sepetin süresi dolduğunda sessizce kaybolması e-ticaret sitelerinde standart
 * davranıştır). İDEMPOTENT'tir — zaten silinmiş satırlarda no-op.
 */
export async function runCartRetentionSweep(app: FastifyInstance): Promise<CartRetentionSweepResult> {
  const result = await app.prisma.cart.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { deletedCarts: result.count };
}

/**
 * `registerImportRetentionScheduler`/`registerScheduledPublishSweeper` İLE AYNI GEREKÇE/DESEN —
 * süreç-içi basit `setInterval` (kuyruk/cron altyapısı YOK), açılışta hemen bir kez çalışır,
 * ardından her `CART_RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `app.addHook("onClose", ...)`
 * ile interval temizlenir — aksi hâlde (özellikle testlerde, her `buildTestApp()` çağrısı yeni bir
 * interval açar) süreç/test process'i sonsuza dek canlı kalırdı.
 */
export function registerCartRetentionSweeper(app: FastifyInstance): void {
  const runSweep = () => {
    runCartRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "Sepet saklama süresi taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, CART_RETENTION_SWEEP_INTERVAL_MS);
  // Testlerde/kısa ömürlü process'lerde bu timer'ın event loop'u canlı tutmasını önler
  // (üretimde etkisi yoktur — process zaten sürekli açık kalır).
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
