import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

/**
 * §10.13.8 Budama — `import.retention.ts` İLE AYNI desen (gerçek zaman-tetiklemeli, süreç-içi
 * `setInterval`, kuyruk/cron altyapısı YOK). İDEMPOTENT'tir.
 */

export const WEBHOOK_DELIVERY_KEEP_PER_HOOK = 100;
export const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const WEBHOOK_DELIVERY_PII_REDACT_MS = 7 * 24 * 60 * 60 * 1000;
export const WEBHOOK_DELIVERY_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface WebhookDeliveryRetentionSweepResult {
  redactedPayloads: number;
  deletedByAge: number;
  deletedByKeepLimit: number;
}

/**
 * 1. PII redaksiyonu (7 gün) — `containsPii: true` kayıtlarda `payload` → `{ redacted: true }`.
 * 2. Yaş tavanı (30 gün) — tüm kayıtlar (PII olsun olmasın) silinir.
 * 3. Webhook başına en yeni 100 kayıt tutulur — 30 güne ulaşmasa da fazlası silinir.
 *
 * Redaksiyon penceresi (7 gün) yeniden deneme penceresinden (~72 dk) çok daha uzundur; budama
 * bir retry'ı asla bozmaz (bkz. ARCHITECTURE.md §10.13.8).
 */
export async function runWebhookDeliveryRetentionSweep(app: FastifyInstance): Promise<WebhookDeliveryRetentionSweepResult> {
  const redactionCutoff = new Date(Date.now() - WEBHOOK_DELIVERY_PII_REDACT_MS);
  const ageCutoff = new Date(Date.now() - WEBHOOK_DELIVERY_RETENTION_MS);

  const redacted = await app.prisma.webhookDelivery.updateMany({
    where: { containsPii: true, createdAt: { lt: redactionCutoff } },
    data: { payload: { redacted: true } as Prisma.InputJsonValue },
  });

  const deletedByAge = await app.prisma.webhookDelivery.deleteMany({
    where: { createdAt: { lt: ageCutoff } },
  });

  // Webhook başına en yeni 100 kaydın SIRALAMA/eşik değerini bulup fazlasını sil. `WEBHOOK_MAX_COUNT`
  // (20) üst sınırı sayesinde bu liste her zaman küçüktür (§10.13.7-E) — N+1 burada kabul edilebilir.
  const webhooks = await app.prisma.outboundWebhook.findMany({ select: { id: true } });

  let deletedByKeepLimit = 0;
  for (const webhook of webhooks) {
    const cutoffRow = await app.prisma.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { seq: "desc" },
      skip: WEBHOOK_DELIVERY_KEEP_PER_HOOK - 1,
      take: 1,
      select: { seq: true },
    });
    const cutoffSeq = cutoffRow[0]?.seq;
    if (cutoffSeq === undefined) continue;

    const result = await app.prisma.webhookDelivery.deleteMany({
      where: { webhookId: webhook.id, seq: { lt: cutoffSeq } },
    });
    deletedByKeepLimit += result.count;
  }

  return { redactedPayloads: redacted.count, deletedByAge: deletedByAge.count, deletedByKeepLimit };
}

/**
 * `import.retention.ts::registerImportRetentionScheduler` İLE AYNI desen — açılışta hemen bir kez
 * çalışır, ardından her `WEBHOOK_DELIVERY_RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır.
 * `onClose` ile interval temizlenir.
 */
export function registerWebhookDeliveryRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runWebhookDeliveryRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "Webhook delivery saklama/redaksiyon taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, WEBHOOK_DELIVERY_RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
