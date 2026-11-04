import crypto from "node:crypto";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import {
  getLiveKitConfig,
  listRoomParticipantIdentities,
  removeRoomParticipant,
  type LiveKitConfig,
  type MeetingTokenResult,
} from "./livekit";

/**
 * Paket AG (İş 3) — harici görüntülü toplantı için AYRI token üreticisi ve oda yardımcıları.
 *
 * KIRMIZI ÇİZGİ: `lib/livekit.ts` içindeki mevcut fonksiyonlar (createMeetingToken, createQaListenerToken,
 * createInterpreterToken, ensureRoomConfigured) çağrılmaz ve değişmez; bu dosya oradan yalnızca yapılandırma
 * okuyucularını ve katılımcı listele/at yardımcılarını İÇE AKTARIR. `meet_` odalarında kayıt (egress) başlatan
 * hiçbir yol yoktur; grant'larda `roomRecord`/`roomAdmin`/`roomCreate`/`roomList`/`hidden`/`recorder` VERİLMEZ.
 */

export const MEETING_ROOM_PREFIX = "meet_";
export const MEETING_HOST_IDENTITY_PREFIX = "meet-host:";
export const MEETING_GUEST_IDENTITY_PREFIX = "meet-guest:";
export const MEETING_JOIN_LEAD_MS = 15 * 60_000;
/** Bitişten sonra odadakiler için kapanış payı (S7); bu süreden sonra sunucu tarafından çıkarılırlar. */
export const MEETING_END_GRACE_MS = 10 * 60_000;
const MIN_TOKEN_TTL_SEC = 60;

export const MEETING_HOST_ROLE = "meeting_host";
export const MEETING_GUEST_ROLE = "meeting_guest";

export function generateMeetingRoomName(): string {
  return `${MEETING_ROOM_PREFIX}${crypto.randomBytes(16).toString("hex")}`;
}

export function isMeetingRoomName(roomName: string): boolean {
  return roomName.startsWith(MEETING_ROOM_PREFIX);
}

export function isMeetingIdentity(identity: string): boolean {
  return identity.startsWith(MEETING_HOST_IDENTITY_PREFIX) || identity.startsWith(MEETING_GUEST_IDENTITY_PREFIX);
}

export const buildMeetingHostIdentity = (userId: string) => `${MEETING_HOST_IDENTITY_PREFIX}${userId}`;
export const buildMeetingGuestIdentity = (guestId: string) => `${MEETING_GUEST_IDENTITY_PREFIX}${guestId}`;

let cachedClient: { key: string; client: RoomServiceClient } | null = null;
function getClient(config: LiveKitConfig): RoomServiceClient {
  const key = `${config.internalUrl}:${config.apiKey}`;
  if (!cachedClient || cachedClient.key !== key) {
    cachedClient = { key, client: new RoomServiceClient(config.internalUrl, config.apiKey, config.apiSecret) };
  }
  return cachedClient.client;
}

/**
 * Odayı mevcut boşta-kapanma ayarlarıyla ve `maxParticipants` (ev sahibi dahil) ile açar. `CreateRoom` idempotenttir;
 * `maxParticipants` yalnızca oda İLK oluşturulurken uygulanır. `internalUrl` boşsa sessizce atlanır (oda ilk
 * `roomJoin` token'ıyla sunucu varsayılanlarıyla oluşur). Hata çağırana fırlar; route best-effort yakalar.
 */
export async function ensureMeetingRoom(roomName: string, maxParticipants: number, config: LiveKitConfig = getLiveKitConfig()): Promise<void> {
  if (!isMeetingRoomName(roomName)) throw new Error("ensureMeetingRoom yalnızca meet_ odalarında çalışır.");
  if (!config.internalUrl) return;
  await getClient(config).createRoom({
    name: roomName,
    emptyTimeout: config.roomEmptyTimeoutSec,
    departureTimeout: config.roomDepartureTimeoutSec,
    maxParticipants,
  });
}

/** TTL = clamp(endsAt + grace - şimdi, 60 sn, LIVEKIT_TOKEN_TTL_MIN). Yalnızca (yeniden) katılımı sınırlar; kapanışı süpürücü sağlar. */
export function computeMeetingTokenTtlSec(endsAt: Date, config: LiveKitConfig, nowMs: number = Date.now()): number {
  const untilEnd = Math.floor((endsAt.getTime() + MEETING_END_GRACE_MS - nowMs) / 1000);
  return Math.max(MIN_TOKEN_TTL_SEC, Math.min(untilEnd, config.tokenTtlMin * 60));
}

async function signMeetingToken(
  input: { roomName: string; identity: string; displayName: string; role: string; endsAt: Date; sources: TrackSource[] },
  config: LiveKitConfig
): Promise<MeetingTokenResult & { identity: string }> {
  if (!isMeetingRoomName(input.roomName)) throw new Error("Toplantı token'ı yalnızca meet_ odaları için üretilir.");
  const nowMs = Date.now();
  const ttlSeconds = computeMeetingTokenTtlSec(input.endsAt, config, nowMs);
  const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
    identity: input.identity,
    name: input.displayName,
    metadata: JSON.stringify({ role: input.role }),
    ttl: ttlSeconds,
  });
  accessToken.addGrant({
    roomJoin: true,
    room: input.roomName,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: input.sources,
    // Toplantıda sohbet / kayıt sinyali yok; veri kanalı kötüye kullanım yüzeyi kapatılır.
    canPublishData: false,
    // Rol/ad metadata'sı istemci tarafından değiştirilemez (misafir "Ev sahibi" görünemez).
    canUpdateOwnMetadata: false,
  });
  const token = await accessToken.toJwt();
  return { token, serverUrl: config.url, roomName: input.roomName, expiresAt: new Date(nowMs + ttlSeconds * 1000).toISOString(), identity: input.identity };
}

export function createMeetingHostToken(
  input: { roomName: string; userId: string; displayName: string; endsAt: Date },
  config: LiveKitConfig = getLiveKitConfig()
) {
  return signMeetingToken(
    {
      roomName: input.roomName,
      identity: buildMeetingHostIdentity(input.userId),
      displayName: input.displayName,
      role: MEETING_HOST_ROLE,
      endsAt: input.endsAt,
      sources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    },
    config
  );
}

/** Misafirde ekran paylaşımı YOK — sunucuda grant ile zorlanır (tercüman deseni). */
export function createMeetingGuestToken(
  input: { roomName: string; guestId: string; displayName: string; endsAt: Date },
  config: LiveKitConfig = getLiveKitConfig()
) {
  return signMeetingToken(
    {
      roomName: input.roomName,
      identity: buildMeetingGuestIdentity(input.guestId),
      displayName: input.displayName,
      role: MEETING_GUEST_ROLE,
      endsAt: input.endsAt,
      sources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    },
    config
  );
}

/** Odadaki katılımcı kimlikleri; `null` = Server API yapılandırılmamış (`LIVEKIT_INTERNAL_URL` boş). */
export function listMeetingParticipants(roomName: string): Promise<string[] | null> {
  return listRoomParticipantIdentities(roomName);
}

/** LiveKit `ParticipantInfo_State`: JOINING=0, JOINED=1, ACTIVE=2, DISCONNECTED=3. Kapasiteye yalnız JOINED/ACTIVE sayılır. */
export function isCountedParticipantState(state: number): boolean {
  return state === 1 || state === 2;
}

/**
 * Paket AM — kapasite için odadaki SAYILAN (JOINED/ACTIVE) kimlikler. `null` = Server API yok. Hata fırlatabilir;
 * çağıran yakalayıp mevcut (durumsuz) sayıma düşer.
 */
export async function listMeetingCountedIdentities(roomName: string, config: LiveKitConfig = getLiveKitConfig()): Promise<string[] | null> {
  if (!config.internalUrl) return null;
  try {
    const participants = await getClient(config).listParticipants(roomName);
    return participants.filter((p) => isCountedParticipantState(p.state)).map((p) => p.identity);
  } catch (err) {
    if ((err as { code?: string }).code === "not_found") return [];
    throw err;
  }
}

/** Tek atma kapısı: yalnızca `meet_` odası + `meet-host:`/`meet-guest:` kimliği. Aksi hâlde HİÇ çağrı yapılmaz. */
export async function removeMeetingParticipant(roomName: string, identity: string): Promise<boolean> {
  if (!isMeetingRoomName(roomName) || !isMeetingIdentity(identity)) {
    throw new Error("Yalnızca meet_ odalarındaki meet-* katılımcıları atılabilir.");
  }
  return removeRoomParticipant(roomName, identity);
}

export interface MeetingRoomDeps {
  listParticipants: (roomName: string) => Promise<string[] | null>;
  removeParticipant: (roomName: string, identity: string) => Promise<boolean>;
}

export const DEFAULT_MEETING_ROOM_DEPS: MeetingRoomDeps = {
  listParticipants: listMeetingParticipants,
  removeParticipant: removeMeetingParticipant,
};

/**
 * Odadaki TÜM `meet-host:`/`meet-guest:` katılımcılarını atar. `unavailable` = Server API yok (hiçbir şey
 * atılamaz); atma hatası çağırana fırlar (çağıran `closedAt` yazmaz, sonraki turda yeniden dener).
 */
export async function kickAllMeetingParticipants(roomName: string, deps: MeetingRoomDeps = DEFAULT_MEETING_ROOM_DEPS): Promise<{ removed: number; unavailable: boolean }> {
  if (!isMeetingRoomName(roomName)) throw new Error("meet_ olmayan oda boşaltılamaz.");
  const identities = await deps.listParticipants(roomName);
  if (identities === null) return { removed: 0, unavailable: true };
  let removed = 0;
  for (const identity of identities) {
    if (!isMeetingIdentity(identity)) continue;
    if (await deps.removeParticipant(roomName, identity)) removed += 1;
  }
  return { removed, unavailable: false };
}
