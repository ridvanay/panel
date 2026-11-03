import type { CoordinatorProfile, Prisma, PrismaClient, ServiceDesk } from "@prisma/client";
import { ConflictError, ServiceNotBookableError } from "../../lib/errors";
import { computeDeskSlots, freeCoordinatorsForStart, type BusyInterval, type DeskSlotInput } from "./service-slots";

export const SERVICE_DESK_ID = "main";
export const SERVICE_CONSULTATION_CONSENT_VERSION = "service-consultation-v1";
export const SERVICE_CONSULTATION_HOST_TITLE = "WM Health online consultation";
export const MAX_SLOT_RANGE_DAYS = 31;
const SETTINGS_ID = "singleton";

type Db = PrismaClient | Prisma.TransactionClient;

/** Tek masa; satır yoksa varsayılanlarla oluşturulur (sabit id, yarışta tek satır). */
export async function getOrCreateDesk(db: Db): Promise<ServiceDesk> {
  return db.serviceDesk.upsert({ where: { id: SERVICE_DESK_ID }, create: { id: SERVICE_DESK_ID }, update: {} });
}

export interface ActiveCoordinator extends Pick<CoordinatorProfile, "id" | "userId" | "displayName" | "languages" | "lastAssignedAt"> {
  email: string;
}

/** Aktif koordinatörler: profil aktif + kullanıcı ACTIVE + doktor profili YOK. */
export async function loadActiveCoordinators(db: Db): Promise<ActiveCoordinator[]> {
  const rows = await db.coordinatorProfile.findMany({
    where: { isActive: true, user: { status: "ACTIVE", doctorProfile: null } },
    select: { id: true, userId: true, displayName: true, languages: true, lastAssignedAt: true, user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(({ user, ...r }) => ({ ...r, email: user.email }));
}

export async function isBookingFlagOn(db: Db): Promise<boolean> {
  const row = await db.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { serviceBookingEnabled: true } });
  return Boolean(row?.serviceBookingEnabled);
}

export interface DeskContext {
  desk: ServiceDesk;
  hours: Array<{ id: string; dayOfWeek: number; startMinute: number; endMinute: number }>;
  closureDates: Set<string>;
  coordinators: ActiveCoordinator[];
  flagOn: boolean;
}

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export async function loadDeskContext(db: Db): Promise<DeskContext> {
  const desk = await getOrCreateDesk(db);
  const [hours, closures, coordinators, flagOn] = await Promise.all([
    db.serviceDeskHours.findMany({ where: { deskId: desk.id }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] }),
    db.serviceDeskClosure.findMany({ where: { deskId: desk.id }, select: { date: true } }),
    loadActiveCoordinators(db),
    isBookingFlagOn(db),
  ]);
  return {
    desk,
    hours: hours.map((h) => ({ id: h.id, dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute })),
    closureDates: new Set(closures.map((c) => dateKey(c.date))),
    coordinators,
    flagOn,
  };
}

/** Rezerve edilebilir mi: bayrak açık, en az bir aktif koordinatör ve en az bir çalışma saati var. */
export function isBookable(ctx: DeskContext): boolean {
  return ctx.flagOn && ctx.coordinators.length > 0 && ctx.hours.length > 0;
}

export function assertBookable(ctx: DeskContext): void {
  if (!isBookable(ctx)) throw new ServiceNotBookableError();
}

/**
 * Koordinatör meşguliyeti: kendi SCHEDULED/PENDING_PAYMENT görüşmeleri + ev sahibi olduğu SCHEDULED ExternalMeeting'ler
 * (AG genel toplantıları dahil). `excludeConsultationId`: saat değişikliğinde kendi kaydı meşgul sayılmaz.
 */
export async function loadCoordinatorBusy(
  db: Db,
  coordinators: ReadonlyArray<Pick<ActiveCoordinator, "id" | "userId">>,
  from: Date,
  to: Date,
  excludeConsultationId?: string
): Promise<Map<string, BusyInterval[]>> {
  const busy = new Map<string, BusyInterval[]>();
  if (coordinators.length === 0) return busy;
  const push = (id: string, start: Date, end: Date) => {
    const list = busy.get(id);
    if (list) list.push({ start, end });
    else busy.set(id, [{ start, end }]);
  };
  const consultations = await db.serviceConsultation.findMany({
    where: {
      coordinatorId: { in: coordinators.map((c) => c.id) },
      status: { in: ["SCHEDULED", "PENDING_PAYMENT"] },
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(excludeConsultationId ? { id: { not: excludeConsultationId } } : {}),
    },
    select: { coordinatorId: true, startsAt: true, endsAt: true },
  });
  for (const c of consultations) push(c.coordinatorId, c.startsAt, c.endsAt);
  const ownMeetingIds: string[] = [];
  if (excludeConsultationId) {
    const own = await db.serviceConsultation.findUnique({ where: { id: excludeConsultationId }, select: { meetingId: true } });
    if (own) ownMeetingIds.push(own.meetingId);
  }
  const byUser = new Map(coordinators.map((c) => [c.userId, c.id]));
  const meetings = await db.externalMeeting.findMany({
    where: {
      hostUserId: { in: [...byUser.keys()] },
      status: "SCHEDULED",
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(ownMeetingIds.length > 0 ? { id: { notIn: ownMeetingIds } } : {}),
    },
    select: { hostUserId: true, startsAt: true, endsAt: true },
  });
  for (const m of meetings) push(byUser.get(m.hostUserId)!, m.startsAt, m.endsAt);
  return busy;
}

export function slotInputFromContext(ctx: DeskContext, busy: Map<string, BusyInterval[]>, now: Date): Omit<DeskSlotInput, "from" | "to"> {
  return {
    timeZone: ctx.desk.timeZone,
    durationMin: ctx.desk.durationMin,
    minNoticeMin: ctx.desk.minNoticeMin,
    horizonDays: ctx.desk.horizonDays,
    hours: ctx.hours,
    closureDates: ctx.closureDates,
    coordinatorIds: ctx.coordinators.map((c) => c.id),
    busy,
    now,
  };
}

/** `[from, to]` masa-günü aralığı için (geniş) UTC sınırları: gün başı/sonu payıyla. */
export function paddedRange(from: string, to: string): { start: Date; end: Date } {
  return { start: new Date(Date.parse(`${from}T00:00:00Z`) - 36 * 3_600_000), end: new Date(Date.parse(`${to}T00:00:00Z`) + 60 * 3_600_000) };
}

export async function computeSlotsForRange(db: Db, ctx: DeskContext, from: string, to: string, now: Date) {
  const range = paddedRange(from, to);
  const busy = await loadCoordinatorBusy(db, ctx.coordinators, range.start, range.end);
  return computeDeskSlots({ ...slotInputFromContext(ctx, busy, now), from, to });
}

/** `startsAt` için boş koordinatörler (aday listesi); `null` = geçerli slot değil. */
export async function freeCoordinatorsAt(
  db: Db,
  ctx: DeskContext,
  startsAt: Date,
  now: Date,
  excludeConsultationId?: string
): Promise<ActiveCoordinator[] | null> {
  const busy = await loadCoordinatorBusy(db, ctx.coordinators, new Date(startsAt.getTime() - 3_600_000), new Date(startsAt.getTime() + 3 * 3_600_000), excludeConsultationId);
  const free = freeCoordinatorsForStart(slotInputFromContext(ctx, busy, now), startsAt);
  if (free === null) return null;
  const set = new Set(free);
  return ctx.coordinators.filter((c) => set.has(c.id));
}

// --- Otomatik atama -------------------------------------------------------------------------------

export interface AssignmentInput {
  candidates: ActiveCoordinator[];
  /** İletişim dili ve (varsa) tercüman dili: site kodları veya ISO. */
  languages: string[];
  /** Adayın o gün (masa diliminde) SCHEDULED görüşme sayısı. */
  loadByCoordinator: ReadonlyMap<string, number>;
  /** Önce bu koordinatör (saat değişikliğinde süreklilik); aday değilse yok sayılır. */
  preferredId?: string | null;
  random?: (n: number) => number;
}

const normLang = (l: string) => l.trim().toLowerCase();

/**
 * Kural sırası: (a) dil uyumu, (b) o gün en az görüşme, (c) en eski lastAssignedAt (hiç atanmamış en eski),
 * (d) rastgele. `preferredId` aday ise doğrudan o seçilir (saat değişikliğinde aynı koordinatör).
 */
export function pickCoordinator(input: AssignmentInput): ActiveCoordinator {
  const { candidates } = input;
  if (candidates.length === 0) throw new ConflictError("Aday koordinatör yok.");
  if (input.preferredId) {
    const preferred = candidates.find((c) => c.id === input.preferredId);
    if (preferred) return preferred;
  }
  const wanted = new Set(input.languages.map(normLang).filter(Boolean));
  let pool = candidates;
  if (wanted.size > 0) {
    const matching = pool.filter((c) => c.languages.some((l) => wanted.has(normLang(l))));
    if (matching.length > 0) pool = matching;
  }
  const minLoad = Math.min(...pool.map((c) => input.loadByCoordinator.get(c.id) ?? 0));
  pool = pool.filter((c) => (input.loadByCoordinator.get(c.id) ?? 0) === minLoad);
  const stamp = (c: ActiveCoordinator) => (c.lastAssignedAt ? c.lastAssignedAt.getTime() : -Infinity);
  const oldest = Math.min(...pool.map(stamp));
  pool = pool.filter((c) => stamp(c) === oldest);
  const rnd = input.random ?? ((n: number) => Math.floor(Math.random() * n));
  return pool[rnd(pool.length)]!;
}

/** Her koordinatör için `[dayStart, dayEnd)` aralığındaki SCHEDULED görüşme sayısı. */
export async function loadDailyLoad(db: Db, coordinatorIds: readonly string[], dayStart: Date, dayEnd: Date): Promise<Map<string, number>> {
  const rows = await db.serviceConsultation.groupBy({
    by: ["coordinatorId"],
    where: { coordinatorId: { in: [...coordinatorIds] }, status: "SCHEDULED", startsAt: { gte: dayStart, lt: dayEnd } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.coordinatorId, r._count._all]));
}
