import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import {
  AppointmentBookingSchema,
  AppointmentDocumentSchema,
  AppointmentIntakeSchema,
  AppointmentSchema,
  AvailabilitySlotSchema,
  BookingInvoiceSchema,
  CreateAppointmentResultSchema,
  CreateBookingResultSchema,
  DoctorProfileSchema,
} from "../../schemas/entities";
import {
  toAppointmentBookingDto,
  toAppointmentDocumentDto,
  toAppointmentDto,
  toAppointmentIntakeDto,
  toDoctorProfileDto,
} from "../../mappers";
import {
  BookingNotPayableError,
  ConflictError,
  DocumentLimitReachedError,
  HealthConsentRequiredError,
  NotFoundError,
  UnsupportedDocumentTypeError,
  ValidationError,
} from "../../lib/errors";
import { hashToken } from "../../lib/tokens";
import { timingSafeEqualHex } from "../../lib/api-key";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { generateAvailableSlots, parseIsoCalendarDate } from "./lib/availability";
import { bookAppointment, createBooking } from "./lib/booking";
import { encryptSecret, decryptSecret } from "../../lib/crypto";
import { detectUploadMimeType } from "../../lib/mime-detect";
import { telehealthDocumentStorage } from "../../lib/telehealth-document-storage";
import { logAudit } from "../../lib/audit";
import { BOOKING_CREATE_RATE_LIMIT, BOOKING_DOCUMENT_UPLOAD_RATE_LIMIT } from "../../lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "../../plugins/uploads";
import { env } from "../../config/env";
import { SETTINGS_ID } from "../settings/settings.routes";
import {
  assertBookingHealthDataAccess,
  assertBookingPatientOnlyAccess,
  assertBookingPatientOrAdminAccess,
  assertBookingViewAccess,
} from "../../lib/telehealth-access";
import {
  AccessTokenQuerySchema,
  AppointmentDocumentIdParamSchema,
  AppointmentIdParamSchema,
  BookingIdParamSchema,
  CancelAppointmentRequestSchema,
  CancelBookingRequestSchema,
  CreateAppointmentRequestSchema,
  CreateBookingRequestSchema,
  DoctorSlotsQuerySchema,
  DoctorSlugParamSchema,
  ListPublicDoctorsQuerySchema,
  UpsertIntakeRequestSchema,
} from "./telehealth.schemas";

/** Doktor liste/detay sorgularında uzmanlık + avatarını de dönmek için ortak `include`. */
const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
const WITH_APPOINTMENT_RELATIONS = { doctor: { select: { id: true, title: true, fullName: true, slug: true } } } as const;
const WITH_BOOKING_DOCTOR = { id: true, title: true, fullName: true, slug: true, userId: true } as const;
const WITH_BOOKING_RELATIONS = {
  doctor: { select: WITH_BOOKING_DOCTOR },
  appointments: true,
  // §9.7.5 madde 8 — yalnızca VARLIK/SAYI taşınır, İÇERİK asla (bkz. mappers/index.ts::toAppointmentBookingDto).
  intake: { select: { id: true } },
  documents: { where: { deletedAt: null }, select: { id: true } },
} as const;

// §9.7.5 madde 4 (bağlayıcı) — whitelist DIŞI (SVG DAHİL) kesin reddedilir.
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_DOCUMENTS_PER_BOOKING = 5;

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

/** [TCT] §9.7.5 — sha256 hex özeti, erişim denetim izinde/olası bütünlük kontrolünde kullanılır. */
function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** HTTP başlığına yazılırken satır sonu/çift tırnak enjeksiyonunu engeller (savunma derinliği). */
function sanitizeHeaderFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
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
  //
  // [TCT] §9.7.2 (bağlayıcı) — DEPRECATED, yerine `POST /appointments/bookings` gelir.
  // DAVRANIŞ DEĞİŞİKLİĞİ (§9.7.3): artık `PENDING_PAYMENT` ile başlar (iç olarak `slotCount: 1`
  // bir `AppointmentBooking` üretir, bkz. `lib/booking.ts::bookAppointment`); ödeme onaylanana
  // kadar otomatik `SCHEDULED`'a geçmez.
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

  // ========================================================================
  // [TCT] §9.7 TADİLAT TURU 2 — çoklu slot rezervasyon + sağlık verisi uçları.
  // NOT: `checkout-session` (integration-agent, Stripe) ve `resend-link`
  // (notification-agent, §9.7.10 uç tablosu) BİLİNÇLİ OLARAK BU DOSYADA DEĞİLDİR.
  // ========================================================================

  server.post(
    "/appointments/bookings",
    {
      config: { rateLimit: BOOKING_CREATE_RATE_LIMIT },
      schema: { body: CreateBookingRequestSchema, response: { 201: ApiSuccessSchema(CreateBookingResultSchema) } },
    },
    async (request, reply) => {
      const { doctorSlug, slots, patientName, patientEmail, consentVersion } = request.body;

      const result = await createBooking(app, {
        doctorSlug,
        slots: slots.map((s) => new Date(s)),
        patientName,
        patientEmail,
        patientUserId: request.user?.id ?? null,
        consentVersion,
      });

      // [TCT] §9.7.1 madde 6 (bağlayıcı) — yapılandırılmamışken booking yine `201` döner;
      // `checkoutUrl` her zaman `null`'dur (gerçek Stripe Checkout URL'i yalnızca
      // integration-agent'ın `POST .../checkout-session` ucundan gelir, burada ASLA üretilmez).
      const paymentsConfigured = Boolean(env.STRIPE_SECRET_KEY);

      return reply.code(201).send(
        ok({
          bookingId: result.booking.id,
          bookingNumber: result.booking.bookingNumber,
          doctorSlug,
          slotCount: result.booking.slotCount,
          unitPriceCents: result.booking.unitPriceCents,
          subtotalCents: result.booking.subtotalCents,
          totalCents: result.booking.totalCents,
          currency: result.booking.currency,
          paymentStatus: result.booking.paymentStatus,
          expiresAt: result.booking.expiresAt.toISOString(),
          appointments: result.appointments.map((appointment) => toAppointmentDto({ ...appointment, doctor: result.doctor })),
          accessToken: result.rawAccessToken,
          paymentsConfigured,
          checkoutUrl: null,
        })
      );
    }
  );

  server.get(
    "/appointments/bookings/:bookingId",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: WITH_BOOKING_RELATIONS,
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      assertBookingViewAccess(booking, { user: request.user, providedToken: request.query.t });

      return reply.send(ok(toAppointmentBookingDto(booking)));
    }
  );

  server.post(
    "/appointments/bookings/:bookingId/cancel",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        body: CancelBookingRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: WITH_BOOKING_RELATIONS,
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      assertBookingPatientOrAdminAccess(booking, { user: request.user, providedToken: request.query.t });

      // [TCT] §9.7.3 (bağlayıcı) — hiç ödenmemiş booking'in iptali: satırlar SİLİNİR, slot
      // serbest kalır, booking `EXPIRED` olur (süre dolumu süpürücüsüyle AYNI son durum,
      // yalnızca tetikleyicisi kullanıcı isteğidir).
      if (booking.paymentStatus === "PENDING") {
        await app.prisma.$transaction(async (tx) => {
          await tx.appointment.deleteMany({ where: { bookingId: booking.id, status: "PENDING_PAYMENT" } });
          await tx.appointmentBooking.update({ where: { id: booking.id }, data: { paymentStatus: "EXPIRED" } });
        });
      } else if (booking.paymentStatus === "PAID") {
        // §4.3 AYNEN GEÇERLİDİR — ödenmiş/`SCHEDULED` bir randevunun iptalinde satır silinmez,
        // slot kapalı kalır. Para iadesi bu turda YOKTUR (backlog: feature/telehealth-refunds).
        const cancellableCount = booking.appointments.filter((a) => a.status === "SCHEDULED" || a.status === "IN_PROGRESS").length;
        if (cancellableCount === 0) {
          throw new ConflictError("Bu rezervasyon zaten iptal edilmiş veya tamamlanmış.");
        }
        await app.prisma.appointment.updateMany({
          where: { bookingId: booking.id, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: request.body.reason ?? null },
        });
      } else {
        throw new ConflictError("Bu rezervasyon iptal edilebilir bir durumda değil.");
      }

      const updated = await app.prisma.appointmentBooking.findUniqueOrThrow({
        where: { id: booking.id },
        include: WITH_BOOKING_RELATIONS,
      });
      return reply.send(ok(toAppointmentBookingDto(updated)));
    }
  );

  server.get(
    "/appointments/bookings/:bookingId/invoice",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(BookingInvoiceSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { orderBy: { startsAt: "asc" } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.0 madde 11 — yalnızca ADMIN/hasta erişir (doktor/MANAGER DAHİL DEĞİL — bu bir
      // ödeme belgesidir, tıbbi bir kayıt değil).
      assertBookingPatientOrAdminAccess(booking, { user: request.user, providedToken: request.query.t });

      if (booking.paymentStatus !== "PAID" || !booking.paidAt) {
        throw new BookingNotPayableError("Yalnızca ödemesi tamamlanmış rezervasyonlar için ödeme belgesi üretilebilir.");
      }

      const siteSettings = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });

      return reply.send(
        ok({
          bookingNumber: booking.bookingNumber,
          issuedAt: booking.paidAt.toISOString(),
          seller: { name: siteSettings?.siteName ?? "Site", email: null },
          buyer: { name: booking.patientName, email: booking.patientEmail },
          // Uzmanlık/doktor adı satır metnine YAZILMAZ — çıkarımsal sağlık verisi (§7.1).
          lines: booking.appointments.map((appointment) => ({
            description: `Online konsültasyon (${Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000)} dk)`,
            startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString(),
            unitPriceCents: appointment.priceCents,
          })),
          subtotalCents: booking.subtotalCents,
          totalCents: booking.totalCents,
          currency: booking.currency,
          stripePaymentIntentId: booking.stripePaymentIntentId,
          disclaimer:
            "Bu belge resmi bir fatura/e-Fatura değildir; yalnızca bilgilendirme amaçlıdır. e-Fatura/e-Arşiv entegrasyonu bulunmamaktadır.",
        })
      );
    }
  );

  // ---------------------------------------------------------------------
  // §9.7.5 KARAR J (ENGELLEYİCİ) — şifreli intake notu.
  // ---------------------------------------------------------------------

  server.put(
    "/appointments/bookings/:bookingId/intake",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        body: UpsertIntakeRequestSchema,
        response: { 200: ApiSuccessSchema(AppointmentIntakeSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.5 madde 1/7 — bu adım OPSİYONELDİR ve yalnızca hastanın KENDİSİ yazabilir.
      assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t });

      if (request.body.healthDataConsent !== true) {
        throw new HealthConsentRequiredError();
      }

      const now = new Date();
      const consentVersion = request.body.consentVersion?.trim() || "v1";
      const noteCiphertext = request.body.note && request.body.note.length > 0 ? encryptSecret(request.body.note) : null;

      const intake = await app.prisma.appointmentIntake.upsert({
        where: { bookingId: booking.id },
        create: {
          bookingId: booking.id,
          noteCiphertext,
          healthDataConsentAt: now,
          healthDataConsentVersion: consentVersion,
        },
        update: {
          noteCiphertext,
          healthDataConsentAt: now,
          healthDataConsentVersion: consentVersion,
        },
      });

      return reply.send(ok(toAppointmentIntakeDto(intake, request.body.note ?? null)));
    }
  );

  server.get(
    "/appointments/bookings/:bookingId/intake",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(AppointmentIntakeSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.5 madde 7 (ENGELLEYİCİ) — hasta/booking'in doktoru/ADMIN. MANAGER/EDITOR HARİÇ.
      assertBookingHealthDataAccess(booking, { user: request.user, providedToken: request.query.t });

      const intake = await app.prisma.appointmentIntake.findUnique({ where: { bookingId: booking.id } });
      if (!intake) throw new NotFoundError("Bu rezervasyon için kaydedilmiş bir not yok.");

      const note = intake.noteCiphertext ? decryptSecret(intake.noteCiphertext) : null;

      // §9.7.5 madde 6 (ZORUNLU, KVKK teknik tedbiri) — her okuma denetlenir. `metadata`'ya
      // not İÇERİĞİ/dosya adı ASLA yazılmaz (§9.7.5 madde 8 ile birleşik kural).
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.intake_note.accessed",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        ipAddress: request.ip,
      });

      return reply.send(ok(toAppointmentIntakeDto(intake, note)));
    }
  );

  server.delete(
    "/appointments/bookings/:bookingId/intake",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 204: z.undefined() },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // KVKK md.11 (bağlayıcı) — hasta (oturum/`?t=`) veya ADMIN; doktor SİLEMEZ.
      assertBookingPatientOrAdminAccess(booking, { user: request.user, providedToken: request.query.t });

      // Rıza KANITI (`healthDataConsentAt`/`...Version`) denetim bütünlüğü için KORUNUR —
      // yalnızca not METNİ (`noteCiphertext`) `null`'lanır (§9.7.5 madde 9/10).
      await app.prisma.appointmentIntake.updateMany({ where: { bookingId: booking.id }, data: { noteCiphertext: null } });

      return reply.code(204).send();
    }
  );

  // ---------------------------------------------------------------------
  // §9.7.5 KARAR J (ENGELLEYİCİ) — özel depoda tıbbi belge.
  // ---------------------------------------------------------------------

  server.post(
    "/appointments/bookings/:bookingId/documents",
    {
      config: { rateLimit: BOOKING_DOCUMENT_UPLOAD_RATE_LIMIT },
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 201: ApiSuccessSchema(AppointmentDocumentSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.5 madde 1/7 — yalnızca hastanın KENDİSİ yükleyebilir.
      assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t });

      const activeDocumentCount = await app.prisma.appointmentDocument.count({ where: { bookingId: booking.id, deletedAt: null } });
      if (activeDocumentCount >= MAX_DOCUMENTS_PER_BOOKING) {
        throw new DocumentLimitReachedError();
      }

      // §9.7.5 madde 2 (bağlayıcı) — multipart gövde YALNIZCA `file` alanı taşır (openapi.yaml
      // `CreateDocumentRequest` — `healthDataConsent` bu istekte YOKTUR). Sağlık verisi rızası
      // TEK bir kapıdan (`PUT .../intake`, `healthDataConsent: true`) alınır ve HEM not HEM
      // belge için GEÇERLİDİR (compliance-agent'ın onay kutusu metni ikisini BİRLİKTE kapsar —
      // bkz. `.claude/compliance-notes-telehealth.md` "TUR 2"). `AppointmentIntake` satırının
      // VARLIĞI zaten rızanın KANITIDIR (`healthDataConsentAt` NOT NULL — "rıza olmadan bu satır
      // VAR OLAMAZ"); bu yüzden not YAZMADAN, yalnızca rıza vererek de belge yüklenebilir.
      const intake = await app.prisma.appointmentIntake.findUnique({ where: { bookingId: booking.id } });
      if (!intake) throw new HealthConsentRequiredError();

      const parts = request.parts();
      let filename: string | undefined;
      let mimetype: string | undefined;
      let buffer: Buffer | undefined;

      for await (const part of parts) {
        if (part.type === "file") {
          if (buffer !== undefined) {
            part.file.resume();
            continue;
          }
          filename = part.filename;
          mimetype = part.mimetype;
          buffer = await part.toBuffer();
        }
      }

      if (!buffer || !filename || !mimetype) {
        throw new ValidationError("Yüklenecek dosya bulunamadı.", { file: ["Zorunlu."] });
      }
      if (buffer.byteLength > MAX_UPLOAD_BYTES) {
        throw new ValidationError("Dosya boyutu izin verilen sınırı aşıyor.", { file: ["En fazla 5 MB olabilir."] });
      }

      // GÜVENLİK (§9.7.5 madde 4) — beyan edilen `Content-Type` DEĞİL, sihirli-bayt ile
      // TESPİT EDİLEN gerçek tür güvenilir kaynaktır. SVG DAHİL whitelist dışı KESİN reddedilir.
      const detected = detectUploadMimeType(buffer);
      if (!detected.mimeType || detected.isSvg || !ALLOWED_DOCUMENT_MIME_TYPES.has(detected.mimeType)) {
        throw new UnsupportedDocumentTypeError();
      }
      if (detected.mimeType !== mimetype) {
        throw new UnsupportedDocumentTypeError(
          `Content-Type "${mimetype}" olarak beyan edildi ama dosya içeriği "${detected.mimeType}" olarak tespit edildi.`
        );
      }

      const storagePath = await telehealthDocumentStorage.save(buffer, detected.mimeType);

      const document = await app.prisma.appointmentDocument.create({
        data: {
          bookingId: booking.id,
          storagePath,
          filename,
          mimeType: detected.mimeType,
          sizeBytes: buffer.byteLength,
          sha256: sha256Hex(buffer),
        },
      });

      return reply.code(201).send(ok(toAppointmentDocumentDto(document)));
    }
  );

  server.get(
    "/appointments/bookings/:bookingId/documents",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(AppointmentDocumentSchema)) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } },
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      // §9.7.5 madde 7 — METADATA listesi hasta/doktor/ADMIN'e açıktır (MANAGER yalnızca
      // booking görünümündeki `documentCount` sayısını görür, bu listeyi GÖREMEZ).
      assertBookingHealthDataAccess(booking, { user: request.user, providedToken: request.query.t });

      const documents = await app.prisma.appointmentDocument.findMany({
        where: { bookingId: booking.id, deletedAt: null },
        orderBy: { seq: "asc" },
      });

      return reply.send(ok(documents.map(toAppointmentDocumentDto)));
    }
  );

  server.get(
    "/appointments/documents/:documentId/content",
    {
      schema: { params: AppointmentDocumentIdParamSchema, querystring: AccessTokenQuerySchema },
    },
    async (request, reply) => {
      const document = await app.prisma.appointmentDocument.findUnique({
        where: { id: request.params.documentId },
        include: {
          booking: { include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } } },
        },
      });
      if (!document || document.deletedAt) throw new NotFoundError("Belge bulunamadı.");

      // §9.7.5 madde 5/7 (ENGELLEYİCİ) — TEK servis yolu. Hasta/booking'in doktoru/ADMIN;
      // MANAGER/EDITOR/başka doktor → 404 (varlık sızdırılmaz).
      assertBookingHealthDataAccess(document.booking, { user: request.user, providedToken: request.query.t });

      const buffer = await telehealthDocumentStorage.read(document.storagePath);

      // §9.7.5 madde 6 (ZORUNLU) — her başarılı erişim denetlenir. `metadata`'ya dosya
      // ADI/`storagePath` ASLA yazılmaz (yalnızca opak `documentId`/`bookingId`).
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.intake_document.accessed",
        targetType: "AppointmentDocument",
        targetId: document.id,
        metadata: { bookingId: document.bookingId },
        ipAddress: request.ip,
      });

      return reply
        .header("Content-Disposition", `attachment; filename="${sanitizeHeaderFilename(document.filename)}"`)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .type(document.mimeType)
        .send(buffer);
    }
  );

  server.delete(
    "/appointments/documents/:documentId",
    {
      schema: { params: AppointmentDocumentIdParamSchema, querystring: AccessTokenQuerySchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const document = await app.prisma.appointmentDocument.findUnique({
        where: { id: request.params.documentId },
        include: {
          booking: { include: { doctor: { select: WITH_BOOKING_DOCTOR }, appointments: { select: { endsAt: true } } } },
        },
      });
      if (!document || document.deletedAt) throw new NotFoundError("Belge bulunamadı.");

      // KVKK md.11 — hasta (oturum/`?t=`) veya ADMIN; doktor bir hastanın belgesini SİLEMEZ.
      assertBookingPatientOrAdminAccess(document.booking, { user: request.user, providedToken: request.query.t });

      // Dosya DİSKTEN gerçekten silinir; satır erişim denetim izi bütünlüğü için `deletedAt` ile KALIR.
      await telehealthDocumentStorage.remove(document.storagePath);
      await app.prisma.appointmentDocument.update({ where: { id: document.id }, data: { deletedAt: new Date() } });

      return reply.code(204).send();
    }
  );
}
