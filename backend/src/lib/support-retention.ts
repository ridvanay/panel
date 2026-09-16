/**
 * `.claude/compliance-notes-support-desk.md` §3 (bağlayıcı, compliance-agent onaylı) — Canlı
 * Destek (`SupportChatSession`/`SupportChatMessage`) saklama süpürücüsü. `contact-retention.ts`
 * ile BİREBİR AYNI iskelet: tek dosyada ÜÇ bağımsız, idempotent işlem, saatlik kadans
 * (`RETENTION_SWEEP_INTERVAL_MS`), süreç-içi `setInterval` (kuyruk/cron YOK).
 *
 * **Üç kural (bağlayıcı, sıra önemsizdir — hepsi idempotenttir):**
 * 1. **IP/UA redaksiyonu — 30 gün (`createdAt` bazlı):** `ipAddress`/`userAgent` → `null`,
 *    `piiRedactedAt` damgalanır. Satır SİLİNMEZ (`ContactSubmission` §10.16.10 İLE BİREBİR AYNI).
 * 2. **`CLOSED` oturum kalıcı silme — 180 gün (`closedAt` bazlı, `createdAt` DEĞİL):** oturum +
 *    tüm mesajları (`onDelete: Cascade`) KALICI silinir. `closedAt` kullanılır çünkü aylarca
 *    `PENDING`'de bekleyen ama geç kapatılan bir oturum, kapatıldığı anda hemen silinmemelidir.
 * 3. **YENİ — kapatılmamış oturum güvenlik ağı — 365 gün
 *    (`COALESCE(lastMessageAt, createdAt)` bazlı, status'tan BAĞIMSIZ):** `PENDING`/`ANSWERED`
 *    durumunda "havuzda" asılı kalmış (personel unutmuş, ziyaretçi bir daha yazmamış) bir
 *    oturumun SÜRESİZ saklanmasını engeller — `CLOSED` oturumlar zaten kural 2'ye tabidir.
 */
import type { FastifyInstance } from "fastify";

const PII_REDACTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLOSED_SESSION_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const HANGING_SESSION_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** `contact-retention.ts::RETENTION_SWEEP_INTERVAL_MS` İLE AYNI kadans — saatlik tur. */
export const SUPPORT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface SupportRetentionSweepResult {
  redactedSessions: number;
  deletedClosedSessions: number;
  deletedHangingSessions: number;
}

/** İDEMPOTENT'tir — her üç işlem de zaten uygulanmış satırlarda no-op (bkz. `where` filtreleri). */
export async function runSupportRetentionSweep(app: FastifyInstance): Promise<SupportRetentionSweepResult> {
  const now = Date.now();

  const redacted = await app.prisma.supportChatSession.updateMany({
    where: {
      createdAt: { lt: new Date(now - PII_REDACTION_MS) },
      piiRedactedAt: null,
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
    },
    data: { ipAddress: null, userAgent: null, piiRedactedAt: new Date() },
  });

  const deletedClosed = await app.prisma.supportChatSession.deleteMany({
    where: { status: "CLOSED", closedAt: { lt: new Date(now - CLOSED_SESSION_RETENTION_MS) } },
  });

  const deletedHanging = await app.prisma.supportChatSession.deleteMany({
    where: {
      status: { in: ["PENDING", "ANSWERED"] },
      OR: [
        { lastMessageAt: { lt: new Date(now - HANGING_SESSION_RETENTION_MS) } },
        { lastMessageAt: null, createdAt: { lt: new Date(now - HANGING_SESSION_RETENTION_MS) } },
      ],
    },
  });

  return {
    redactedSessions: redacted.count,
    deletedClosedSessions: deletedClosed.count,
    deletedHangingSessions: deletedHanging.count,
  };
}

/**
 * `contact-retention.ts::registerContactRetentionScheduler` İLE AYNI desen: açılışta HEMEN bir
 * kez çalışır, ardından her `SUPPORT_RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `onClose`
 * ile kendi interval'ini temizler.
 */
export function registerSupportRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runSupportRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "Canlı Destek saklama süresi taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, SUPPORT_RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
