import { AccessToken } from "livekit-server-sdk";
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
  /** Dakika — bkz. `LIVEKIT_TOKEN_TTL_MIN`, varsayılan 15, tavan 60 (env.ts şeması). */
  tokenTtlMin: number;
}

/** Test edilebilirlik için `env`'den AYRI bir config nesnesi enjekte edilebilir. */
export function getLiveKitConfig(): LiveKitConfig {
  return {
    url: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    tokenTtlMin: env.LIVEKIT_TOKEN_TTL_MIN,
  };
}

/** §4.4 madde 3 — üç değişkenin HEPSİ dolu değilse LiveKit "yapılandırılmamış" sayılır. */
export function isLiveKitConfigured(config: LiveKitConfig = getLiveKitConfig()): boolean {
  return Boolean(config.url && config.apiKey && config.apiSecret);
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
  });

  const token = await accessToken.toJwt();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return { token, serverUrl: config.url, roomName: input.roomName, expiresAt };
}
