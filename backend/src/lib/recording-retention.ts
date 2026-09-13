/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — görüşme kaydı (video)
 * saklama süpürücüsü. `lib/intake-retention.ts` İLE AYNI iskelet (gerçek zaman-tetiklemeli,
 * `setInterval`, kuyruk YOK, açılışta hemen bir kez çalışır) ama kesme (cutoff) hesabı BİLİNÇLİ
 * OLARAK FARKLIDIR:
 *
 * **Süre: randevunun KENDİ `endsAt`'inden itibaren 30 GÜN** — `intake-retention.ts`'in booking
 * düzeyi kuralının (booking'in TÜM randevularının `MAX(endsAt)`'i) AKSİNE, bir görüşme kaydı
 * TEK bir seansa (Appointment) aittir; booking'in diğer slotlarının bitiş tarihinin bu kaydın
 * saklama süresini UZATMASI için hiçbir gerekçe yoktur.
 *
 * Silinen: `ConsultationRecording.storagePath` (dosya GERÇEKTEN silinir, satır `deletedAt` ile
 * işaretlenir — `purgeRecordingFile` TEK silme yolu, hem route hem süpürücü bunu kullanır).
 * Ayrıca hiç arşivlenmemiş (yetim) staging nesneleri (6 saatten eski) best-effort temizlenir —
 * bunların karşılığı bir `ConsultationRecording` satırı OLMAYABİLİR (arşivleme hiç tamamlanmamış
 * Egress çıktıları).
 */
import type { FastifyInstance } from "fastify";
import { purgeRecordingFile } from "./telehealth-recording-archive";
import { isRecordingStorageConfigured, telehealthRecordingStorage } from "./telehealth-recording-storage";
import { logAudit } from "./audit";

export const RECORDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün
export const RECORDING_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // günlük
export const RECORDING_STAGING_ORPHAN_MS = 6 * 60 * 60 * 1000; // 6 saat

export interface RecordingRetentionSweepResult {
  deletedRecordings: number;
  deletedStagingObjects: number;
}

/**
 * İDEMPOTENT'tir — zaten `deletedAt` dolu satırlar `where` filtresiyle ZATEN dışlanır, ikinci
 * tur aynı satırları tekrar SİLMEZ (bkz. `purgeRecordingFile`'ın kendisi de `deletedAt: null`,
 * `storagePath: null` yazdığı için bir sonraki taramada `where` koşulunu artık karşılamaz).
 */
export async function runRecordingRetentionSweep(app: FastifyInstance): Promise<RecordingRetentionSweepResult> {
  // qa-agent bulgusu — `STORAGE_DRIVER=local` (kayıt özelliği hiç yapılandırılmamış) iken
  // süpürücü her turda S3 istemcisini çağırıp `CredentialsProviderError` ile gürültülü ERROR
  // logu üretiyordu. "Dürüst yapılandırılmamışlık" felsefesiyle (`PAYMENTS_NOT_CONFIGURED`/
  // `LIVEKIT_NOT_CONFIGURED` İLE AYNI) — depo yapılandırılmamışsa satır/dosya zaten YOKTUR,
  // sessizce atla.
  if (!isRecordingStorageConfigured()) {
    return { deletedRecordings: 0, deletedStagingObjects: 0 };
  }

  const cutoff = new Date(Date.now() - RECORDING_RETENTION_MS);

  const dueRecordings = await app.prisma.consultationRecording.findMany({
    where: { deletedAt: null, storagePath: { not: null }, appointment: { endsAt: { lt: cutoff } } },
    select: { id: true },
  });

  let deletedRecordings = 0;
  for (const recording of dueRecordings) {
    await purgeRecordingFile(app, recording.id);
    await logAudit(app, {
      action: "telehealth.recording.deleted",
      targetType: "ConsultationRecording",
      targetId: recording.id,
      metadata: { recordingId: recording.id, reason: "retention" },
    });
    deletedRecordings += 1;
  }

  // Yetim staging nesneleri — arşivleme hiç tamamlanmamış (webhook hiç gelmemiş/işlenmemiş)
  // Egress çıktıları. Karşılık gelen bir `ConsultationRecording` satırı OLMAYABİLİR, bu yüzden
  // DB'den bağımsız, doğrudan depodan (best-effort) temizlenir.
  const orphanStagingObjects = await telehealthRecordingStorage.listStaging(new Date(Date.now() - RECORDING_STAGING_ORPHAN_MS));
  for (const object of orphanStagingObjects) {
    await telehealthRecordingStorage.remove(object.key);
  }

  return { deletedRecordings, deletedStagingObjects: orphanStagingObjects.length };
}

/**
 * `registerIntakeRetentionScheduler` İLE AYNI desen: açılışta HEMEN bir kez çalışır, ardından her
 * `RECORDING_RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `onClose` ile kendi interval'ini
 * temizler.
 */
export function registerRecordingRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runRecordingRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "Görüşme kaydı saklama süresi taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, RECORDING_RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
