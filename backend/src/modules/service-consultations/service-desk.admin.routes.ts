import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/authenticate";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { logAudit } from "../../lib/audit";
import { TimeZoneSchema } from "../../lib/dual-time";
import {
  ClosureHasConsultationsError,
  ConsultationNotChangeableError,
  ConflictError,
  CoordinatorHasUpcomingConsultationsError,
  CoordinatorNotEligibleError,
  ForbiddenError,
  NotFoundError,
  PaidConsultationsDisabledError,
  ValidationError,
} from "../../lib/errors";
import { trackAdminBackgroundTask } from "../telehealth/lib/admin-booking-notifications";
import { findWeeklyOverlaps, normalizeWeeklyRules } from "../telehealth/lib/weekly-availability";
import { addCalendarDays, getStartOfCalendarDayInTimeZone } from "../telehealth/lib/timezone";
import { parseIsoCalendarDate } from "../telehealth/lib/availability";
import { MEETING_JOIN_LEAD_MS } from "../telehealth/lib/meeting-livekit";
import { COORDINATOR_ROLES, computeSlotsForRange, getOrCreateDesk, loadActiveCoordinators } from "./service-desk";
import { dateKeyInZone } from "./service-slots";
import { cancelServiceConsultation, loadManagedById } from "./service-booking";
import { notifyStaffOfServiceEvent, sendPatientServiceEmail } from "./service-consultation-notify";
import { formatConsultationNumber, generateManageToken } from "./service-consultation-tokens";
import { generateGuestToken } from "../meetings/meeting-tokens";

const SETTINGS_ID = "singleton";
const WRITE_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };
const READ_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };
const TITLE_PREFIX = /^\s*(dr|prof|op|uzm|doç|doc|assoc|asst|mr|mrs|ms)\b\.?/i;

const StatusSchema = z.enum(["PENDING_PAYMENT", "SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]);
const IdParamSchema = z.object({ id: z.string().uuid() });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD biçiminde olmalı.");

const DeskSchema = z.object({
  id: z.string(),
  name: z.string(),
  timeZone: z.string(),
  durationMin: z.number(),
  minNoticeMin: z.number(),
  horizonDays: z.number(),
  maxParticipants: z.number(),
  paidEnabled: z.boolean(),
});
const HourSchema = z.object({ id: z.string().optional(), dayOfWeek: z.number(), startMinute: z.number(), endMinute: z.number() });
const ClosureSchema = z.object({ id: z.string(), date: z.string(), note: z.string().nullable(), createdAt: z.string() });
const DeskOverviewSchema = z.object({
  desk: DeskSchema,
  serviceBookingEnabled: z.boolean(),
  hours: z.array(HourSchema),
  closures: z.array(ClosureSchema),
  stats: z.object({ activeCoordinators: z.number(), next7DaysSlots: z.number() }),
});

const PatchDeskBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  durationMin: z.number().int().min(15).max(60).refine((n) => n % 5 === 0, "Süre 5 dakikanın katı olmalı.").optional(),
  minNoticeMin: z.number().int().min(0).max(2880).optional(),
  horizonDays: z.number().int().min(1).max(90).optional(),
  maxParticipants: z.number().int().min(2).max(4).optional(),
  timeZone: TimeZoneSchema.optional(),
  paidEnabled: z.boolean().optional(),
  serviceBookingEnabled: z.boolean().optional(),
});

const HourInput = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});
const PutHoursBody = z.union([z.array(HourInput).max(100), z.object({ hours: z.array(HourInput).max(100) })]);

const ClosureBody = z.object({ date: dateOnly, note: z.string().trim().max(200).nullable().optional() });

const CoordinatorSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  displayName: z.string(),
  languages: z.array(z.string()),
  isActive: z.boolean(),
  twoFactorEnabled: z.boolean(),
  upcomingConsultations: z.number(),
  lastAssignedAt: z.string().nullable(),
});
const CandidateSchema = z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string() });

const LanguagesSchema = z.array(z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z]{2,8})?$/, "Geçersiz dil kodu.")).max(12);
const DisplayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .refine((v) => !TITLE_PREFIX.test(v), "Görünen ad unvan içeremez (Dr., Prof. vb.).");
const CreateCoordinatorBody = z.object({ userId: z.string().uuid(), displayName: DisplayNameSchema.optional(), languages: LanguagesSchema.default([]) });
const PatchCoordinatorBody = z.object({ displayName: DisplayNameSchema.optional(), languages: LanguagesSchema.optional(), isActive: z.boolean().optional() });

const ListConsultationsQuery = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  status: StatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const AdminConsultationSchema = z.object({
  id: z.string(),
  consultationNumber: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: StatusSchema,
  serviceName: z.string(),
  patientInitials: z.string(),
  coordinator: z.object({ id: z.string(), displayName: z.string() }),
  contactLanguage: z.string().nullable(),
  country: z.string().nullable(),
  needsInterpreter: z.boolean(),
  interpreterLanguage: z.string().nullable(),
  rescheduledCount: z.number(),
});
const AdminConsultationDetailSchema = AdminConsultationSchema.extend({
  patientName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  preferredContactChannel: z.string().nullable(),
  hasMessage: z.boolean(),
  leadId: z.string().nullable(),
  patientTimeZone: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  room: z.object({ hostJoinedAt: z.string().nullable(), guestsAdmitted: z.number(), joinOpensAt: z.string() }),
  createdAt: z.string(),
});
const CancelBody = z.object({ reason: z.string().trim().max(200).optional() });

/** "Ayşe Kaya" -> "Ayşe K."; unvan ve tek sözcük korunur (unvan yok). */
export function defaultDisplayName(fullName: string): string {
  const words = fullName
    .replace(TITLE_PREFIX, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "Coordinator";
  if (words.length === 1) return words[0]!.slice(0, 40);
  const last = words[words.length - 1]!;
  return `${words.slice(0, -1).join(" ")} ${[...last][0]!.toLocaleUpperCase()}.`.slice(0, 40);
}

function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.map((w) => `${[...w][0]!.toLocaleUpperCase()}.`).join(" ");
}

const LIST_SELECT = {
  id: true,
  seq: true,
  startsAt: true,
  endsAt: true,
  status: true,
  serviceName: true,
  needsInterpreter: true,
  interpreterLanguage: true,
  rescheduledCount: true,
  coordinator: { select: { id: true, displayName: true } },
  request: { select: { fullName: true, country: true, contactLanguage: true } },
} satisfies Prisma.ServiceConsultationSelect;

function toListDto(r: Prisma.ServiceConsultationGetPayload<{ select: typeof LIST_SELECT }>) {
  return {
    id: r.id,
    consultationNumber: formatConsultationNumber(r.seq),
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    status: r.status,
    serviceName: r.serviceName,
    // Liste: hasta adi YALNIZCA bas harfli.
    patientInitials: initials(r.request?.fullName),
    coordinator: r.coordinator,
    contactLanguage: r.request?.contactLanguage ?? null,
    country: r.request?.country ?? null,
    needsInterpreter: r.needsInterpreter,
    interpreterLanguage: r.interpreterLanguage,
    rescheduledCount: r.rescheduledCount,
  };
}

/**
 * `/admin/service-desk` prefix'i altinda baglanir. Paket AI (Is 3) - tek genel masa yonetimi: ADMIN + MANAGER
 * (genel rezervasyon anahtari yalnizca ADMIN). Tum yazmalar audit'e (kisisel veri yok).
 */
export async function serviceDeskAdminRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  async function overview() {
    const desk = await getOrCreateDesk(app.prisma);
    const now = new Date();
    const todayKey = dateKeyInZone(now, desk.timeZone);
    const today = parseIsoCalendarDate(todayKey);
    const [hours, closures, settings, coordinators] = await Promise.all([
      app.prisma.serviceDeskHours.findMany({ where: { deskId: desk.id }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] }),
      app.prisma.serviceDeskClosure.findMany({ where: { deskId: desk.id, date: { gte: new Date(`${todayKey}T00:00:00Z`) } }, orderBy: { date: "asc" } }),
      app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { serviceBookingEnabled: true } }),
      loadActiveCoordinators(app.prisma),
    ]);
    const closureDates = new Set(closures.map((c) => c.date.toISOString().slice(0, 10)));
    let next7DaysSlots = 0;
    if (hours.length > 0 && coordinators.length > 0) {
      const end = addCalendarDays(today, 6);
      const key = (d: { year: number; month: number; day: number }) => `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
      const result = await computeSlotsForRange(
        app.prisma,
        { desk, hours: hours.map((h) => ({ id: h.id, dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute })), closureDates, coordinators, flagOn: true, infraReady: true },
        todayKey,
        key(end),
        now
      );
      next7DaysSlots = result.slots.length;
    }
    return {
      desk: { id: desk.id, name: desk.name, timeZone: desk.timeZone, durationMin: desk.durationMin, minNoticeMin: desk.minNoticeMin, horizonDays: desk.horizonDays, maxParticipants: desk.maxParticipants, paidEnabled: desk.paidEnabled },
      serviceBookingEnabled: Boolean(settings?.serviceBookingEnabled),
      hours: hours.map((h) => ({ id: h.id, dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute })),
      closures: closures.map((c) => ({ id: c.id, date: c.date.toISOString().slice(0, 10), note: c.note, createdAt: c.createdAt.toISOString() })),
      stats: { activeCoordinators: coordinators.length, next7DaysSlots },
    };
  }

  server.get("/", { config: { rateLimit: READ_RATE_LIMIT }, schema: { response: { 200: ApiSuccessSchema(DeskOverviewSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await overview()));
  });

  server.patch(
    "/",
    { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { body: PatchDeskBody, response: { 200: ApiSuccessSchema(DeskOverviewSchema) } } },
    async (request, reply) => {
      const { serviceBookingEnabled, paidEnabled, ...deskFields } = request.body;
      if (paidEnabled === true) throw new PaidConsultationsDisabledError();
      // Genel rezervasyon anahtari yalnizca ADMIN.
      if (serviceBookingEnabled !== undefined && request.user!.role !== "ADMIN") {
        await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "PATCH /admin/service-desk (serviceBookingEnabled)", status: "FORBIDDEN", ipAddress: request.ip });
        throw new ForbiddenError("Rezervasyon anahtarını yalnızca yönetici değiştirebilir.");
      }
      const desk = await getOrCreateDesk(app.prisma);
      const data: Prisma.ServiceDeskUpdateInput = {};
      for (const [k, v] of Object.entries(deskFields)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      if (Object.keys(data).length > 0) await app.prisma.serviceDesk.update({ where: { id: desk.id }, data });
      if (serviceBookingEnabled !== undefined) {
        await app.prisma.siteSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, serviceBookingEnabled }, update: { serviceBookingEnabled } });
      }
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "service_desk.updated",
        targetType: "ServiceDesk",
        targetId: desk.id,
        metadata: { fields: [...Object.keys(deskFields).filter((k) => (deskFields as Record<string, unknown>)[k] !== undefined), ...(serviceBookingEnabled !== undefined ? ["serviceBookingEnabled"] : [])], ...(serviceBookingEnabled !== undefined ? { serviceBookingEnabled } : {}) },
        ipAddress: request.ip,
      });
      return reply.send(ok(await overview()));
    }
  );

  server.put(
    "/hours",
    { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { body: PutHoursBody, response: { 200: ApiSuccessSchema(z.object({ hours: z.array(HourSchema) })) } } },
    async (request, reply) => {
      const input = Array.isArray(request.body) ? request.body : request.body.hours;
      for (const h of input) {
        if (h.endMinute <= h.startMinute) throw new ValidationError("Bitiş saati başlangıçtan sonra olmalı.", { hours: ["Bitiş saati başlangıçtan sonra olmalı."] });
      }
      const rules = normalizeWeeklyRules(input);
      if (findWeeklyOverlaps(rules).length > 0) throw new ValidationError("Aynı gün içinde çakışan aralıklar var.", { hours: ["Aynı gün içinde çakışan aralıklar var."] });
      const desk = await getOrCreateDesk(app.prisma);
      const rows = await app.prisma.$transaction(async (tx) => {
        await tx.serviceDeskHours.deleteMany({ where: { deskId: desk.id } });
        if (rules.length > 0) await tx.serviceDeskHours.createMany({ data: rules.map((r) => ({ deskId: desk.id, dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute })) });
        return tx.serviceDeskHours.findMany({ where: { deskId: desk.id }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] });
      });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "service_desk.hours_updated", targetType: "ServiceDesk", targetId: desk.id, metadata: { ranges: rows.length }, ipAddress: request.ip });
      return reply.send(ok({ hours: rows.map((h) => ({ id: h.id, dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute })) }));
    }
  );

  // --- Tatil gunleri ---------------------------------------------------------------------------------------

  server.post(
    "/closures",
    { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { body: ClosureBody, response: { 201: ApiSuccessSchema(ClosureSchema) } } },
    async (request, reply) => {
      const { date, note } = request.body;
      if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
        throw new ValidationError("Geçerli bir tarih girin.", { date: ["Geçerli bir tarih girin."] });
      }
      const desk = await getOrCreateDesk(app.prisma);
      const day = parseIsoCalendarDate(date);
      const count = await app.prisma.serviceConsultation.count({
        where: {
          status: "SCHEDULED",
          startsAt: { gte: getStartOfCalendarDayInTimeZone(day, desk.timeZone), lt: getStartOfCalendarDayInTimeZone(addCalendarDays(day, 1), desk.timeZone) },
        },
      });
      if (count > 0) throw new ClosureHasConsultationsError(count);
      try {
        const row = await app.prisma.serviceDeskClosure.create({ data: { deskId: desk.id, date: new Date(`${date}T00:00:00Z`), note: note ?? null, createdById: request.user!.id } });
        await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "service_desk.closure_added", targetType: "ServiceDeskClosure", targetId: row.id, metadata: { date }, ipAddress: request.ip });
        return reply.status(201).send(ok({ id: row.id, date, note: row.note, createdAt: row.createdAt.toISOString() }));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictError("Bu gün zaten kapalı olarak işaretli.");
        throw err;
      }
    }
  );

  server.delete("/closures/:id", { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { params: IdParamSchema } }, async (request, reply) => {
    const row = await app.prisma.serviceDeskClosure.findUnique({ where: { id: request.params.id } });
    if (!row) throw new NotFoundError("Tatil günü bulunamadı.");
    await app.prisma.serviceDeskClosure.delete({ where: { id: row.id } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "service_desk.closure_removed", targetType: "ServiceDeskClosure", targetId: row.id, metadata: { date: row.date.toISOString().slice(0, 10) }, ipAddress: request.ip });
    return reply.code(204).send();
  });

  // --- Koordinatorler --------------------------------------------------------------------------------------

  async function coordinatorDto(id: string) {
    const c = await app.prisma.coordinatorProfile.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true, role: true, twoFactorEnabled: true } } },
    });
    if (!c) throw new NotFoundError("Koordinatör bulunamadı.");
    const upcoming = await app.prisma.serviceConsultation.count({ where: { coordinatorId: id, status: "SCHEDULED", endsAt: { gt: new Date() } } });
    return {
      id: c.id,
      userId: c.userId,
      name: c.user.name,
      email: c.user.email,
      role: c.user.role,
      displayName: c.displayName,
      languages: c.languages,
      isActive: c.isActive,
      twoFactorEnabled: c.user.twoFactorEnabled,
      upcomingConsultations: upcoming,
      lastAssignedAt: c.lastAssignedAt ? c.lastAssignedAt.toISOString() : null,
    };
  }

  server.get("/coordinators", { config: { rateLimit: READ_RATE_LIMIT }, schema: { response: { 200: ApiSuccessSchema(z.array(CoordinatorSchema)) } } }, async (_request, reply) => {
    const rows = await app.prisma.coordinatorProfile.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
    return reply.send(ok(await Promise.all(rows.map((r) => coordinatorDto(r.id)))));
  });

  server.get("/coordinator-candidates", { config: { rateLimit: READ_RATE_LIMIT }, schema: { response: { 200: ApiSuccessSchema(z.array(CandidateSchema)) } } }, async (_request, reply) => {
    const rows = await app.prisma.user.findMany({
      where: { status: "ACTIVE", role: { in: ["EDITOR", "MANAGER"] }, doctorProfile: null, coordinatorProfile: null },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    return reply.send(ok(rows));
  });

  server.post(
    "/coordinators",
    { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { body: CreateCoordinatorBody, response: { 201: ApiSuccessSchema(CoordinatorSchema) } } },
    async (request, reply) => {
      const user = await app.prisma.user.findUnique({
        where: { id: request.body.userId },
        select: { id: true, name: true, role: true, status: true, doctorProfile: { select: { id: true } }, coordinatorProfile: { select: { id: true } } },
      });
      if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
      if (user.coordinatorProfile) throw new ConflictError("Bu kullanıcı zaten koordinatör.");
      if (user.status !== "ACTIVE" || user.doctorProfile || !(COORDINATOR_ROLES as readonly string[]).includes(user.role)) {
        throw new CoordinatorNotEligibleError(
          user.doctorProfile ? "Doktor profili olan kullanıcı koordinatör olamaz." : "Koordinatör, aktif bir EDITOR veya MANAGER kullanıcı olmalıdır."
        );
      }
      const created = await app.prisma.coordinatorProfile.create({
        data: { userId: user.id, displayName: request.body.displayName ?? defaultDisplayName(user.name), languages: request.body.languages },
      });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "service_desk.coordinator_added", targetType: "CoordinatorProfile", targetId: created.id, metadata: { userId: user.id }, ipAddress: request.ip });
      return reply.status(201).send(ok(await coordinatorDto(created.id)));
    }
  );

  server.patch(
    "/coordinators/:id",
    { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { params: IdParamSchema, body: PatchCoordinatorBody, response: { 200: ApiSuccessSchema(CoordinatorSchema) } } },
    async (request, reply) => {
      const existing = await app.prisma.coordinatorProfile.findUnique({ where: { id: request.params.id } });
      if (!existing) throw new NotFoundError("Koordinatör bulunamadı.");
      const body = request.body;
      if (body.isActive === true && !existing.isActive) {
        // Yeniden etkinlestirme uygunlugu yeniden dogrular (rol/durum/doktor profili degismis olabilir).
        const u = await app.prisma.user.findUnique({ where: { id: existing.userId }, select: { role: true, status: true, doctorProfile: { select: { id: true } } } });
        if (!u || u.status !== "ACTIVE" || u.doctorProfile || !(COORDINATOR_ROLES as readonly string[]).includes(u.role)) {
          throw new CoordinatorNotEligibleError("Koordinatör, aktif bir EDITOR veya MANAGER kullanıcı olmalı ve doktor profili olmamalıdır.");
        }
      }
      if (body.isActive === false && existing.isActive) {
        const upcoming = await app.prisma.serviceConsultation.count({ where: { coordinatorId: existing.id, status: "SCHEDULED", endsAt: { gt: new Date() } } });
        if (upcoming > 0) throw new CoordinatorHasUpcomingConsultationsError(upcoming);
      }
      await app.prisma.coordinatorProfile.update({
        where: { id: existing.id },
        data: { ...(body.displayName !== undefined ? { displayName: body.displayName } : {}), ...(body.languages !== undefined ? { languages: body.languages } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) },
      });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "service_desk.coordinator_updated",
        targetType: "CoordinatorProfile",
        targetId: existing.id,
        metadata: { fields: Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined) },
        ipAddress: request.ip,
      });
      return reply.send(ok(await coordinatorDto(existing.id)));
    }
  );

  // --- Gorusmeler -------------------------------------------------------------------------------------------

  server.get(
    "/consultations",
    {
      config: { rateLimit: READ_RATE_LIMIT },
      schema: {
        querystring: ListConsultationsQuery,
        response: { 200: ApiSuccessWithMeta(z.array(AdminConsultationSchema), z.object({ page: z.number(), pageSize: z.number(), total: z.number(), hasNext: z.boolean() })) },
      },
    },
    async (request, reply) => {
      const { from, to, status, page, pageSize } = request.query;
      const desk = await getOrCreateDesk(app.prisma);
      const where: Prisma.ServiceConsultationWhereInput = {
        ...(status ? { status } : {}),
        ...((from || to)
          ? {
              startsAt: {
                ...(from ? { gte: getStartOfCalendarDayInTimeZone(parseIsoCalendarDate(from), desk.timeZone) } : {}),
                ...(to ? { lt: getStartOfCalendarDayInTimeZone(addCalendarDays(parseIsoCalendarDate(to), 1), desk.timeZone) } : {}),
              },
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        app.prisma.serviceConsultation.count({ where }),
        app.prisma.serviceConsultation.findMany({ where, select: LIST_SELECT, orderBy: { startsAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return reply.send(ok(rows.map(toListDto), { page, pageSize, total, hasNext: page * pageSize < total }));
    }
  );

  server.get(
    "/consultations/:id",
    { config: { rateLimit: READ_RATE_LIMIT }, schema: { params: IdParamSchema, response: { 200: ApiSuccessSchema(AdminConsultationDetailSchema) } } },
    async (request, reply) => {
      const row = await app.prisma.serviceConsultation.findUnique({
        where: { id: request.params.id },
        select: {
          ...LIST_SELECT,
          patientTimeZone: true,
          cancelledAt: true,
          cancelledBy: true,
          createdAt: true,
          meeting: { select: { hostJoinedAt: true, guests: { where: { admittedAt: { not: null } }, select: { id: true } } } },
          request: { select: { fullName: true, email: true, phone: true, country: true, contactLanguage: true, preferredContactChannel: true, messageEncrypted: true, leadId: true } },
        },
      });
      if (!row) throw new NotFoundError("Görüşme bulunamadı.");
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "service_consultation.admin_viewed", targetType: "ServiceConsultation", targetId: row.id, metadata: null, ipAddress: request.ip });
      reply.header("Cache-Control", "no-store");
      return reply.send(
        ok({
          ...toListDto(row),
          patientName: row.request?.fullName ?? "",
          email: row.request?.email ?? null,
          phone: row.request?.phone ?? null,
          preferredContactChannel: row.request?.preferredContactChannel ?? null,
          hasMessage: Boolean(row.request?.messageEncrypted),
          leadId: row.request?.leadId ?? null,
          patientTimeZone: row.patientTimeZone,
          cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
          cancelledBy: row.cancelledBy,
          room: {
            hostJoinedAt: row.meeting.hostJoinedAt ? row.meeting.hostJoinedAt.toISOString() : null,
            guestsAdmitted: row.meeting.guests.length,
            joinOpensAt: new Date(row.startsAt.getTime() - MEETING_JOIN_LEAD_MS).toISOString(),
          },
          createdAt: row.createdAt.toISOString(),
        })
      );
    }
  );

  /**
   * Hasta e-postasi ulasmadiysa: YENI `sc_` ve YENI `mg_` uretir (eskileri gecersiz), onay e-postasini kayitli adrese yeniden
   * gonderir. Once gonderir, yalniz basariliysa ozetleri degistirir (basarisizsa eski baglantilar gecerli kalir -> sent:false).
   */
  server.post(
    "/consultations/:id/resend-links",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour", keyGenerator: (request: { params?: unknown }) => `svc-resend:${(request.params as { id?: string } | undefined)?.id ?? "x"}` } },
      schema: { params: IdParamSchema, response: { 202: ApiSuccessSchema(z.object({ sent: z.boolean() })) } },
    },
    async (request, reply) => {
      const c = await loadManagedById(app, request.params.id);
      if (!c) throw new NotFoundError("Görüşme bulunamadı.");
      if (c.status !== "SCHEDULED" || c.endsAt.getTime() <= Date.now()) throw new ConsultationNotChangeableError();
      const email = c.request?.email ?? null;
      if (!email) throw new ValidationError("Kayıtlı e-posta adresi yok (kayıt anonimleştirilmiş).", { email: ["Kayıtlı e-posta adresi yok."] });
      const join = generateGuestToken();
      const manage = generateManageToken();
      const sentOk = await sendPatientServiceEmail(app, { consultation: c, email, kind: "confirmed", joinToken: join.token, manageToken: manage.token });
      if (sentOk) {
        await app.prisma.$transaction([
          app.prisma.externalMeeting.update({ where: { id: c.meetingId }, data: { guestTokenHash: join.hash, guestTokenCreatedAt: new Date() } }),
          app.prisma.serviceConsultation.update({ where: { id: c.id }, data: { manageTokenHash: manage.hash } }),
        ]);
      }
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "service_desk.links_resent",
        targetType: "ServiceConsultation",
        targetId: c.id,
        metadata: { sent: sentOk },
        ipAddress: request.ip,
      });
      return reply.code(202).send(ok({ sent: sentOk }));
    }
  );

  server.post(
    "/consultations/:id/cancel",
    { config: { rateLimit: WRITE_RATE_LIMIT }, schema: { params: IdParamSchema, body: CancelBody, response: { 200: ApiSuccessSchema(z.object({ status: z.literal("CANCELLED") })) } } },
    async (request, reply) => {
      const c = await loadManagedById(app, request.params.id);
      if (!c) throw new NotFoundError("Görüşme bulunamadı.");
      const desk = await getOrCreateDesk(app.prisma);
      const result = await cancelServiceConsultation(app, c, { by: "admin", actorId: request.user!.id, actorEmail: request.user!.email, ipAddress: request.ip }, desk.minNoticeMin);
      if (result.changed) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "service_desk.consultation_cancelled",
          targetType: "ServiceConsultation",
          targetId: c.id,
          metadata: request.body.reason ? { reason: request.body.reason } : null,
          ipAddress: request.ip,
        });
        trackAdminBackgroundTask(sendPatientServiceEmail(app, { consultation: c, email: c.request?.email ?? null, kind: "cancelled" }).catch(() => false));
        notifyStaffOfServiceEvent(app, { consultationId: c.id, event: "cancelled" });
      }
      return reply.send(ok({ status: "CANCELLED" as const }));
    }
  );
}
