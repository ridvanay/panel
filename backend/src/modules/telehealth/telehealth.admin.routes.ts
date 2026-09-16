import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER, ROLES_PANEL } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import {
  AppointmentBookingSchema,
  AppointmentSchema,
  DoctorAvailabilityRuleSchema,
  DoctorProfileSchema,
  SpecialtySchema,
  TelehealthThemeSettingsSchema,
  UpdateTelehealthThemeSettingsRequestSchema,
} from "../../schemas/entities";
import { toAppointmentBookingDto, toAppointmentDto, toDoctorProfileDto, toSpecialtyDto } from "../../mappers";
import { AppointmentRescheduleConflictError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { isImageMimeType } from "../../lib/mime-detect";
import { slugify } from "../../lib/slug";
import { logAudit } from "../../lib/audit";
import { sanitizeRichHtml } from "../../lib/html-sanitize";
import { canAccessBookingHealthData } from "../../lib/telehealth-access";
import { triggerGlobalRevalidation } from "../../lib/revalidate";
import { runSerializable } from "../../lib/serializable-tx";
import { confirmBookingPayment } from "./lib/booking";
import { triggerAppointmentConfirmationEmail, triggerAppointmentRescheduledEmail } from "./lib/notifications";
import { parseTelehealthTheme } from "./lib/theme-settings";
import { wallTimeToUtc } from "./lib/timezone";
import {
  AppointmentIdParamSchema,
  BookingIdParamSchema,
  CreateDoctorRequestSchema,
  CreateSpecialtyRequestSchema,
  DoctorIdParamSchema,
  ListAdminAppointmentsQuerySchema,
  ListAdminBookingsQuerySchema,
  ListAdminDoctorsQuerySchema,
  MarkBookingPaidRequestSchema,
  RescheduleAppointmentRequestSchema,
  SetDoctorAvailabilityRequestSchema,
  SpecialtyIdParamSchema,
  UpdateDoctorRequestSchema,
  UpdateSpecialtyRequestSchema,
} from "./telehealth.schemas";

const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
const WITH_APPOINTMENT_RELATIONS = { doctor: { select: { id: true, title: true, fullName: true, slug: true } } } as const;
const WITH_BOOKING_RELATIONS = {
  doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } },
  // `startsAt asc` — `telehealth.routes.ts::WITH_BOOKING_RELATIONS` İLE AYNI disiplin (ilişki
  // sırası Prisma/Postgres tarafından GARANTİLİ DEĞİLDİR, `appointments[0]`'a dayanan mantık
  // deterministik sıra GEREKTİRİR).
  appointments: { orderBy: { startsAt: "asc" } },
  intake: { select: { id: true } },
  documents: { where: { deletedAt: null }, select: { id: true } },
} as const;

/**
 * [TCT] §9.7.7 KARAR K8 (GÜVENLİK DÜZELTMESİ, bağlayıcı) — bir `DoctorProfile`'ı bir `User.id`'ye
 * bağlamak/çözmek (ayrıcalık yükseltme yüzeyi: bir MANAGER, herhangi bir kullanıcı hesabını
 * -bir ADMIN'inki dahil- doktor portalı üzerinden hasta PII'sine erişim kazandıracak şekilde
 * bağlayabilirdi) YALNIZCA `SiteRole=ADMIN` tarafından yapılabilir. İstek gövdesinde `userId`
 * anahtarı YOKSA (bağlantıya dokunulmuyor) bu kontrol DEVREYE GİRMEZ.
 */
function assertUserLinkChangeAllowed(request: { user?: { role: string } | null; body: Record<string, unknown> }) {
  if (!("userId" in request.body)) return;
  if (request.user?.role !== "ADMIN") {
    throw new ForbiddenError("Doktor profilini bir kullanıcı hesabına bağlama/çözme yetkisi yalnızca ADMIN'dedir.");
  }
}

/**
 * [DPI] §1.1 — `practiceStartYear` üst sınırı (içinde bulunulan yıl) sabit `.max()` İLE
 * DEĞİL, dinamik olarak burada zorlanır (aksi hâlde her 1 Ocak'ta sessizce eskiyen bir sabit
 * gerekirdi — saklanan bir "deneyim yılı" değil, bir "başlangıç yılı ÜST SINIRI" olduğu için).
 */
function assertPracticeStartYearNotFuture(practiceStartYear: number | null | undefined) {
  if (practiceStartYear == null) return;
  const currentYear = new Date().getUTCFullYear();
  if (practiceStartYear > currentYear) {
    throw new ValidationError("Geçersiz mesleğe başlama yılı.", { practiceStartYear: ["Gelecekte bir yıl olamaz."] });
  }
}

/** [DPI] §1.1/§1.2 — `aboutHtml` `lib/html-sanitize.ts`'ten geçer; temizlik SONRASI boşsa `null`. */
function sanitizeAboutHtml(aboutHtml: string | null | undefined): string | null | undefined {
  if (aboutHtml === undefined) return undefined;
  if (aboutHtml === null) return null;
  const sanitized = sanitizeRichHtml(aboutHtml);
  return sanitized.length > 0 ? sanitized : null;
}

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
      assertUserLinkChangeAllowed(request);
      if (body.avatarMediaId) await assertImageMedia(app, body.avatarMediaId);
      assertPracticeStartYearNotFuture(body.practiceStartYear);

      const doctor = await app.prisma.doctorProfile.create({
        data: {
          title: body.title,
          subSpecialty: body.subSpecialty ?? null,
          fullName: body.fullName,
          slug: body.slug ? slugify(body.slug) : slugify(body.fullName),
          bio: body.bio,
          aboutHtml: sanitizeAboutHtml(body.aboutHtml) ?? null,
          practiceStartYear: body.practiceStartYear ?? null,
          cvEntries: (body.cvEntries ?? []) as Prisma.InputJsonValue,
          publications: (body.publications ?? []) as Prisma.InputJsonValue,
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

      // K8 — bağlama denetimi (yeni profil, `previousUserId` her zaman `null`).
      if ("userId" in body) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "telehealth.doctor.user_link",
          targetType: "DoctorProfile",
          targetId: doctor.id,
          metadata: { userId: body.userId ?? null, previousUserId: null },
          ipAddress: request.ip,
        });
      }

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
      assertUserLinkChangeAllowed(request);

      const existing = await app.prisma.doctorProfile.findUnique({ where: { id: request.params.doctorId } });
      if (!existing) throw new NotFoundError("Doktor bulunamadı.");

      const { slug, avatarMediaId, aboutHtml, cvEntries, publications, practiceStartYear, ...rest } = request.body;
      if (avatarMediaId) await assertImageMedia(app, avatarMediaId);
      assertPracticeStartYearNotFuture(practiceStartYear);

      const doctor = await app.prisma.doctorProfile.update({
        where: { id: request.params.doctorId },
        data: {
          ...rest,
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...(avatarMediaId !== undefined ? { avatarMediaId } : {}),
          ...(aboutHtml !== undefined ? { aboutHtml: sanitizeAboutHtml(aboutHtml) } : {}),
          ...(practiceStartYear !== undefined ? { practiceStartYear } : {}),
          ...(cvEntries !== undefined ? { cvEntries: cvEntries as Prisma.InputJsonValue } : {}),
          ...(publications !== undefined ? { publications: publications as Prisma.InputJsonValue } : {}),
        },
        include: WITH_DOCTOR_RELATIONS,
      });

      // K8 — bağlama/çözme denetimi.
      if ("userId" in request.body) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "telehealth.doctor.user_link",
          targetType: "DoctorProfile",
          targetId: doctor.id,
          metadata: { userId: request.body.userId ?? null, previousUserId: existing.userId },
          ipAddress: request.ip,
        });
      }

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

  /**
   * NOT — 2026-09-15 (backend-agent görev notu, "Admin randevu yeniden planlama") —
   * `PATCH /admin/telehealth/appointments/{id}/reschedule`. `id` bir **Appointment ID'sidir**
   * (booking ID DEĞİL) — bu uç YALNIZCA belirtilen TEK appointment satırını yeniden planlar,
   * booking'in DİĞER appointment'larına (çoklu-slot rezervasyonlarda) DOKUNMAZ (bilinçli/dar
   * kapsam, bkz. `telehealth.schemas.ts::RescheduleAppointmentRequestSchema` yorumu — backlog:
   * "booking-geneli reschedule"). Grup hook'u `ROLES_ADMIN_MANAGER`dir (§8.4) — bu route KENDİ
   * `requireSiteRole(...ROLES_ADMIN)` preHandler'ıyla MANAGER'ı EK OLARAK dışlar (para/randevu
   * hareketi beyanı, `mark-paid` İLE AYNI eşik disiplini).
   */
  server.patch(
    "/:id/reschedule",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        params: AppointmentIdParamSchema,
        body: RescheduleAppointmentRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.appointment.findUnique({
        where: { id: request.params.id },
        include: { doctor: { select: { id: true, timeZone: true, fullName: true, userId: true } } },
      });
      if (!existing) throw new NotFoundError("Randevu bulunamadı.");

      const [year, month, day] = request.body.newDate.split("-").map(Number) as [number, number, number];
      const [hour, minute] = request.body.newStartTime.split(":").map(Number) as [number, number];
      const newStartsAt = wallTimeToUtc({ year, month, day, hour, minute }, existing.doctor.timeZone);
      if (!newStartsAt) {
        throw new ValidationError(
          "Belirtilen tarih/saat, doktorun saat diliminde geçerli bir an değil (DST geçişi nedeniyle bu duvar saati mevcut değil).",
          { newStartTime: ["Bu saat mevcut değil, farklı bir saat seçin."] }
        );
      }

      // Süre KORUNUR — yalnızca BAŞLANGIÇ kayar (görev talimatı, bağlayıcı).
      const durationMs = existing.endsAt.getTime() - existing.startsAt.getTime();
      const newEndsAt = new Date(newStartsAt.getTime() + durationMs);
      const oldStartsAt = existing.startsAt;
      const oldEndsAt = existing.endsAt;

      const updated = await runSerializable(app, async (tx) => {
        // Aynı doktorun AYNI yeni zaman aralığıyla ÇAKIŞAN başka bir AKTİF randevusu olmamalı
        // (kendisi HARİÇ). `lib/booking.ts::createBooking`teki `@@unique([doctorId, startsAt])`
        // ikinci savunma hattı burada GEÇERLİ DEĞİLDİR (yalnızca TAM aynı başlangıç anını
        // yakalar, kısmi örtüşmeyi DEĞİL) — bu yüzden açık bir aralık-örtüşme sorgusu gerekir.
        const conflict = await tx.appointment.findFirst({
          where: {
            doctorId: existing.doctorId,
            id: { not: existing.id },
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            startsAt: { lt: newEndsAt },
            endsAt: { gt: newStartsAt },
          },
        });
        if (conflict) throw new AppointmentRescheduleConflictError();

        // [ASD] §2.6 (bağlayıcı) — hatırlatma süpürücüsü damgaları AYNI transaction'da null'lanır;
        // aksi hâlde saati ileri alınan bir randevu bir daha ASLA hatırlatma e-postası almaz
        // (bkz. lib/appointment-reminders.ts).
        return tx.appointment.update({
          where: { id: existing.id },
          data: { startsAt: newStartsAt, endsAt: newEndsAt, reminded60mAt: null, reminded30mAt: null },
          include: WITH_APPOINTMENT_RELATIONS,
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.appointment.rescheduled",
        targetType: "Appointment",
        targetId: existing.id,
        metadata: {
          oldStartsAt: oldStartsAt.toISOString(),
          oldEndsAt: oldEndsAt.toISOString(),
          newStartsAt: newStartsAt.toISOString(),
          newEndsAt: newEndsAt.toISOString(),
          reason: request.body.reason ?? null,
        },
        ipAddress: request.ip,
      });

      // §9.7.8 desenİYLE AYNI — best-effort, e-posta gönderimi BAŞARISIZ olsa da bu uç ASLA
      // 500 dönmez (bkz. notifications.ts::triggerAppointmentRescheduledEmail).
      await triggerAppointmentRescheduledEmail(app, {
        appointment: existing,
        doctorTimeZone: existing.doctor.timeZone,
        doctorFullName: existing.doctor.fullName,
        doctorUserId: existing.doctor.userId,
        oldStartsAt,
        newStartsAt,
        reason: request.body.reason ?? null,
      });

      return reply.send(ok(toAppointmentDto(updated)));
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

      // [DPI] §2.7 — `identity` yalnızca `canAccessBookingHealthData` eşiğini geçen aktörler
      // için doldurulur: `ADMIN` ✓, `MANAGER` ✗ (booking'in kendisi görünür, kimliği GÖREMEZ).
      return reply.send(
        ok(
          rows.map((row) => toAppointmentBookingDto(row, canAccessBookingHealthData(row, { user: request.user }))),
          buildPageMeta(rows, limit)
        )
      );
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
      // Bu uç yalnızca `ROLES_ADMIN` içindir (mark-paid preHandler) — `canAccessBookingHealthData`
      // ADMIN için her zaman `true` döner, ama tek kaynak disiplini için yine de çağrılır.
      return reply.send(ok(toAppointmentBookingDto(withRelations, canAccessBookingHealthData(withRelations, { user: request.user }))));
    }
  );
}

/**
 * `/admin/telehealth/settings` prefix'i altında bağlanır — randevu sihirbazının
 * (`/doctors/[slug]`, frontend) tema renkleri. Migration/yeni Prisma modeli YOK; `SiteModule`
 * satırının (`key="telehealth"`) genel amaçlı `settings Json` alanı KULLANILIR (bkz.
 * `lib/theme-settings.ts::parseTelehealthTheme`). `GET` → panel kapısı (`ROLES_PANEL`,
 * `specialties` GET İLE AYNI), `PATCH` → `ROLES_ADMIN_MANAGER` (`specialties` PATCH İLE AYNI).
 * DİKKAT: bu route `SiteModule.enabled`'a HİÇ DOKUNMAZ — modülün açık/kapalı durumu
 * `adminSiteModulesRoutes`'un işidir (`site-modules.routes.ts`), `enabled` `create` dalında
 * BİLİNÇLİ OLARAK belirtilmez (Prisma `@default(true)` devreye girer).
 */
export async function adminTelehealthSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: { response: { 200: ApiSuccessSchema(TelehealthThemeSettingsSchema) } },
    },
    async (_request, reply) => {
      const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
      return reply.send(ok(parseTelehealthTheme(row?.settings)));
    }
  );

  server.patch(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: {
        body: UpdateTelehealthThemeSettingsRequestSchema,
        response: { 200: ApiSuccessSchema(TelehealthThemeSettingsSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
      const currentTheme = parseTelehealthTheme(existing?.settings);
      const merged = { ...currentTheme, ...request.body };

      const row = await app.prisma.siteModule.upsert({
        where: { key: "telehealth" },
        create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
        update: { settings: merged, updatedById: request.user!.id },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.settings.update",
        targetType: "SiteModule",
        targetId: "telehealth",
        metadata: merged,
        ipAddress: request.ip,
      });

      // qa-agent bulgusu (2026-09-14) — tema rengi `/doctors/[slug]`'ın `revalidate: 60`
      // önbelleğine tabi (`fetchTelehealthThemeServer`); bu satır OLMADAN admin'deki bir renk
      // değişikliği ~60sn'ye kadar yansımıyordu (görev talimatının "ANINDA" beklentisiyle
      // ÇELİŞİYORDU). `appearance.routes.ts`'in AYNI global best-effort revalidation deseni.
      await triggerGlobalRevalidation(app);

      return reply.send(ok(parseTelehealthTheme(row.settings)));
    }
  );
}
