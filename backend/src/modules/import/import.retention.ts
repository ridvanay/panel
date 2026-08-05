import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { IMPORT_ERROR_ROW_REDACTION_MS, IMPORT_JOB_RETENTION_MS, IMPORT_RETENTION_SWEEP_INTERVAL_MS } from "./import.constants";

export interface ImportRetentionSweepResult {
  redactedErrorRows: number;
  deletedJobs: number;
}

/**
 * §10.8.8.1 compliance-agent kararı (2026-08-05, BLOCKER) — iki bağımsız temizlik:
 *
 * 1. **PII redaksiyonu (30 gün)**: `ImportJobError.rawData` (ve `USERS` tipi işlerde
 *    e-posta içerebilen `sourceRef`) `createdAt`'i 30 günden eski satırlarda `null`
 *    yapılır. Satır SİLİNMEZ — `code`/`message`/`severity`/`rowNumber`/`field`/`jobId`
 *    denetim/istatistik amaçlı KALIR. `USERS` DIŞINDAKİ tiplerde `sourceRef` (WXR
 *    `post_id`, ZIP dosya adı, sayfa/blog `slug`) PII DEĞİLDİR — dokunulmaz.
 * 2. **Job zarfı saklama (90 gün)**: `COMPLETED`/`FAILED`/`CANCELLED` `ImportJob`
 *    satırları `finishedAt` (yoksa `createdAt`) 90 günden eskiyse TAMAMEN silinir —
 *    `ImportJobError` `onDelete: Cascade` olduğundan çocuk satırlar otomatik gider.
 *
 * İDEMPOTENT'tir — zaten redakte edilmiş/silinmiş satırlarda no-op (bkz. `where` filtreleri).
 */
export async function runImportRetentionSweep(app: FastifyInstance): Promise<ImportRetentionSweepResult> {
  const redactionCutoff = new Date(Date.now() - IMPORT_ERROR_ROW_REDACTION_MS);
  const jobRetentionCutoff = new Date(Date.now() - IMPORT_JOB_RETENTION_MS);

  // `USERS` tipi işlere ait satırlar: hem `rawData` hem `sourceRef` (e-posta) redakte edilir.
  const redactedUsersRows = await app.prisma.importJobError.updateMany({
    where: {
      createdAt: { lt: redactionCutoff },
      job: { is: { type: "USERS" } },
      OR: [{ rawData: { not: Prisma.DbNull } }, { sourceRef: { not: null } }],
    },
    data: { rawData: Prisma.DbNull, sourceRef: null },
  });

  // Diğer tipler: yalnızca `rawData` redakte edilir — `sourceRef` (post_id/dosya adı/slug) PII DEĞİLDİR.
  const redactedOtherRows = await app.prisma.importJobError.updateMany({
    where: {
      createdAt: { lt: redactionCutoff },
      job: { is: { type: { not: "USERS" } } },
      rawData: { not: Prisma.DbNull },
    },
    data: { rawData: Prisma.DbNull },
  });

  const deletedJobs = await app.prisma.importJob.deleteMany({
    where: {
      status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
      OR: [{ finishedAt: { lt: jobRetentionCutoff } }, { finishedAt: null, createdAt: { lt: jobRetentionCutoff } }],
    },
  });

  return {
    redactedErrorRows: redactedUsersRows.count + redactedOtherRows.count,
    deletedJobs: deletedJobs.count,
  };
}

/**
 * Gerçek zaman-tetiklemeli periyodik zamanlayıcı (bkz. compliance-agent kararı — "bir sonraki
 * upload'ta tetiklenen" tembel desen KABUL EDİLEMEZ). Projede kuyruk/cron altyapısı yok
 * (§10.8.1 "queue yok" kararıyla TUTARLI, yeni bir bağımlılık EKLENMEDİ) — süreç-içi basit bir
 * `setInterval` yeterlidir; §10.8.1'deki gibi TEK instance varsayımı kabul edilebilir (yatay
 * ölçeklendiğimizde gerçek bir scheduler'a geçilir, bkz. §10.8.1 "bilinen sınır" notu).
 *
 * Açılışta HEMEN bir kez çalışır (uzun süredir yeniden başlatılmamış bir süreçte 30/90 günlük
 * eşiklerin bir sonraki saatlik tur'u beklemeden uygulanması için), ardından her
 * `IMPORT_RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `app.addHook("onClose", ...)` ile
 * interval temizlenir — aksi hâlde (özellikle testlerde, her `buildTestApp()` çağrısı yeni bir
 * interval açar) süreç/test process'i sonsuza dek canlı kalırdı.
 */
export function registerImportRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runImportRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "İçe aktarma PII saklama/redaksiyon taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, IMPORT_RETENTION_SWEEP_INTERVAL_MS);
  // Testlerde/kısa ömürlü process'lerde bu timer'ın event loop'u canlı tutmasını önler
  // (üretimde etkisi yoktur — process zaten sürekli açık kalır).
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
