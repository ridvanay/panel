import { RoomServiceClient, DataPacket_Kind } from "livekit-server-sdk";
import type { FastifyInstance } from "fastify";
import { getLiveKitConfig } from "./livekit";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — integration-agent'ın TEK
 * SAHASI. Görüşme odasındaki istemcilere (doktor/hasta) kayıt durum değişikliklerini (rıza
 * bekleniyor/kaydediliyor/reddedildi/vb.) BİLGİLENDİRMEK için LiveKit veri kanalı (`sendData`)
 * kullanılır — bu, rızanın DOĞRULUK KAYNAĞI (DB) DEĞİLDİR, yalnızca UI'ın anlık güncellenmesi
 * içindir (istemci bağlantısı kopuksa/mesaj kaybolursa dahi DB durumu bozulmaz).
 */

export type RecordingSignalStatus = "PENDING_CONSENT" | "RECORDING" | "PROCESSING" | "COMPLETED" | "CONSENT_DENIED" | "FAILED";
export const RECORDING_SIGNAL_TOPIC = "telehealth.recording";

export interface RecordingSignalPayload {
  v: 1;
  appointmentId: string;
  recordingId: string;
  status: RecordingSignalStatus;
  consentVersion: string;
  consentExpiresAt: string | null;
}

/**
 * Odadaki TÜM katılımcılara yayınlar (`destinationIdentities` KULLANILMAZ — çoklu-slot booking'de
 * doktorun bulunduğu randevu ile hastanın katıldığı randevu farklı olabilir, hedefli gönderim bu
 * durumda SESSİZCE düşer; payload zaten PII İÇERMEZ, istemci `appointmentId`/rol filtresi yapar).
 * BEST-EFFORT: hata FIRLATMAZ, `app.log.warn` yazar — rızanın doğruluk kaynağı DB'dir, sinyal
 * kaybı akışı BOZMAZ, yalnızca istemi/güncellemeyi geciktirir.
 */
export async function sendRecordingSignal(app: FastifyInstance, roomName: string, payload: RecordingSignalPayload): Promise<void> {
  try {
    const config = getLiveKitConfig();
    const client = new RoomServiceClient(config.url.replace(/^ws(s)?:\/\//, "http$1://"), config.apiKey, config.apiSecret);
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await client.sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic: RECORDING_SIGNAL_TOPIC });
  } catch (err) {
    app.log.warn({ err }, "recording sinyali gönderilemedi (best-effort)");
  }
}
