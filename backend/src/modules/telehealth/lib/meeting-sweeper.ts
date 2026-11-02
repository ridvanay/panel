import type { FastifyInstance } from "fastify";
import { env } from "../../../config/env";
import { logAudit } from "../../../lib/audit";
import {
  DEFAULT_MEETING_ROOM_DEPS,
  MEETING_END_GRACE_MS,
  buildMeetingGuestIdentity,
  isMeetingRoomName,
  kickAllMeetingParticipants,
  type MeetingRoomDeps,
} from "./meeting-livekit";

/**
 * Paket AG (İş 3) — harici toplantı odalarının sunucu tarafında kapatılması ve misafir adı saklama süresi.
 * LiveKit bağlı katılımcının token'ını yenilediği için TTL oturumu sınırlamaz (bkz. qa-listener-sweeper);
 * toplantı sonunu ve iptali bu süpürücü uygular.
 *
 * Dakikada bir:
 *  A) `closedAt` boş ve (iptal edilmiş VEYA `endsAt + 10 dk` geçmiş) toplantıların odası boşaltılır, `closedAt`
 *     yazılır, `meeting.closed` audit'i düşülür. Atma başarısız olursa `closedAt` YAZILMAZ, sonraki turda tekrar denenir.
 *  B) İptal edilip kapatılmış ama elinde hâlâ geçerli token olabilecek (iptalden itibaren `LIVEKIT_TOKEN_TTL_MIN`)
 *     toplantılarda geri dönen katılımcılar yeniden atılır (audit yok).
 *  C) Ev sahibinin çıkardığı (`removedAt` dolu) misafir canlı odada kalmışsa / eski token'la dönmüşse atılır.
 *
 * GÜVENLİK KURALI: yalnızca `meet_` önekli oda ve `meet-host:`/`meet-guest:` kimlikleri; `room_` odalarına
 * (hasta/doktor görüşmesi) bu modülden HİÇBİR şekilde dokunulmaz — önek tutmayan oda atlanır ve hata loglanır.
 *
 * Misafir adı saklama (S6): toplantı bitişinden 90 gün sonra `ExternalMeetingGuest` satırları silinir.
 */

export const MEETING_SWEEP_INTERVAL_MS = 60 * 1000;
export const MEETING_GUEST_RETENTION_DAYS = 90;
export const MEETING_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 50;

export type MeetingCloseReason = "cancelled" | "ended";

export interface MeetingSweepResult {
  closed: Array<{ meetingId: string; reason: MeetingCloseReason; removed: number; unavailable: boolean }>;
  strayRemoved: Array<{ meetingId: string; removed: number }>;
  removedGuestsKicked: Array<{ meetingId: string; guestId: string }>;
}

export interface MeetingSweepOptions {
  now?: Date;
  deps?: MeetingRoomDeps;
  /** İptal sonrası geri dönen katılımcı taraması süresi (ms); varsayılan `LIVEKIT_TOKEN_TTL_MIN`. */
  tokenTtlMs?: number;
}

export async function runMeetingSweep(app: FastifyInstance, options: MeetingSweepOptions = {}): Promise<MeetingSweepResult> {
  const now = options.now ?? new Date();
  const deps = options.deps ?? DEFAULT_MEETING_ROOM_DEPS;
  const tokenTtlMs = options.tokenTtlMs ?? env.LIVEKIT_TOKEN_TTL_MIN * 60_000;
  const result: MeetingSweepResult = { closed: [], strayRemoved: [], removedGuestsKicked: [] };

  // A) kapatılacak toplantılar
  const toClose = await app.prisma.externalMeeting.findMany({
    where: {
      closedAt: null,
      OR: [{ status: "CANCELLED" }, { endsAt: { lt: new Date(now.getTime() - MEETING_END_GRACE_MS) } }],
    },
    select: { id: true, roomName: true, status: true },
    orderBy: { endsAt: "asc" },
    take: BATCH,
  });
  for (const meeting of toClose) {
    if (!isMeetingRoomName(meeting.roomName)) {
      app.log.error({ meetingId: meeting.id }, "Toplantı odası meet_ önekli değil — süpürücü bu odaya DOKUNMADI.");
      continue;
    }
    let outcome: { removed: number; unavailable: boolean };
    try {
      outcome = await kickAllMeetingParticipants(meeting.roomName, deps);
    } catch (err) {
      app.log.warn({ err, meetingId: meeting.id }, "Toplantı odası boşaltılamadı; sonraki turda tekrar denenecek.");
      continue;
    }
    const reason: MeetingCloseReason = meeting.status === "CANCELLED" ? "cancelled" : "ended";
    const { count } = await app.prisma.externalMeeting.updateMany({ where: { id: meeting.id, closedAt: null }, data: { closedAt: now } });
    if (count === 0) continue;
    await logAudit(app, {
      actorId: null,
      actorEmail: null,
      action: "meeting.closed",
      targetType: "ExternalMeeting",
      targetId: meeting.id,
      metadata: { reason, removed: outcome.removed, unavailable: outcome.unavailable },
      ipAddress: null,
    });
    result.closed.push({ meetingId: meeting.id, reason, ...outcome });
  }

  // B) iptal edilmiş ve kapatılmış ama token'ı hâlâ geçerli olabilecek toplantılar — geri dönenler tekrar atılır
  const recentlyCancelled = await app.prisma.externalMeeting.findMany({
    where: { status: "CANCELLED", closedAt: { not: null, lt: now }, cancelledAt: { gt: new Date(now.getTime() - tokenTtlMs) } },
    select: { id: true, roomName: true },
    take: BATCH,
  });
  for (const meeting of recentlyCancelled) {
    if (!isMeetingRoomName(meeting.roomName)) continue;
    try {
      const outcome = await kickAllMeetingParticipants(meeting.roomName, deps);
      if (outcome.removed > 0) result.strayRemoved.push({ meetingId: meeting.id, removed: outcome.removed });
    } catch (err) {
      app.log.warn({ err, meetingId: meeting.id }, "İptal edilmiş toplantıya dönen katılımcı atılamadı; sonraki turda tekrar denenecek.");
    }
  }

  // C) çıkarılmış misafir canlı odada kalmış / dönmüşse at
  const removedGuests = await app.prisma.externalMeetingGuest.findMany({
    where: { removedAt: { not: null }, meeting: { status: "SCHEDULED", closedAt: null, endsAt: { gt: new Date(now.getTime() - MEETING_END_GRACE_MS) } } },
    select: { id: true, meeting: { select: { id: true, roomName: true } } },
    take: BATCH * 4,
  });
  const byRoom = new Map<string, { meetingId: string; guestIds: string[] }>();
  for (const guest of removedGuests) {
    const entry = byRoom.get(guest.meeting.roomName) ?? { meetingId: guest.meeting.id, guestIds: [] };
    entry.guestIds.push(guest.id);
    byRoom.set(guest.meeting.roomName, entry);
  }
  for (const [roomName, entry] of byRoom) {
    if (!isMeetingRoomName(roomName)) continue;
    try {
      const present = await deps.listParticipants(roomName);
      if (present === null) break; // LiveKit Server API yapılandırılmamış
      for (const guestId of entry.guestIds) {
        const identity = buildMeetingGuestIdentity(guestId);
        if (!present.includes(identity)) continue;
        if (await deps.removeParticipant(roomName, identity)) result.removedGuestsKicked.push({ meetingId: entry.meetingId, guestId });
      }
    } catch (err) {
      app.log.warn({ err, meetingId: entry.meetingId }, "Çıkarılmış misafir odadan atılamadı; sonraki turda tekrar denenecek.");
    }
  }

  return result;
}

/** Misafir adı saklama süresi (S6): toplantı bitişinden 90 gün sonra misafir satırlarını siler. Toplantı satırı KALIR. */
export async function runMeetingGuestRetention(app: FastifyInstance, now: Date = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - MEETING_GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await app.prisma.externalMeetingGuest.deleteMany({ where: { meeting: { endsAt: { lt: cutoff } } } });
  return { deleted: count };
}

/** Dakikalık kadans; test ortamında zamanlayıcı kurulmaz (testler `runMeetingSweep` / `runMeetingGuestRetention`'ı doğrudan çağırır). */
export function registerMeetingSweeper(app: FastifyInstance): void {
  if (env.NODE_ENV === "test") return;
  const runSweep = () => {
    runMeetingSweep(app)
      .then((result) => {
        if (result.closed.length > 0 || result.strayRemoved.length > 0 || result.removedGuestsKicked.length > 0) {
          app.log.info(
            { closed: result.closed.length, strayRemoved: result.strayRemoved.length, removedGuestsKicked: result.removedGuestsKicked.length },
            "Harici toplantı odaları sunucu tarafında kapatıldı (meeting-sweeper)"
          );
        }
      })
      .catch((err) => app.log.error({ err }, "Toplantı süpürücüsü taraması başarısız oldu"));
  };
  const runRetention = () => {
    runMeetingGuestRetention(app)
      .then(({ deleted }) => {
        if (deleted > 0) app.log.info({ deleted }, "Süresi dolan toplantı misafir kayıtları silindi (meeting-sweeper)");
      })
      .catch((err) => app.log.error({ err }, "Toplantı misafir saklama temizliği başarısız oldu"));
  };

  const timer = setInterval(runSweep, MEETING_SWEEP_INTERVAL_MS);
  const retentionTimer = setInterval(runRetention, MEETING_RETENTION_INTERVAL_MS);
  timer.unref();
  retentionTimer.unref();
  // İlk temizlik açılıştan kısa süre sonra (saatlik döngüyü beklemeden).
  const first = setTimeout(runRetention, 30_000);
  first.unref();
  app.addHook("onClose", () => {
    clearInterval(timer);
    clearInterval(retentionTimer);
    clearTimeout(first);
  });
}
