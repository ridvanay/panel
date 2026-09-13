import { EgressClient, EncodedFileOutput, EncodedFileType, EncodingOptionsPreset, S3Upload, WebhookConfig } from "livekit-server-sdk";
import { env } from "../../../config/env";
import { isLiveKitConfigured, getLiveKitConfig } from "./livekit";
import { recordingStagingKey } from "../../../lib/telehealth-recording-storage";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — integration-agent'ın TEK
 * SAHASI: `livekit-server-sdk`/`@livekit/protocol`ye dokunan TÜM Egress yüzeyi burada yaşar.
 * backend-agent bu dosyaya DOKUNMAZ (§4.4/§8 disipliniyle AYNI ajan sınırı, bkz. `lib/livekit.ts`
 * dosya başı yorumu). Egress/RoomService çağrıları HER ZAMAN API key/secret ile yapılır —
 * katılımcı token'ının (`createMeetingToken`) grant yüzeyi BURADAN ETKİLENMEZ/GENİŞLETİLMEZ.
 */

/** Egress'i http(s) host'undan kurmak için — `LIVEKIT_URL` genelde `wss://...`dir. */
function toLiveKitHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws(s)?:\/\//, "http$1://");
}

/**
 * Kayıt özelliğinin TÜM ön koşulları (LiveKit + S3 + webhook URL) sağlanmış mı. `isLiveKitConfigured()`
 * (§4.4) BİLEREK AYRI tutulur — LiveKit konsültasyon odası, Egress OLMADAN da (kayıt YOK) çalışabilir;
 * bu fonksiyon YALNIZCA kayıt özelliğinin ek ön koşullarını (S3 + webhook URL) kontrol eder.
 */
export function isRecordingConfigured(): boolean {
  return (
    isLiveKitConfigured() &&
    env.STORAGE_DRIVER === "s3" &&
    Boolean(env.S3_BUCKET) &&
    Boolean(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) &&
    Boolean(env.LIVEKIT_EGRESS_WEBHOOK_URL)
  );
}

function buildEgressClient(): EgressClient {
  const config = getLiveKitConfig();
  return new EgressClient(toLiveKitHttpUrl(config.url), config.apiKey, config.apiSecret);
}

/**
 * `startRoomCompositeEgress`'i BAŞLATIR — çağıran taraf (route katmanı) hasta rızasının
 * (`patientConsentAt`) ZATEN DB'ye yazıldığını garanti ETMEK ZORUNDADIR, bu fonksiyon bunu
 * KONTROL ETMEZ (saf sarmalayıcı, bkz. `telehealth.recording.routes.ts`'teki "MUTLAK KURAL" notu).
 */
export async function startRoomCompositeRecording(input: { roomName: string; recordingId: string }): Promise<{ egressId: string }> {
  const client = buildEgressClient();

  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: recordingStagingKey(input.recordingId),
    disableManifest: true,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: env.S3_ACCESS_KEY_ID ?? "",
        secret: env.S3_SECRET_ACCESS_KEY ?? "",
        region: env.S3_REGION ?? "us-east-1",
        endpoint: env.LIVEKIT_EGRESS_S3_ENDPOINT || env.S3_ENDPOINT || "",
        bucket: env.S3_BUCKET ?? "",
        forcePathStyle: Boolean(env.S3_ENDPOINT),
      }),
    },
  });

  const info = await client.startRoomCompositeEgress(input.roomName, output, {
    layout: "speaker",
    encodingOptions: EncodingOptionsPreset.H264_720P_30,
    webhooks: [new WebhookConfig({ url: env.LIVEKIT_EGRESS_WEBHOOK_URL, signingKey: getLiveKitConfig().apiKey })],
  });

  return { egressId: info.egressId };
}

/**
 * Egress'i durdurur — idempotent OLMAYABİLİR (egress zaten durmuş/bitmişse SDK bir Twirp hatası
 * fırlatabilir). BEST-EFFORT: hata YUTULUR (yalnızca çağıran tarafa loglanması için fırlatılmaz) —
 * gerçek sonuç HER HÂLÜKÂRDA `egress_ended` webhook'uyla (`archiveRecordingFromEgress`) gelir; bu
 * fonksiyonun başarısız olması route'un satırı `PROCESSING`'e geçirmesini ENGELLEMEMELİDİR (aksi
 * hâlde kayıt hem LiveKit'te hem DB'de sonsuza dek "RECORDING" görünüp asla arşivlenmez izlenimi
 * verebilir; webhook zaten idempotent olduğundan bu güvenli bir best-effort'tur).
 */
export async function stopRoomCompositeRecording(egressId: string): Promise<void> {
  const client = buildEgressClient();
  await client.stopEgress(egressId).catch(() => {});
}
