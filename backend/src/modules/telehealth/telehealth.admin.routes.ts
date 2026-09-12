import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { AppointmentBookingSchema, AppointmentSchema, DoctorAvailabilityRuleSchema, DoctorProfileSchema, SpecialtySchema } from "../../schemas/entities";
import { toAppointmentBookingDto, toAppointmentDto, toDoctorProfileDto, toSpecialtyDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { isImageMimeType } from "../../lib/mime-detect";
import { slugify } from "../../lib/slug";
import { logAudit } from "../../lib/audit";
import { confirmBookingPayment } from "./lib/booking";
import { triggerAppointmentConfirmationEmail } from "./lib/notifications";
import {
  BookingIdParamSchema,
  CreateDoctorRequestSchema,
  CreateSpecialtyRequestSchema,
  DoctorIdParamSchema,
  ListAdminAppointmentsQuerySchema,
  ListAdminBookingsQuerySchema,
  ListAdminDoctorsQuerySchema,
  MarkBookingPaidRequestSchema,
  SetDoctorAvailabilityRequestSchema,
  SpecialtyIdParamSchema,
  UpdateDoctorRequestSchema,
  UpdateSpecialtyRequestSchema,
} from "./telehealth.schemas";

const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
const WITH_APPOINTMENT_RELATIONS = { doctor: { select: { id: true, title: true, fullName: true, slug: true } } } as const;
const WITH_BOOKING_RELATIONS = {
  doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } },
  appointments: true,
  intake: { select: { id: true } },
  documents: { where: { deletedAt: null }, select: { id: true } },
} as const;

async function assertImageMedia(app: FastifyInstance, mediaId: string) {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!isImageMimeType(media.mimeType)) {
    throw new ConflictError("Bu alan yalnızca görsel medya kabul eder.");
  }
}

/** `/admin/telehealth/specialties` prefix'i altında bağlanır — okuma panel kapısı, yazma ADMIN+MANAGER (§8.4). */
export async function adminTelehealthSpecialtiesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // §8.6/DoD (bağlayıcı, security-agent düzeltmesi) — modül kapalıyken TÜM public/admin
  // tele-sağlık uçları 404 döner; `authenticate`'DEN ÖNCE kontrol edilir (auth denemesi bile
  // kapalı bir modülün admin yüzeyinin VARLIĞINI sızdırmasın — public route'larla AYNI sıra).
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    { schema: { response: { 200: ApiSuccessSchema(z.array(SpecialtySchema)) } } },
    async (_request, reply) => {
      const rows = await app.prisma.specialty.findMany({ orderBy: { order: "asc" } });
      return reply.send(ok(rows.map(toSpecialtyDto)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: CreateSpecialtyRequestSchema, response: { 201: ApiSuccessSchema(SpecialtySchema) } },
    },
    async (request, reply) => {
      const { name, slug, icon, description, order, isActive } = request.body;
      const specialty = await app.prisma.specialty.create({
        data: {
          name,
          slug: slug ? slugify(slug) : slugify(name),
          icon,
          description: description ?? null,
          order: order ?? 0,
          isActive: isActive ?? true,
        },
      });
      return reply.code(201).send(ok(toSpecialtyDto(specialty)));
    }
  );

  server.patch(
    "/:specialtyId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: SpecialtyIdParamSchema,
        body: UpdateSpecialtyRequestSchema,
        response: { 200: ApiSuccessSchema(SpecialtySchema) },
      },
    },
    async (request, reply) => {
      const { slug, description, ...rest } = request.body;
      const specialty = await app.prisma.specialty
        .update({
          where: { id: request.params.specialtyId },
          data: {
            ...rest,
            ...(slug !== undefined ? { slug: slugify(slug) } : {}),
            ...(description !== undefined ? { description } : {}),
          },
        })
        .catch(() => {
          throw new NotFoundError("Uzmanlık bulunamadı.");
        });
      return reply.send(ok(toSpecialtyDto(specialty)));
    }
  );

  // Uzmanlık silindiğinde bağlı doktorların `specialtyId`'si `SetNull` ile boşa düşer (bkz.
  // prisma/schema.prisma::DoctorProfile.specialty onDelete) — ürün/kategori ile AYNI risk kabulü,
  // ayrı bir "kullanımda" 409 koruması BİLİNÇLİ olarak eklenmez (v1, backlog ile aynı disiplin).
  server.delete(
    "/:specialtyId",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { params: SpecialtyIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      await app.prisma.specialty.delete({ where: { id: request.params.specialtyId } }).catch(() => {
        throw new NotFoundError("Uzmanlık bulunamadı.");
      });
      return reply.code(204).send();
    }
  );
}

/** `/admin/telehealth/doctors` prefix'i altında bağlanır — okuma panel kapısı, yazma ADMIN+MANAGER (§8.4). */
export async function adminTelehealthDoctorsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // §8.6/DoD (bağlayıcı, security-agent düzeltmesi) — bkz. adminTelehealthSpecialtiesRoutes yorumu.
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    {
      schema: {
        querystring: ListAdminDoctorsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(DoctorProfileSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { specialtyId, search, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.doctorProfile.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(specialtyId ? { specialtyId } : {}),
          ...(search
            ? {
                OR: [
                  { fullName: { contains: search, mode: "insensitive" } },
                  { slug: { contains: search, mode: "insensitive" } },
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

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: CreateDoctorRequestSchema, response: { 201: ApiSuccessSchema(DoctorProfileSchema) } },
    },
    async (request, reply) => {
      const body = request.body;
      if (body.avatarMediaId) await assertImageMedia(app, body.avatarMediaId);

      const doctor = await app.prisma.doctorProfile.create({
        data: {
          title: body.title,
          fullName: body.fullName,
          slug: body.slug ? slugify(body.slug) : slugify(body.fullName),
          bio: body.bio,
          languages: body.languages,
          timeZone: body.timeZone,
          specialtyId: body.specialtyId ?? null,
          sessionDurationMin: body.sessionDurationMin,
          sessionPriceCents: body.sessionPriceCents,
          currency: body.currency ?? "TRY",
          avatarMediaId: body.avatarMediaId ?? null,
          // §7.2 şablon disiplini yalnızca demo-templates içe aktarıcısını bağlar — bu GERÇEK
          // admin CRUD'udur; `isVerified` sunulmazsa güvenli varsayılan (false) korunur.
          isVerified: body.isVerified ?? false,
          isActive: body.isActive ?? true,
          order: body.order ?? 0,
          userId: body.userId ?? null,
        },
        include: WITH_DOCTOR_RELATIONS,
      });
      return reply.code(201).send(ok(toDoctorProfileDto(doctor)));
    }
  );

  server.get(
    "/:doctorId",
    { schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(DoctorProfileSchema) } } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({
        where: { id: request.params.doctorId },
        include: WITH_DOCTOR_RELATIONS,
      });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");
      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  server.patch(
    "/:doctorId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: DoctorIdParamSchema,
        body: UpdateDoctorRequestSchema,
        response: { 200: ApiSuccessSchema(DoctorProfileSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!existing) throw new NotFoundError("Doktor bulunamadı.");

      const { slug, avatarMediaId, ...rest } = request.body;
      if (avatarMediaId) await assertImageMedia(app, avatarMediaId);

      const doctor = await app.prisma.doctorProfile.update({
        where: { id: request.params.doctorId },
        data: {
          ...rest,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(avatarMediaId !== undefined ? { avatarMediaId } : {}),
        },
        include: WITH_DOCTOR_RELATIONS,
      });
      return reply.send(ok(toDoctorProfileDto(doctor)));
    }
  );

  // §3.7/§9 — kalıcı silme. `Appointment.doctor` `onDelete: Restrict` olduğu için doktorun
  // GEÇMİŞ/gelecek randevusu varsa Prisma `P2003` (foreign key) fırlatır → genel error-handler
  // bunu 500'e DÜŞÜRMEZ (bkz. plugins/error-handler.ts — bilinmeyen Prisma hataları ayrı bir
  // dalda YAKALANMADIĞI için burada AÇIKÇA 409'a çevrilir).
  server.delete(
    "/:doctorId",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { params: DoctorIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      await app.prisma.doctorProfile.delete({ where: { id: request.params.doctorId } }).catch((err) => {
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2025") {
          throw new NotFoundError("Doktor bulunamadı.");
        }
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2003") {
          throw new ConflictError("Bu doktorun randevu geçmişi var; önce pasife alın.");
        }
        throw err;
      });
      return reply.code(204).send();
    }
  );

  server.get(
    "/:doctorId/availability",
    { schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(z.array(DoctorAvailabilityRuleSchema)) } } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const rules = await app.prisma.doctorAvailability.findMany({
        where: { doctorId: doctor.id },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      });
      return reply.send(ok(rules.map((rule) => ({ id: rule.id, dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive }))));
    }
  );

  // Haftalık ızgaranın TAMAMINI değiştirir (bkz. telehealth.schemas.ts::SetDoctorAvailabilityRequestSchema
  // yorumu) — eski kurallar SİLİNİR, yenileri tek transaction'da yazılır.
  server.put(
    "/:doctorId/availability",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        params: DoctorIdParamSchema,
        body: SetDoctorAvailabilityRequestSchema,
        response: { 200: ApiSuccessSchema(z.array(DoctorAvailabilityRuleSchema)) },
      },
    },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");

      const rules = await app.prisma.$transaction(async (tx) => {
        await tx.doctorAvailability.deleteMany({ where: { doctorId: doctor.id } });
        if (request.body.rules.length === 0) return [];
        await tx.doctorAvailability.createMany({
          data: request.body.rules.map((rule) => ({
            doctorId: doctor.id,
            dayOfWeek: rule.dayOfWeek,
            startMinute: rule.startMinute,
            endMinute: rule.endMinute,
            isActive: rule.isActive ?? true,
          })),
        });
        return tx.doctorAvailability.findMany({ where: { doctorId: doctor.id }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] });
      });

      return reply.send(
        ok(rules.map((rule) => ({ id: rule.id, dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive })))
      );
    }
  );
}

/**
 * `/admin/telehealth/appointments` prefix'i altında bağlanır — SALT-OKUNUR, hasta PII'si
 * içerdiği için `requirePanelAccess()` (ADMIN|MANAGER|EDITOR) DEĞİL, doğrudan
 * `requireSiteRole(...ROLES_ADMIN_MANAGER)` (§8.4 bağlayıcı — EDITOR DIŞLANIR).
 */
export async function adminTelehealthAppointmentsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // §8.6/DoD (bağlayıcı, security-agent düzeltmesi) — bkz. adminTelehealthSpecialtiesRoutes yorumu.
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/",
    {
      schema: {
        querystring: ListAdminAppointmentsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorId, status, search, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.appointment.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(doctorId ? { doctorId } : {}),
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { patientName: { contains: search, mode: "insensitive" } },
                  { patientEmail: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_APPOINTMENT_RELATIONS,
      });

      return reply.send(ok(rows.map(toAppointmentDto), buildPageMeta(rows, limit)));
    }
  );
}

/**
 * `/admin/telehealth/bookings` prefix'i altında bağlanır — §9.7.10: `GET /` ADMIN+MANAGER
 * (EDITOR dışlanır, `/admin/telehealth/appointments` İLE AYNI eşik — hasta PII'si), `POST
 * .../mark-paid` YALNIZCA ADMIN (§9.7.1 madde 7 — para hareketi beyanı, MANAGER'a VERİLMEZ).
 */
export async function adminTelehealthBookingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        querystring: ListAdminBookingsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentBookingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorId, paymentStatus, search, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.appointmentBooking.findMany({
        where: {
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(doctorId ? { doctorId } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(search
            ? {
                OR: [
                  { patientName: { contains: search, mode: "insensitive" } },
                  { patientEmail: { contains: search, mode: "insensitive" } },
                  { bookingNumber: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_BOOKING_RELATIONS,
      });

      return reply.send(ok(rows.map(toAppointmentBookingDto), buildPageMeta(rows, limit)));
    }
  );

  server.post(
    "/:bookingId/mark-paid",
    {
      // §9.7.1 madde 7 (bağlayıcı) — YALNIZCA ADMIN, `ROLES_ADMIN_MANAGER` DEĞİL.
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        params: BookingIdParamSchema,
        body: MarkBookingPaidRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.appointmentBooking.findUnique({ where: { id: request.params.bookingId } });
      if (!existing) throw new NotFoundError("Rezervasyon bulunamadı.");
      if (existing.paymentStatus !== "PENDING") {
        throw new ConflictError("Bu rezervasyon zaten ödenmiş/iptal edilmiş/süresi dolmuş.");
      }

      const { booking, appointments, rawAccessToken } = await confirmBookingPayment(app, {
        bookingId: existing.id,
        paidBy: "manual",
        paidNote: request.body.reason,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.booking.marked_paid",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: { reason: request.body.reason },
        ipAddress: request.ip,
      });

      // §9.7.8 — mevcut `ORDER_CONFIRMATION` deseniyle AYNI: best-effort, e-posta gönderimi
      // BAŞARISIZ olsa da bu uç ASLA 500 dönmez (bkz. notifications.ts::triggerAppointmentConfirmationEmail).
      await triggerAppointmentConfirmationEmail(app, { booking, appointments, rawAccessToken });

      const withRelations = await app.prisma.appointmentBooking.findUniqueOrThrow({
        where: { id: booking.id },
        include: WITH_BOOKING_RELATIONS,
      });
      return reply.send(ok(toAppointmentBookingDto(withRelations)));
    }
  );
}
