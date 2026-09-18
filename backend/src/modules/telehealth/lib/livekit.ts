import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { env } from "../../../config/env";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.4/§8 — integration-agent'ın TEK SAHASI.
 * backend-agent bu dosyaya DOKUNMAZ.
 *
 * `LIVEKIT_API_SECRET` bu dosyanın DIŞINA (yanıt/log/hata gövdesi) hiçbir şekilde SIZMAZ —
 * yalnızca `AccessToken` constructor'ına geçirilir ve imzalama için `livekit-server-sdk`
 * içinde kalır.
 */

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Dakika — bkz. `LIVEKIT_TOKEN_TTL_MIN`, varsayılan 180, tavan 240 (env.ts şeması). */
  tokenTtlMin: number;
  /** Saniye — bkz. `LIVEKIT_ROOM_EMPTY_TIMEOUT_SEC` (env.ts şeması), `ensureRoomConfigured()`. */
  roomEmptyTimeoutSec: number;
  /** Saniye — bkz. `LIVEKIT_ROOM_DEPARTURE_TIMEOUT_SEC` (env.ts şeması), `ensureRoomConfigured()`. */
  roomDepartureTimeoutSec: number;
  /** BACKEND KONTEYNERİNDEN erişilebilir Server API adresi (http(s)://) — `url`'den (tarayıcı
   * ws(s)://) BİLİNÇLİ OLARAK AYRI. Bkz. `LIVEKIT_INTERNAL_URL` (env.ts şeması) dosya başı
   * yorumu. Boşsa `ensureRoomConfigured()` SESSİZCE atlanır. */
  internalUrl: string;
}

/** Test edilebilirlik için `env`'den AYRI bir config nesnesi enjekte edilebilir. */
export function getLiveKitConfig(): LiveKitConfig {
  return {
    url: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    tokenTtlMin: env.LIVEKIT_TOKEN_TTL_MIN,
    roomEmptyTimeoutSec: env.LIVEKIT_ROOM_EMPTY_TIMEOUT_SEC,
    roomDepartureTimeoutSec: env.LIVEKIT_ROOM_DEPARTURE_TIMEOUT_SEC,
    internalUrl: env.LIVEKIT_INTERNAL_URL,
  };
}

/** §4.4 madde 3 — üç değişkenin HEPSİ dolu değilse LiveKit "yapılandırılmamış" sayılır. */
export function isLiveKitConfigured(config: LiveKitConfig = getLiveKitConfig()): boolean {
  return Boolean(config.url && config.apiKey && config.apiSecret);
}

let cachedRoomServiceClient: { key: string; client: RoomServiceClient } | null = null;

/** `sendMail`'in transporter önbelleğiyle AYNI ilke — yapılandırma (internalUrl/apiKey)
 * değişmedikçe istemci yeniden kurulmaz. */
function getRoomServiceClient(config: LiveKitConfig): RoomServiceClient {
  const key = `${config.internalUrl}:${config.apiKey}`;
  if (!cachedRoomServiceClient || cachedRoomServiceClient.key !== key) {
    cachedRoomServiceClient = { key, client: new RoomServiceClient(config.internalUrl, config.apiKey, config.apiSecret) };
  }
  return cachedRoomServiceClient.client;
}

/**
 * 2026-09-19 (kullanıcı talebi) — oda AÇIKÇA `LIVEKIT_ROOM_EMPTY_TIMEOUT_SEC`/
 * `LIVEKIT_ROOM_DEPARTURE_TIMEOUT_SEC` ile OLUŞTURULUR (bkz. env.ts şemasındaki dosya başı
 * yorumu — "repo dışı YAML'a güvenme" ilkesi). LiveKit'in `CreateRoom` RPC'si İDEMPOTENTTİR:
 * oda ZATEN varsa (ör. karşı taraf önce bağlanmışsa) bu çağrı mevcut ayarları KORUR, hata
 * FIRLATMAZ — bu yüzden HER token isteğinde güvenle çağrılabilir.
 *
 * `config.internalUrl` BOŞSA (varsayılan, `LIVEKIT_INTERNAL_URL` tanımlanmamış) SESSİZCE
 * ATLANIR — hata FIRLATMAZ, `LIVEKIT_URL` boşken `isLiveKitConfigured()`in "kapalı" sayması İLE
 * AYNI "dürüst yapılandırılmamışlık" felsefesi. Dolu ama HATALI/ulaşılamaz bir adresse (ör.
 * yanlış host) hatayı FIRLATIR — BEST-EFFORT çağrı sorumluluğu (try/catch + log) route
 * katmanındadır (`app.log` erişimi bu saf/test edilebilir dosyada YOKTUR): LiveKit sunucusuna
 * ulaşılamazsa oda yine de İLK `roomJoin` token'ıyla OTOMATİK oluşur (sunucunun kendi varsayılan
 * timeout'larıyla) — görüşme akışı BOZULMAZ, yalnızca bu turun ÖNGÖRÜLEBİLİR timeout garantisi
 * kaçırılmış olur.
 */
export async function ensureRoomConfigured(roomName: string, config: LiveKitConfig = getLiveKitConfig()): Promise<void> {
  if (!config.internalUrl) return;
  const client = getRoomServiceClient(config);
  await client.createRoom({
    name: roomName,
    emptyTimeout: config.roomEmptyTimeoutSec,
    departureTimeout: config.roomDepartureTimeoutSec,
  });
}

export type MeetingParticipantKind = "patient" | "doctor";

export interface MeetingTokenParticipant {
  kind: MeetingParticipantKind;
  /**
   * §8 madde 1 (bağlayıcı) — KİŞİSEL VERİ İÇERMEZ: hasta için `Appointment.id`, doktor için
   * `DoctorProfile.id`. E-posta/ad ASLA buraya yazılmaz. Nihai `identity`,
   * `${kind}:${id}` biçiminde üretilir (bkz. `buildParticipantIdentity`).
   */
  id: string;
}

/** Katılımcı kimliğini üretir — tek yer, testlerle sabitlenir (PII İÇERMEZ, §8 madde 1). */
export function buildParticipantIdentity(participant: MeetingTokenParticipant): string {
  return `${participant.kind}:${participant.id}`;
}

export interface MeetingTokenResult {
  token: string;
  serverUrl: string;
  roomName: string;
  /** ISO-8601 `Z`'li an — token'ın son geçerlilik zamanı (§8: TTL ≤ `LIVEKIT_TOKEN_TTL_MIN`). */
  expiresAt: string;
}

/**
 * §8 madde 1 (bağlayıcı) — grant kapsamı YALNIZCA `roomJoin: true, room: <roomName>`.
 * `roomCreate`/`roomAdmin`/`roomList`/`ingressAdmin` KESİNLİKLE VERİLMEZ. Çağıran, bu
 * fonksiyonu çağırmadan ÖNCE `isLiveKitConfigured()`'ı kendisi kontrol etmelidir — burada
 * TEKRAR kontrol edilmez ki "yapılandırılmamış" durumunun HTTP kod eşlemesi (503) yalnızca
 * route katmanında bir kez karar verilsin.
 */
export async function createMeetingToken(
  input: { roomName: string; participant: MeetingTokenParticipant },
  config: LiveKitConfig = getLiveKitConfig()
): Promise<MeetingTokenResult> {
  const ttlSeconds = config.tokenTtlMin * 60;
  const identity = buildParticipantIdentity(input.participant);

  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    ttl: ttlSeconds,
  });
  accessToken.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canSubscribe: true,
    // Bug-fix turu (2026-09-18) — daha önce zımnen (SDK varsayılanı) veriliyordu; hasta/doktor
    // AYRIMI OLMADAN açıkça yazılır ki kayıt sinyali (`RecordingSignalBridge`'in `RoomEvent.
    // DataReceived` dinleyicisi, `telehealth.recording` topic'i) HER İKİ katılımcı için de garanti
    // altında olsun.
    canPublishData: true,
  });

  const token = await accessToken.toJwt();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return { token, serverUrl: config.url, roomName: input.roomName, expiresAt };
}
