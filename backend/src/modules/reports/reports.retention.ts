import type { FastifyInstance } from "fastify";
import { exportStorage } from "../../lib/export-storage";
import { EXPORT_RETENTION_SWEEP_INTERVAL_MS } from "./reports.constants";

export interface ExportRetentionSweepResult {
  deletedJobs: number;
}

/**
 * §10.8.10 — `import.retention.ts::runImportRetentionSweep` İLE AYNI DESEN, ama daha basit:
 * `ExportJob`'da `ImportJobError` benzeri ayrı bir PII satır tablosu YOK (bkz. ARCHITECTURE.md
 * §10.8.10 — "ImportJobError paterni burada yok"), bu yüzden yalnızca TEK bir temizlik adımı
 * var: `expiresAt` geçmiş `ExportJob` satırları (durumdan BAĞIMSIZ — `PENDING`/`PROCESSING`'de
 * 7 günden fazla takılı kalmış bir iş de zaten anormaldir, bkz. reports.constants.ts) dosyalarıyla
 * birlikte TAMAMEN silinir. İDEMPOTENT'tir.
 */
export async function runExportRetentionSweep(app: FastifyInstance): Promise<ExportRetentionSweepResult> {
  const expired = await app.prisma.exportJob.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, storagePath: true },
  });
  if (expired.length === 0) return { deletedJobs: 0 };

  for (const job of expired) {
    if (job.storagePath) await exportStorage.remove(job.storagePath).catch(() => {});
  }
  await app.prisma.exportJob.deleteMany({ where: { id: { in: expired.map((j) => j.id) } } });

  return { deletedJobs: expired.length };
}

/**
 * `import.retention.ts::registerImportRetentionScheduler` İLE AYNI GEREKÇE/DESEN — gerçek
 * zaman-tetiklemeli süreç-içi `setInterval` (kuyruk/cron altyapısı YOK), açılışta hemen bir
 * kez çalışır, `onClose` ile interval temizlenir.
 */
export function registerExportRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runExportRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "Rapor dışa aktarma saklama süresi taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, EXPORT_RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
