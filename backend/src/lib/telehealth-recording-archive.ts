import type { FastifyInstance } from "fastify";
import { createBinaryEncryptStream } from "./binary-crypto";
import { recordingFinalKey, recordingStagingKey, telehealthRecordingStorage } from "./telehealth-recording-storage";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — LiveKit Egress'in
 * bildirdiği sonuç integration-agent'ın SDK tiplerinden BURAYA düz bir nesneye çevrilerek
 * geçirilir; bu dosya `livekit-server-sdk`/`@livekit/protocol` İTHAL ETMEZ (backend-agent'ın
 * ajan sınırı — integration-agent'ın webhook route'u bu fonksiyonu ÇAĞIRIR).
 */
export interface EgressCompletionInput {
  egressId: string;
  /** integration-agent nanosaniyeden saniyeye ÇEVİRİP geçer. */
  durationSeconds: number | null;
  /** Egress hatası (varsa) — dolu ise arşivleme YAPILMAZ, satır FAILED olur. */
  error: string | null;
}

/** `ConsultationRecording.status` bu ikisindeyse satır ZATEN işlenmiştir — webhook idempotency. */
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED"]);

/**
 * `egress_ended` sonrası TEK giriş noktası (integration-agent'ın webhook route'u bunu çağırır).
 * İDEMPOTENT: satır zaten COMPLETED/FAILED ise no-op (webhook tekrar gelirse ikinci kez
 * şifreleme/yükleme YAPILMAZ — `stripe.routes.ts` idempotency felsefesiyle AYNI).
 *
 * `logAudit` BU FONKSİYONUN İÇİNDE ÇAĞRILMAZ — çağıran (integration-agent'ın webhook route'u)
 * kendi audit'ini kendi atar (actor bilgisi olmayan bir sistem-tetiklemeli olay).
 */
export async function archiveRecordingFromEgress(app: FastifyInstance, input: EgressCompletionInput): Promise<void> {
  const recording = await app.prisma.consultationRecording.findUnique({
    where: { egressId: input.egressId },
  });

  if (!recording || TERMINAL_STATUSES.has(recording.status)) {
    // Satır yok (bilinmeyen egressId) VEYA zaten terminal durumda — webhook tekrarı, no-op.
    return;
  }

  if (input.error) {
    await app.prisma.consultationRecording.update({
      where: { id: recording.id },
      data: { status: "FAILED", failureReason: input.error, endedAt: new Date() },
    });
    return;
  }

  await app.prisma.consultationRecording.update({
    where: { id: recording.id },
    data: { status: "PROCESSING" },
  });

  const stagingKey = recordingStagingKey(recording.id);
  const finalKey = recordingFinalKey(recording.id);

  try {
    const source = await telehealthRecordingStorage.openReadStream(stagingKey);
    const encrypted = source.pipe(createBinaryEncryptStream());
    // `.pipe()` hata olaylarını OTOMATİK ilettirmez (Node stream davranışı) — kaynak akış
    // hata verirse şifreleme akışını da elle hataya düşürüp `Upload`'un reddetmesini sağlarız.
    source.on("error", (err) => encrypted.destroy(err));

    const uploadResult = await telehealthRecordingStorage.uploadStream(finalKey, encrypted, "application/octet-stream");

    // Başarılı yüklemeden SONRA staging silinir — best-effort (silme başarısız olsa da arşivleme
    // sonucu DEĞİŞMEZ, yetim staging nesnesi süpürücü tarafından (B4) sonradan temizlenir).
    await telehealthRecordingStorage.remove(stagingKey).catch(() => {});

    await app.prisma.consultationRecording.update({
      where: { id: recording.id },
      data: {
        status: "COMPLETED",
        storagePath: finalKey,
        fileSizeBytes: uploadResult.sizeBytes,
        durationSeconds: input.durationSeconds,
        endedAt: new Date(),
      },
    });
  } catch (err) {
    // Staging silme YİNE DE denenir (best-effort, hata yutulur) — arşivleme başarısız olsa da
    // yetim staging nesnesinin süresiz kalmasını ÖNLEMEYE çalışır.
    await telehealthRecordingStorage.remove(stagingKey).catch(() => {});
    // PII/tıbbi içerik TAŞIMAZ — yalnızca teknik hata mesajı (bkz. prisma/schema.prisma::
    // ConsultationRecording.failureReason notu).
    const message = err instanceof Error ? err.message : "Görüşme kaydı arşivlenirken bilinmeyen bir hata oluştu.";
    await app.prisma.consultationRecording.update({
      where: { id: recording.id },
      data: { status: "FAILED", failureReason: message, endedAt: new Date() },
    });
  }
}

/**
 * Dosyayı GERÇEKTEN siler (final + varsa staging) ve satırı `deletedAt=now`, `storagePath=null`
 * ile işaretler. Route katmanı (KVKK md.11 silme ucu) ve süpürücü AYNI fonksiyonu çağırır —
 * TEK silme yolu. `status` DEĞİŞTİRİLMEZ (COMPLETED kalır, sadece deletedAt/storagePath).
 */
export async function purgeRecordingFile(app: FastifyInstance, recordingId: string): Promise<void> {
  const recording = await app.prisma.consultationRecording.findUnique({ where: { id: recordingId } });
  if (!recording) return;

  if (recording.storagePath) {
    await telehealthRecordingStorage.remove(recording.storagePath).catch(() => {});
  }
  // Arşivleme tamamlanmadan (henüz PROCESSING iken) silme istenmiş olabilir — yetim staging
  // nesnesi de best-effort temizlenir.
  await telehealthRecordingStorage.remove(recordingStagingKey(recording.id)).catch(() => {});

  await app.prisma.consultationRecording.update({
    where: { id: recording.id },
    data: { deletedAt: new Date(), storagePath: null },
  });
}
