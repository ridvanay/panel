import type { FastifyInstance } from "fastify";
import type { ExternalMeeting, Prisma, SiteRole } from "@prisma/client";
import { canHostMeetings } from "../../lib/meeting-host";
import { logAudit } from "../../lib/audit";
import { MeetingHostForbiddenError, MeetingManagedByServiceDeskError, MeetingNotFoundError } from "../../lib/errors";
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

/** Liste/ayrıntı sorgularına eklenen ilişki: hizmete (AI İş 3) bağlı toplantıyı ayırt etmek için. */
export const SERVICE_LINK_INCLUDE = { serviceConsultation: { select: { seq: true } } } as const;

type MeetingWithLink = ExternalMeeting & { serviceConsultation?: { seq: number } | null };

/** `SVC-00012` — ServiceConsultation görünen numarası (service-consultation-tokens ile aynı biçim). */
function consultationNumber(seq: number): string {
  return `SVC-${String(seq).padStart(5, "0")}`;
}

/**
 * Hiçbir zaman belirteç veya özet taşımaz. `serviceConsultation`: hizmete bağlı toplantıda `{ consultationNumber }`
 * (FE rozeti; düzenle/iptal/bağlantı eylemleri gizlenir), değilse `null`.
 */
export function toMeetingDto(meeting: MeetingWithLink, now: Date = new Date()) {
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
    serviceConsultation: meeting.serviceConsultation ? { consultationNumber: consultationNumber(meeting.serviceConsultation.seq) } : null,
  };
}

/** Admin listesi sorgusu: ev sahibi adı (doktorsa kısaltılmış görünen ad) + hizmete bağlıysa koordinatör etiketi için. */
export const ADMIN_MEETING_INCLUDE = {
  host: { select: { id: true, name: true, doctorProfile: { select: { fullName: true, publicName: true, isFounder: true } } } },
  serviceConsultation: { select: { seq: true, coordinator: { select: { displayName: true } } } },
} as const;

type AdminMeetingRow = ExternalMeeting & {
  host: { id: string; name: string; doctorProfile?: { fullName: string; publicName: string | null; isFounder: boolean } | null };
  serviceConsultation?: { seq: number; coordinator?: { displayName: string } | null } | null;
};

/**
 * Admin gözetimi: ev sahibinin NOTU ve misafir adları yoktur. `hostName`: unvansız görünen ad; hizmete bağlıysa
 * "Patient Coordinator · <displayName>". `host` ({id,name}) geriye dönük uyumluluk için kalır.
 */
export function toAdminMeetingDto(meeting: AdminMeetingRow, now: Date = new Date()) {
  const { note: _note, ...rest } = toMeetingDto(meeting, now);
  const coordinator = meeting.serviceConsultation?.coordinator;
  const hostName = coordinator ? serviceCoordinatorLabel(coordinator.displayName) : hostDisplayName(meeting.host);
  return { ...rest, hostName, host: { id: meeting.host.id, name: meeting.host.name } };
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
      doctorProfile: { select: { id: true, fullName: true, publicName: true, isFounder: true } },
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

/**
 * Misafirin gördüğü ev sahibi adı (ön ekran + oda etiketi): doktorsa kısaltılmış görünen ad (Paket U kuralı),
 * değilse kullanıcı adı. Unvan (Dr./Prof.) EKLENMEZ (ziyaretçi tarafında doktor unvanı gösterilmez kuralı).
 * PII yok (e-posta ASLA).
 */
export function hostDisplayName(user: {
  name: string;
  doctorProfile?: { fullName: string; publicName: string | null; isFounder: boolean } | null;
}): string {
  if (user.doctorProfile) return doctorDisplayName(user.doctorProfile).trim() || user.name;
  return user.name;
}

/** Hizmet görüşmesinde ev sahibinin odada/ön ekranda görünen adı (unvan YOK; kaynak `CoordinatorProfile.displayName`). */
export function serviceCoordinatorLabel(displayName: string): string {
  return `Patient Coordinator · ${displayName}`;
}

/** Başkasının (ADMIN dahil) veya olmayan toplantı → 404 (varlık sızdırılmaz). */
export async function loadOwnMeeting(app: FastifyInstance, id: string, hostUserId: string): Promise<MeetingWithLink> {
  const meeting = await app.prisma.externalMeeting.findFirst({ where: { id, hostUserId }, include: SERVICE_LINK_INCLUDE });
  if (!meeting) throw new MeetingNotFoundError();
  return meeting;
}

/** Düzenle/iptal/bağlantı/davet uçları için: hizmete bağlı toplantı AG uçlarından yönetilemez (409). */
export async function loadOwnManageableMeeting(app: FastifyInstance, id: string, hostUserId: string): Promise<ExternalMeeting> {
  const meeting = await loadOwnMeeting(app, id, hostUserId);
  if (meeting.serviceConsultation) throw new MeetingManagedByServiceDeskError();
  return meeting;
}

export async function assertNotServiceManaged(app: FastifyInstance, meetingId: string): Promise<void> {
  const linked = await app.prisma.serviceConsultation.count({ where: { meetingId } });
  if (linked > 0) throw new MeetingManagedByServiceDeskError();
}

export interface CancelContext {
  /** Hasta yonetim baglantisiyla iptalde (`source: "service"`) kisi yoktur. */
  actorId: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  source: "host" | "admin" | "service";
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
  await afterMeetingCancelled(app, updated, ctx);
  return updated;
}

/** Iptal sonrasi adimlar (audit + odadakileri best-effort atma); durum guncellemesi cagirana aittir (AI hizmet masasi kendi islemiyle yazar). */
export async function afterMeetingCancelled(app: FastifyInstance, meeting: ExternalMeeting, ctx: CancelContext): Promise<void> {
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
}
