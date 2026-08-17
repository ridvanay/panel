/**
 * §10.16.10 Saklama (retention) ve PII — `modules/import/import.retention.ts::§10.8.8.1` ile
 * BİREBİR AYNI yaklaşım (compliance-agent kararı): tembel/bir sonraki yazmaya bağlı tetikleme
 * KABUL EDİLEMEZ, gerçek zaman-tetiklemeli bir scheduler kullanılır.
 *
 * İki bağımsız temizlik:
 * 1. **PII redaksiyonu (30 gün, SABİT):** `ContactSubmission.ipAddress`/`userAgent`
 *    `createdAt`'i 30 günden eski satırlarda `null`'lanır, `piiRedactedAt` yazılır. Satır
 *    SİLİNMEZ — `name`/`email`/`data`/`status` denetim/yanıtlama amaçlı KALIR.
 * 2. **Gönderim saklama (`ContactForm.retentionDays`, VARSAYILAN 180, DEĞİŞKEN):**
 *    `createdAt`'i bu süreden eski `ContactSubmission` satırları KALICI silinir.
 *    `retentionDays = 0` → silme YOK (compliance-agent onayı gerektiren özel durum, §10.16.10).
 *
 * İDEMPOTENT'tir — zaten redakte edilmiş satırlarda no-op (bkz. `where` filtreleri).
 */
import type { FastifyInstance } from "fastify";
import { CONTACT_FORM_ID } from "../modules/contact/contact.constants";

const PII_REDACTION_MS = 30 * 24 * 60 * 60 * 1000;
/** `import.retention.ts::IMPORT_RETENTION_SWEEP_INTERVAL_MS` ile AYNI kadans — saatlik tur. */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface ContactRetentionSweepResult {
  redactedSubmissions: number;
  deletedSubmissions: number;
}

export async function runContactRetentionSweep(app: FastifyInstance): Promise<ContactRetentionSweepResult> {
  const redactionCutoff = new Date(Date.now() - PII_REDACTION_MS);

  const redacted = await app.prisma.contactSubmission.updateMany({
    where: {
      createdAt: { lt: redactionCutoff },
      piiRedactedAt: null,
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
    },
    data: { ipAddress: null, userAgent: null, piiRedactedAt: new Date() },
  });

  const form = await app.prisma.contactForm.findUnique({
    where: { id: CONTACT_FORM_ID },
    select: { retentionDays: true },
  });

  // `retentionDays = 0` → süresiz saklama, silme YAPILMAZ (§10.16.10 compliance-agent onaylı istisna).
  // Form hiç yapılandırılmamışsa (satır yok) Prisma model varsayılanı (180) fiilen henüz DB'de
  // yazılı değildir — bu durumda silme atlanır (henüz hiç gönderim yoksa zaten no-op).
  let deletedSubmissions = 0;
  if (form && form.retentionDays > 0) {
    const retentionCutoff = new Date(Date.now() - form.retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await app.prisma.contactSubmission.deleteMany({
      where: { createdAt: { lt: retentionCutoff } },
    });
    deletedSubmissions = deleted.count;
  }

  return { redactedSubmissions: redacted.count, deletedSubmissions };
}

/**
 * `import.retention.ts::registerImportRetentionScheduler` ile AYNI desen: açılışta HEMEN bir kez
 * çalışır, ardından her `RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `onClose` ile kendi
 * interval'ini temizler (aksi halde her `buildTestApp()` çağrısı sonsuza dek canlı bir timer
 * bırakırdı).
 */
export function registerContactRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runContactRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "İletişim formu PII saklama/redaksiyon taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
