import type { FastifyInstance } from "fastify";
import { Prisma, type ExternalMeeting, type ServiceConsultation } from "@prisma/client";
import { ConsultationNotChangeableError, ConflictError, MeetingLinkInvalidError, ServiceConsultationLimitError, SlotTakenError } from "../../lib/errors";
import { runSerializable } from "../../lib/serializable-tx";
import { logAudit } from "../../lib/audit";
import { hashToken } from "../../lib/tokens";
import { generateMeetingRoomName } from "../telehealth/lib/meeting-livekit";
import { generateGuestToken } from "../meetings/meeting-tokens";
import { afterMeetingCancelled } from "../meetings/meetings.service";
import { createLeadAndConsultationRequest } from "../consultation-requests/consultation-requests.records";
import { getStartOfCalendarDayInTimeZone, addCalendarDays } from "../telehealth/lib/timezone";
import { parseIsoCalendarDate } from "../telehealth/lib/availability";
import {
  SERVICE_CONSULTATION_CONSENT_VERSION,
  SERVICE_CONSULTATION_HOST_TITLE,
  assertBookable,
  freeCoordinatorsAt,
  loadDailyLoad,
  loadDeskContext,
  pickCoordinator,
  type ActiveCoordinator,
} from "./service-desk";
import { dateKeyInZone } from "./service-slots";
import { MANAGE_TOKEN_REGEX, generateManageToken } from "./service-consultation-tokens";

/** Hasta saat degisikligi / iptal icin baslangictan en az bu kadar once (en erken kuraliyla tutarli: `desk.minNoticeMin`). */
export const MAX_RESCHEDULES = 3;
export const MAX_UPCOMING_PER_EMAIL = 2;

export interface BookServiceConsultationInput {
  specialtyId: string | null;
  packageId: string | null;
  serviceName: string;
  fullName: string;
  email: string;
  phone: string | null;
  country: string;
  contactLanguage: string;
  needsInterpreter: boolean;
  interpreterLanguage: string | null;
  preferredContactChannel: string | null;
  /** Temizlenmis mesaj ("" = yok). */
  message: string;
  healthDataConsent: boolean;
  locale: string;
  patientTimeZone: string;
  startsAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface BookedConsultation {
  consultation: ServiceConsultation;
  meeting: ExternalMeeting;
  coordinator: ActiveCoordinator;
  /** Düz belirteçler: YALNIZCA bu isteğin bellegi (e-postaya konur; log/yanit/DB'ye YAZILMAZ). */
  joinToken: string;
  manageToken: string;
}

function isConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034");
}

/** P2002 (kismi tekil indeks) / P2034 (serilestirme) -> bir kez yeniden dener; ikinci cakismada SLOT_TAKEN. */
async function withSlotRetry<T>(app: FastifyInstance, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await runSerializable(app, fn);
    } catch (err) {
      if (!isConflict(err)) throw err;
      if (attempt === 1) throw new SlotTakenError();
    }
  }
  throw new SlotTakenError();
}

async function dayLoad(tx: Prisma.TransactionClient, timeZone: string, coordinatorIds: string[], startsAt: Date) {
  const key = dateKeyInZone(startsAt, timeZone);
  const day = parseIsoCalendarDate(key);
  return loadDailyLoad(tx, coordinatorIds, getStartOfCalendarDayInTimeZone(day, timeZone), getStartOfCalendarDayInTimeZone(addCalendarDays(day, 1), timeZone));
}

export async function bookServiceConsultation(app: FastifyInstance, input: BookServiceConsultationInput): Promise<BookedConsultation> {
  const now = new Date();
  return withSlotRetry(app, async (tx) => {
    const ctx = await loadDeskContext(tx);
    assertBookable(ctx);
    const free = await freeCoordinatorsAt(tx, ctx, input.startsAt, now);
    if (!free || free.length === 0) throw new SlotTakenError();

    const upcoming = await tx.serviceConsultation.count({
      where: { status: "SCHEDULED", endsAt: { gt: now }, request: { email: input.email } },
    });
    if (upcoming >= MAX_UPCOMING_PER_EMAIL) throw new ServiceConsultationLimitError();

    const loads = await dayLoad(tx, ctx.desk.timeZone, free.map((c) => c.id), input.startsAt);
    const coordinator = pickCoordinator({
      candidates: free,
      languages: [input.contactLanguage, ...(input.needsInterpreter && input.interpreterLanguage ? [input.interpreterLanguage] : [])],
      loadByCoordinator: loads,
    });

    const endsAt = new Date(input.startsAt.getTime() + ctx.desk.durationMin * 60_000);
    const record = await createLeadAndConsultationRequest(tx, {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      country: input.country,
      contactLanguage: input.contactLanguage,
      specialtyId: input.specialtyId,
      packageId: input.packageId,
      serviceName: input.serviceName,
      landingPath: "/book-consultation",
      needsInterpreter: input.needsInterpreter,
      preferredContactChannel: input.preferredContactChannel,
      message: input.message,
      healthDataConsent: input.healthDataConsent,
      consentTextVersion: SERVICE_CONSULTATION_CONSENT_VERSION,
      locale: input.locale,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      now,
    });

    const join = generateGuestToken();
    const manage = generateManageToken();
    const meeting = await tx.externalMeeting.create({
      data: {
        hostUserId: coordinator.userId,
        title: SERVICE_CONSULTATION_HOST_TITLE,
        note: null,
        startsAt: input.startsAt,
        endsAt,
        durationMin: ctx.desk.durationMin,
        maxParticipants: ctx.desk.maxParticipants,
        roomName: generateMeetingRoomName(),
        guestTokenHash: join.hash,
        guestTokenCreatedAt: now,
        autoAdmitGuests: false,
      },
    });
    const consultation = await tx.serviceConsultation.create({
      data: {
        deskId: ctx.desk.id,
        coordinatorId: coordinator.id,
        meetingId: meeting.id,
        requestId: record.id,
        specialtyId: input.specialtyId,
        packageId: input.packageId,
        serviceName: input.serviceName,
        startsAt: input.startsAt,
        endsAt,
        patientTimeZone: input.patientTimeZone,
        locale: input.locale,
        needsInterpreter: input.needsInterpreter,
        interpreterLanguage: input.needsInterpreter ? input.interpreterLanguage : null,
        manageTokenHash: manage.hash,
        consentVersion: SERVICE_CONSULTATION_CONSENT_VERSION,
      },
    });
    await tx.coordinatorProfile.update({ where: { id: coordinator.id }, data: { lastAssignedAt: now } });
    return { consultation, meeting, coordinator, joinToken: join.token, manageToken: manage.token };
  });
}

// --- Yonetim baglantisi ---------------------------------------------------------------------------

export type ManagedConsultation = ServiceConsultation & {
  meeting: ExternalMeeting;
  coordinator: { id: string; userId: string; displayName: string };
  request: { email: string | null; contactLanguage: string } | null;
};

const MANAGED_INCLUDE = {
  meeting: true,
  coordinator: { select: { id: true, userId: true, displayName: true } },
  request: { select: { email: true, contactLanguage: true } },
} as const;

/** Gecersiz bicim / bilinmeyen belirtec -> TEK tip 404 (AG ile ayni hata). */
export async function findByManageToken(app: FastifyInstance, token: string): Promise<ManagedConsultation> {
  if (!MANAGE_TOKEN_REGEX.test(token)) throw new MeetingLinkInvalidError();
  const row = await app.prisma.serviceConsultation.findUnique({ where: { manageTokenHash: hashToken(token) }, include: MANAGED_INCLUDE });
  if (!row) throw new MeetingLinkInvalidError();
  return row;
}

export async function loadManagedById(app: FastifyInstance, id: string): Promise<ManagedConsultation | null> {
  return app.prisma.serviceConsultation.findUnique({ where: { id }, include: MANAGED_INCLUDE });
}

/** Hasta tarafi iptal/degisiklik penceresi: SCHEDULED ve baslangica en az `minNoticeMin` var. */
export function isWithinChangeWindow(c: Pick<ServiceConsultation, "status" | "startsAt">, minNoticeMin: number, now: Date): boolean {
  return c.status === "SCHEDULED" && c.startsAt.getTime() - now.getTime() >= minNoticeMin * 60_000;
}

export function lookupFlags(c: Pick<ServiceConsultation, "status" | "startsAt" | "rescheduledCount">, minNoticeMin: number, now: Date) {
  const inWindow = isWithinChangeWindow(c, minNoticeMin, now);
  return { canCancel: inWindow, canReschedule: inWindow && c.rescheduledCount < MAX_RESCHEDULES };
}

export interface CancelActor {
  by: "patient" | "admin";
  actorId: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
}

/**
 * Iptal: durum + ExternalMeeting (belirtec null) TEK islemde; sonra audit + odadakileri atma (AG `afterMeetingCancelled`).
 * Zaten iptal edilmisse idempotent. Baslamis/bitmis/tamamlanmis -> 409 CONSULTATION_NOT_CHANGEABLE.
 */
export async function cancelServiceConsultation(app: FastifyInstance, consultation: ManagedConsultation, actor: CancelActor, minNoticeMin: number): Promise<{ changed: boolean }> {
  const now = new Date();
  if (consultation.status === "CANCELLED") return { changed: false };
  if (consultation.status !== "SCHEDULED") throw new ConsultationNotChangeableError();
  if (actor.by === "patient" ? !isWithinChangeWindow(consultation, minNoticeMin, now) : consultation.endsAt.getTime() <= now.getTime()) {
    throw new ConsultationNotChangeableError();
  }
  const meeting = await app.prisma.$transaction(async (tx) => {
    const claimed = await tx.serviceConsultation.updateMany({
      where: { id: consultation.id, status: "SCHEDULED" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledBy: actor.by },
    });
    if (claimed.count !== 1) throw new ConsultationNotChangeableError();
    return tx.externalMeeting.update({
      where: { id: consultation.meetingId },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.actorId, guestTokenHash: null, guestTokenCreatedAt: null },
    });
  });
  await afterMeetingCancelled(app, meeting, { actorId: actor.actorId, actorEmail: actor.actorEmail, ipAddress: actor.ipAddress, source: "service" });
  await logAudit(app, {
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    action: "service_consultation.cancelled",
    targetType: "ServiceConsultation",
    targetId: consultation.id,
    metadata: { by: actor.by },
    ipAddress: actor.ipAddress,
  });
  return { changed: true };
}

export interface RescheduleResult {
  consultation: ServiceConsultation;
  meeting: ExternalMeeting;
  coordinator: ActiveCoordinator;
  previousCoordinatorId: string;
  previousStartsAt: Date;
  joinToken: string;
}

export async function rescheduleServiceConsultation(
  app: FastifyInstance,
  consultation: ManagedConsultation,
  input: { startsAt: Date; patientTimeZone: string; ipAddress: string | null }
): Promise<RescheduleResult> {
  const now = new Date();
  const previousStartsAt = consultation.startsAt;
  const previousCoordinatorId = consultation.coordinatorId;
  return withSlotRetry(app, async (tx) => {
    const fresh = await tx.serviceConsultation.findUnique({ where: { id: consultation.id } });
    const ctx = await loadDeskContext(tx);
    assertBookable(ctx);
    if (!fresh || !isWithinChangeWindow(fresh, ctx.desk.minNoticeMin, now) || fresh.rescheduledCount >= MAX_RESCHEDULES) throw new ConsultationNotChangeableError();
    if (input.startsAt.getTime() === fresh.startsAt.getTime()) throw new ConflictError("Yeni saat mevcut saatle aynı olamaz.");

    const free = await freeCoordinatorsAt(tx, ctx, input.startsAt, now, fresh.id);
    if (!free || free.length === 0) throw new SlotTakenError();
    const loads = await dayLoad(tx, ctx.desk.timeZone, free.map((c) => c.id), input.startsAt);
    const coordinator = pickCoordinator({
      candidates: free,
      languages: [consultation.request?.contactLanguage ?? "", ...(fresh.needsInterpreter && fresh.interpreterLanguage ? [fresh.interpreterLanguage] : [])],
      loadByCoordinator: loads,
      preferredId: fresh.coordinatorId,
    });
    const endsAt = new Date(input.startsAt.getTime() + ctx.desk.durationMin * 60_000);
    const join = generateGuestToken();
    const meeting = await tx.externalMeeting.update({
      where: { id: fresh.meetingId },
      data: {
        hostUserId: coordinator.userId,
        startsAt: input.startsAt,
        endsAt,
        durationMin: ctx.desk.durationMin,
        guestTokenHash: join.hash,
        guestTokenCreatedAt: now,
        hostJoinedAt: null,
        closedAt: null,
      },
    });
    const updated = await tx.serviceConsultation.update({
      where: { id: fresh.id },
      data: {
        coordinatorId: coordinator.id,
        startsAt: input.startsAt,
        endsAt,
        patientTimeZone: input.patientTimeZone,
        rescheduledCount: { increment: 1 },
        reminded24hAt: null,
        reminded60mAt: null,
      },
    });
    if (coordinator.id !== fresh.coordinatorId) await tx.coordinatorProfile.update({ where: { id: coordinator.id }, data: { lastAssignedAt: now } });
    return { consultation: updated, meeting, coordinator, previousCoordinatorId, previousStartsAt, joinToken: join.token };
  });
}
