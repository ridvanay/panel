import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AppointmentSchema, AvailabilitySlotSchema, CreateAppointmentResultSchema, DoctorProfileSchema } from "../../schemas/entities";
import { toAppointmentDto, toDoctorProfileDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { hashToken } from "../../lib/tokens";
import { timingSafeEqualHex } from "../../lib/api-key";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { generateAvailableSlots, parseIsoCalendarDate } from "./lib/availability";
import { bookAppointment } from "./lib/booking";
import {
  AccessTokenQuerySchema,
  AppointmentIdParamSchema,
  CancelAppointmentRequestSchema,
  CreateAppointmentRequestSchema,
  DoctorSlotsQuerySchema,
  DoctorSlugParamSchema,
  ListPublicDoctorsQuerySchema,
} from "./telehealth.schemas";

/** Doktor liste/detay sorgularında uzmanlık + avatarını de dönmek için ortak `include`. */
const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
const WITH_APPOINTMENT_RELATIONS = { doctor: { select: { id: true, title: true, fullName: true, slug: true } } } as const;

/**
 * §8 madde 4 (bağlayıcı) — bir randevuya kimin erişebileceği: (a) oturum sahibi hastası,
 * (b) doğru `accessToken`'ı sunan misafir hasta, (c) doktorun bağlı `User`'ı, (d) `SiteRole.ADMIN`
 * (destek/gözlem). `MANAGER` da ADMIN ile AYNI panel operasyon eşiğine dahil edilir (bu modülün
 * appointments okuma RBAC'i zaten ADMIN+MANAGER, bkz. telehealth.admin.routes.ts) — tutarlılık
 * için tekil randevu görüntüleme/iptalinde de aynı eşik kullanılır. IDOR'u önlemek için erişim
 * reddinde `404` (varlığı SIZDIRILMAZ), `403` DEĞİL.
 * §8 madde 2 (bağlayıcı) — hash karşılaştırması `timingSafeEqualHex` ile SABİT ZAMANLI yapılır
 * (düz `===` YASAK, bkz. lib/api-key.ts::timingSafeEqualHex yorumu — `api-key-auth.ts` İLE AYNI
 * disiplin, bu depoda tek başka hash-karşılaştırma noktası).
 */
async function assertAppointmentAccess(
  app: FastifyInstance,
  appointment: { patientUserId: string | null; accessTokenHash: string; doctor: { userId?: string | null } },
  request: { user?: { id: string; role: string } | undefined; providedToken?: string }
): Promise<void> {
  if (request.user) {
    if (request.user.role === "ADMIN" || request.user.role === "MANAGER") return;
    if (appointment.patientUserId && appointment.patientUserId === request.user.id) return;
    if (appointment.doctor.userId && appointment.doctor.userId === request.user.id) return;
  }
  if (request.providedToken && timingSafeEqualHex(hashToken(request.providedToken), appointment.accessTokenHash)) return;
  throw new NotFoundError("Randevu bulunamadı.");
}

/** `/doctors` ve `/appointments` prefix'leri altında bağlanır (bkz. app.ts) — PUBLIC. */
export async function telehealthRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  // §7.2 (checkout.routes.ts::authenticateOptional ile AYNI desen) — oturum açmış bir kullanıcı
  // randevu alırsa `Appointment.patientUserId` dolar; misafir akışı (401 ÜRETİLMEZ) DEĞİŞMEZ.
  server.addHook("preHandler", authenticateOptional);

  server.get(
    "/doctors",
    {
      schema: {
        querystring: ListPublicDoctorsQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(DoctorProfileSchema)) },
      },
    },
    async (request, reply) => {
      const { specialtySlug, language, search, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const specialty = specialtySlug ? await app.prisma.specialty.findUnique({ where: { slug: specialtySlug } }) : null;
      if (specialtySlug && !specialty) {
        return reply.send(ok([], buildPageMeta([], limit)));
      }

      const rows = await app.prisma.doctorProfile.findMany({
        where: {
          isActive: true,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(specialty ? { specialtyId: specialty.id } : {}),
          ...(language ? { languages: { has: language } } : {}),
          ...(search
            ? {
                OR: [
                  { fullName: { contains: search, mode: "insensitive" } },
                  { bio: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_DOCTOR_RELATIONS,
      });

      return reply.send(ok(rows.map(toDoctorProfileDto), buildPageMeta(rows, limit)));
    }
  );

  server.get(
    "/doctors/:slug",
    { schema: { params: DoctorSlugParamSchema, response: { 200: ApiSuccessSchema(DoctorProfileSchema) } } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findFirst({
        where: { slug: request.params.slug, isActive: true },
        include: WITH_DOCTOR_RELATIONS,
      });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");
      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  server.get(
    "/doctors/:slug/slots",
    {
      schema: {
        params: DoctorSlugParamSchema,
        querystring: DoctorSlotsQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(AvailabilitySlotSchema)) },
      },
    },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findFirst({
        where: { slug: request.params.slug, isActive: true },
        include: { availability: true },
      });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const fromDate = parseIsoCalendarDate(request.query.from);
      const toDate = parseIsoCalendarDate(request.query.to);

      // DB sorgusu için CÖMERT bir UTC dolgu penceresi (§4.2 — tam sınır hesaplaması zaten
      // `generateAvailableSlots` içinde doktorun kendi diliminde yapılır; burada amaç yalnızca
      // ilgili randevuları getirmektir, fazladan satır zararsızdır).
      const rangeStartMs = Date.UTC(fromDate.year, fromDate.month - 1, fromDate.day) - 24 * 60 * 60 * 1000;
      const rangeEndMs = Date.UTC(toDate.year, toDate.month - 1, toDate.day) + 2 * 24 * 60 * 60 * 1000;

      const bookedAppointments = await app.prisma.appointment.findMany({
        where: { doctorId: doctor.id, startsAt: { gte: new Date(rangeStartMs), lte: new Date(rangeEndMs) } },
        select: { startsAt: true },
      });

      const slots = generateAvailableSlots({
        timeZone: doctor.timeZone,
        sessionDurationMin: doctor.sessionDurationMin,
        rules: doctor.availability,
        fromDate,
        toDate,
        now: new Date(),
        bookedStartTimesMs: new Set(bookedAppointments.map((row) => row.startsAt.getTime())),
      });

      return reply.send(
        ok(slots.map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), available: slot.available })))
      );
    }
  );

  // §4.3 (bağlayıcı) — kimlik doğrulama GEREKTİRMEZ, hız sınırı 5 istek/dk (para hareketi
  // içermese de kimlik doğrulamasız bir YAZMA ucudur — checkout.routes.ts::CHECKOUT_RATE_LIMIT
  // İLE AYNI route-level override deseni, global limitten BAĞIMSIZ).
  server.post(
    "/appointments",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: CreateAppointmentRequestSchema, response: { 201: ApiSuccessSchema(CreateAppointmentResultSchema) } },
    },
    async (request, reply) => {
      const { doctorSlug, startsAt, patientName, patientEmail } = request.body;

      const { appointment, rawAccessToken } = await bookAppointment(app, {
        doctorSlug,
        startsAt: new Date(startsAt),
        patientName,
        patientEmail,
        patientUserId: request.user?.id ?? null,
      });

      return reply.code(201).send(
        ok({
          id: appointment.id,
          doctorSlug,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          status: appointment.status,
          priceCents: appointment.priceCents,
          currency: appointment.currency,
          accessToken: rawAccessToken,
        })
      );
    }
  );

  server.get(
    "/appointments/:id",
    {
      schema: {
        params: AppointmentIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(AppointmentSchema) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: { ...WITH_APPOINTMENT_RELATIONS, doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } } },
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      await assertAppointmentAccess(app, appointment, { user: request.user, providedToken: request.query.t });

      return reply.send(ok(toAppointmentDto(appointment)));
    }
  );

  server.post(
    "/appointments/:id/cancel",
    {
      schema: {
        params: AppointmentIdParamSchema,
        querystring: AccessTokenQuerySchema,
        body: CancelAppointmentRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentSchema) },
      },
    },
    async (request, reply) => {
      const appointment = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: { doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } } },
      });
      if (!appointment) throw new NotFoundError("Randevu bulunamadı.");

      await assertAppointmentAccess(app, appointment, { user: request.user, providedToken: request.query.t });

      if (appointment.status !== "SCHEDULED") {
        throw new ConflictError("Yalnızca planlanmış (SCHEDULED) randevular iptal edilebilir.");
      }

      const updated = await app.prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: request.body.reason ?? null },
        include: WITH_APPOINTMENT_RELATIONS,
      });

      return reply.send(ok(toAppointmentDto(updated)));
    }
  );
}
