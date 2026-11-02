import type { FastifyInstance } from "fastify";
import type { ExternalMeeting, Prisma, SiteRole } from "@prisma/client";
import { canHostMeetings } from "../../lib/meeting-host";
import { logAudit } from "../../lib/audit";
import { MeetingHostForbiddenError, MeetingNotFoundError } from "../../lib/errors";
import { doctorDisplayName } from "../../lib/doctor-display-name";
import { MEETING_JOIN_LEAD_MS, kickAllMeetingParticipants } from "../telehealth/lib/meeting-livekit";

/** Gelecekte (bitmemiş, iptal edilmemiş) toplantı sayısı üst sınırı — kullanıcı başına. */
export const MAX_FUTURE_MEETINGS_PER_HOST = 20;
/** Misafir bağlantısı e-postayla en çok bu kadar gönderilebilir (toplantı başına). */
export const MAX_INVITE_EMAILS_PER_MEETING = 10;
/** Toplantı başına en çok bu kadar misafir oturumu (bağlantı sızdırılıp bot ile doldurulmasın). */
export const MAX_GUEST_SESSIONS_PER_MEETING = 50;
/** `startsAt` geçmişe en çok bu kadar yakın olabilir (saat sapması / hemen başlat payı). */
export const START_PAST_TOLERANCE_MS = 5 * 60_000;
export const START_MAX_AHEAD_MS = 180 * 24 * 60 * 60_000;

export type MeetingPhase = "upcoming" | "open" | "ended" | "cancelled";

type MeetingTimes = Pick<ExternalMeeting, "status" | "startsAt" | "endsAt">;

export function computePhase(meeting: MeetingTimes, now: Date = new Date()): MeetingPhase {
  if (meeting.status === "CANCELLED") return "cancelled";
  if (now.getTime() >= meeting.endsAt.getTime()) return "ended";
  if (now.getTime() >= meeting.startsAt.getTime() - MEETING_JOIN_LEAD_MS) return "open";
  return "upcoming";
}

export function meetingOpensAt(meeting: Pick<ExternalMeeting, "startsAt">): Date {
  return new Date(meeting.startsAt.getTime() - MEETING_JOIN_LEAD_MS);
}

/** Hiçbir zaman belirteç veya özet taşımaz. */
export function toMeetingDto(meeting: ExternalMeeting, now: Date = new Date()) {
  return {
    id: meeting.id,
    title: meeting.title,
    note: meeting.note,
    startsAt: meeting.startsAt.toISOString(),
    endsAt: meeting.endsAt.toISOString(),
    durationMin: meeting.durationMin,
    maxParticipants: meeting.maxParticipants,
    autoAdmitGuests: meeting.autoAdmitGuests,
    status: meeting.status,
    phase: computePhase(meeting, now),
    hostJoinedAt: meeting.hostJoinedAt ? meeting.hostJoinedAt.toISOString() : null,
    guestLinkActive: meeting.guestTokenHash !== null && meeting.status === "SCHEDULED" && now.getTime() < meeting.endsAt.getTime(),
    opensAt: meetingOpensAt(meeting).toISOString(),
    createdAt: meeting.createdAt.toISOString(),
  };
}

/** Admin gözetimi: ev sahibinin NOTU ve misafir adları yoktur. */
export function toAdminMeetingDto(meeting: ExternalMeeting & { host: { id: string; name: string } }, now: Date = new Date()) {
  const { note: _note, ...rest } = toMeetingDto(meeting, now);
  return { ...rest, host: { id: meeting.host.id, name: meeting.host.name } };
}

// --- Liste imleci: (startsAt, seq) anahtarlı; seq tek başına startsAt sıralamasıyla uyuşmaz. ---

export function encodeMeetingCursor(meeting: Pick<ExternalMeeting, "startsAt" | "seq">): string {
  return Buffer.from(`${meeting.startsAt.getTime()}.${meeting.seq}`).toString("base64url");
}

function decodeMeetingCursor(cursor: string | undefined): { startsAt: Date; seq: number } | null {
  if (!cursor) return null;
  try {
    const [ms, seq] = Buffer.from(cursor, "base64url").toString("utf8").split(".");
    const startsAt = new Date(Number(ms));
    const seqNum = Number(seq);
    if (Number.isNaN(startsAt.getTime()) || !Number.isInteger(seqNum)) return null;
    return { startsAt, seq: seqNum };
  } catch {
    return null;
  }
}

/** `scope`/imleç koşulları ve sıralama. upcoming: startsAt artan; past/all: startsAt azalan. */
export function buildMeetingListQuery(scope: "upcoming" | "past" | "all", cursor: string | undefined, now: Date) {
  const asc = scope === "upcoming";
  const and: Prisma.ExternalMeetingWhereInput[] = [];
  if (scope === "upcoming") and.push({ status: "SCHEDULED", endsAt: { gt: now } });
  if (scope === "past") and.push({ OR: [{ status: "CANCELLED" }, { endsAt: { lte: now } }] });
  const c = decodeMeetingCursor(cursor);
  if (c) {
    const cmp = asc ? "gt" : "lt";
    and.push({ OR: [{ startsAt: { [cmp]: c.startsAt } }, { startsAt: c.startsAt, seq: { [cmp]: c.seq } }] });
  }
  const direction = asc ? "asc" : "desc";
  return { where: { AND: and } satisfies Prisma.ExternalMeetingWhereInput, orderBy: [{ startsAt: direction }, { seq: direction }] as Prisma.ExternalMeetingOrderByWithRelationInput[] };
}

export interface MeetingHostUser {
  id: string;
  email: string;
  name: string;
  role: SiteRole;
  twoFactorEnabled: boolean;
}

/**
 * Ev sahibi uçlarının ortak ön koşulu — HER istekte taze DB okuması (geri alınan yetki anında etkili olur).
 * 2FA İSTENMEZ (kullanıcı kararı S2); durum `twoFactorEnabled` olarak döner, frontend bilgilendirme gösterir.
 */
export async function requireMeetingHost(app: FastifyInstance, userId: string): Promise<MeetingHostUser & { displayName: string }> {
  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      twoFactorEnabled: true,
      meetingHostGrantedAt: true,
      doctorProfile: { select: { id: true, title: true, fullName: true, publicName: true, isFounder: true } },
    },
  });
  if (!user || user.status !== "ACTIVE" || !canHostMeetings(user)) throw new MeetingHostForbiddenError();
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
    displayName: hostDisplayName(user),
  };
}

/** Doktorsa `unvan + görünen ad` (Paket U kısaltma kuralı), değilse kullanıcı adı. PII yok (e-posta ASLA). */
export function hostDisplayName(user: {
  name: string;
  doctorProfile?: { title: string; fullName: string; publicName: string | null; isFounder: boolean } | null;
}): string {
  if (user.doctorProfile) return `${user.doctorProfile.title} ${doctorDisplayName(user.doctorProfile)}`.trim();
  return user.name;
}

/** Başkasının (ADMIN dahil) veya olmayan toplantı → 404 (varlık sızdırılmaz). */
export async function loadOwnMeeting(app: FastifyInstance, id: string, hostUserId: string): Promise<ExternalMeeting> {
  const meeting = await app.prisma.externalMeeting.findFirst({ where: { id, hostUserId } });
  if (!meeting) throw new MeetingNotFoundError();
  return meeting;
}

export interface CancelContext {
  actorId: string;
  actorEmail: string;
  ipAddress: string | null;
  source: "host" | "admin";
}

/**
 * Toplantıyı iptal eder: durum + misafir bağlantısı iptali (tek güncelleme), audit, ardından odadaki herkesi
 * best-effort atar (kesin kapanışı + `closedAt`'i süpürücü yazar). Zaten iptal edilmişse idempotent.
 */
export async function cancelMeeting(app: FastifyInstance, meeting: ExternalMeeting, ctx: CancelContext): Promise<ExternalMeeting> {
  if (meeting.status === "CANCELLED") return meeting;
  const now = new Date();
  const updated = await app.prisma.externalMeeting.update({
    where: { id: meeting.id },
    data: { status: "CANCELLED", cancelledAt: now, cancelledById: ctx.actorId, guestTokenHash: null, guestTokenCreatedAt: null },
  });
  await logAudit(app, {
    actorId: ctx.actorId,
    actorEmail: ctx.actorEmail,
    action: "meeting.cancelled",
    targetType: "ExternalMeeting",
    targetId: meeting.id,
    metadata: { source: ctx.source },
    ipAddress: ctx.ipAddress,
  });
  try {
    await kickAllMeetingParticipants(meeting.roomName);
  } catch (err) {
    app.log.warn({ err, meetingId: meeting.id }, "İptal edilen toplantının odası hemen boşaltılamadı; süpürücü tekrar deneyecek.");
  }
  return updated;
}
