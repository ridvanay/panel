import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { authenticateOptional } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { AppointmentBookingSchema, BookingIdentitySchema } from "../../schemas/entities";
import { toAppointmentBookingDto } from "../../mappers";
import { IdentityLockedError, NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { assertBookingHealthDataAccess, assertBookingPatientOnlyAccess, canAccessBookingHealthData } from "../../lib/telehealth-access";
import {
  decryptIdentityNumber,
  encryptIdentityNumber,
  hashIdentityNumber,
  maskIdentityNumber,
  serializeIdentityBirthDate,
  validateBookingIdentityInput,
} from "../../lib/identity";
import { AccessTokenQuerySchema, BookingIdentityInputSchema, BookingIdParamSchema } from "./telehealth.schemas";

/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.6/§2.7 — hasta
 * kimlik bilgisinin OKUMA (açık değer, denetimli) + DÜZELTME (yalnızca hasta, yalnızca `PENDING`)
 * yüzeyi. "YENİ YÜZEY = YENİ DOSYA" deseni ([TCT] §9.7 tadilatındaki `telehealth.checkout.routes.ts`/
 * `telehealth.recording-access.routes.ts` emsali) — `telehealth.routes.ts`'e DOKUNULMAZ. Aynı
 * public `/appointments` yüzeyine EKLENİR; kendi `requireModuleEnabled("telehealth")` +
 * `authenticateOptional` hook'unu KENDİSİ taşır.
 */
const WITH_BOOKING_DOCTOR = { id: true, title: true, fullName: true, slug: true, userId: true } as const;
const WITH_ACCESS_CHECK_RELATIONS = {
  doctor: { select: WITH_BOOKING_DOCTOR },
  appointments: { select: { endsAt: true } },
} as const;
const WITH_BOOKING_RELATIONS = {
  doctor: { select: WITH_BOOKING_DOCTOR },
  // `startsAt asc` — diğer telehealth route dosyalarıyla AYNI disiplin (deterministik sıra).
  appointments: { orderBy: { startsAt: "asc" } },
  intake: { select: { id: true } },
  documents: { where: { deletedAt: null }, select: { id: true } },
} as const;

export async function telehealthIdentityRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticateOptional);

  /**
   * [DPI] §2.7 — çözülmüş kimlik numarasının döndüğü TEK uç (`GET .../intake` emsali). Yetki
   * `assertBookingHealthDataAccess`: hasta, o booking'in doktoru, `ADMIN`; `MANAGER`/`EDITOR`/
   * başka doktor → `404` (varlık sızdırılmaz). Her çağrı `logAudit` yazar; `metadata`'ya
   * numara/maske ASLA yazılmaz.
   */
  server.get(
    "/appointments/bookings/:bookingId/identity",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        response: { 200: ApiSuccessSchema(BookingIdentitySchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: WITH_ACCESS_CHECK_RELATIONS,
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      assertBookingHealthDataAccess(booking, { user: request.user, providedToken: request.query.t });

      // Booking'de kimlik hiç yoksa (bu turdan önceki satırlar / deprecated `POST /appointments`
      // akışı) → `404`; istemci bunu `AppointmentBooking.identity === null` ile zaten bilir.
      if (
        !booking.citizenshipType ||
        !booking.identityCountryCode ||
        !booking.identityNumberCiphertext ||
        !booking.patientBirthDate ||
        !booking.identityCapturedAt
      ) {
        throw new NotFoundError("Bu rezervasyon için kaydedilmiş bir kimlik bilgisi yok.");
      }

      const identityNumber = decryptIdentityNumber(booking.identityNumberCiphertext);

      // §2.7 (ZORUNLU, KVKK teknik tedbiri) — `metadata`'ya yalnızca `bookingId`/aktör/IP.
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.identity.accessed",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        ipAddress: request.ip,
      });

      return reply.header("Cache-Control", "no-store").send(
        ok({
          bookingId: booking.id,
          citizenshipType: booking.citizenshipType,
          countryCode: booking.identityCountryCode,
          identityNumber,
          birthDate: serializeIdentityBirthDate(booking.patientBirthDate),
          capturedAt: booking.identityCapturedAt.toISOString(),
        })
      );
    }
  );

  /**
   * [DPI] §2.6 — kimlik bilgisini DÜZELT (yalnızca hasta, yalnızca ödeme öncesi). Yetki
   * `assertBookingPatientOnlyAccess` (`PUT .../intake` İLE AYNI eşik). `paymentStatus !==
   * PENDING` → `409 IDENTITY_LOCKED`. Doğrulama kuralları `POST /appointments/bookings` İLE
   * BİREBİR AYNIDIR (`lib/identity.ts::validateBookingIdentityInput`, tek kaynak).
   */
  server.put(
    "/appointments/bookings/:bookingId/identity",
    {
      schema: {
        params: BookingIdParamSchema,
        querystring: AccessTokenQuerySchema,
        body: BookingIdentityInputSchema,
        response: { 200: ApiSuccessSchema(AppointmentBookingSchema) },
      },
    },
    async (request, reply) => {
      const booking = await app.prisma.appointmentBooking.findUnique({
        where: { id: request.params.bookingId },
        include: WITH_BOOKING_RELATIONS,
      });
      if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");

      assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t });

      if (booking.paymentStatus !== "PENDING") {
        throw new IdentityLockedError();
      }

      const validated = validateBookingIdentityInput(request.body);

      const updated = await app.prisma.appointmentBooking.update({
        where: { id: booking.id },
        data: {
          citizenshipType: validated.citizenshipType,
          identityCountryCode: validated.countryCode,
          identityNumberCiphertext: encryptIdentityNumber(validated.normalizedNumber),
          identityNumberHash: hashIdentityNumber(validated.citizenshipType, validated.countryCode, validated.normalizedNumber),
          identityNumberMasked: maskIdentityNumber(validated.citizenshipType, validated.normalizedNumber),
          patientBirthDate: validated.birthDate,
          identityCapturedAt: new Date(),
        },
        include: WITH_BOOKING_RELATIONS,
      });

      // §2.7 — metadata'da SADECE `fields: [...]`; numara/maske/doğum tarihi YAZILMAZ.
      await logAudit(app, {
        actorId: request.user?.id ?? null,
        actorEmail: request.user?.email ?? null,
        action: "telehealth.identity.updated",
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: { fields: ["citizenshipType", "countryCode", "identityNumber", "birthDate"] },
        ipAddress: request.ip,
      });

      const hasHealthDataAccess = canAccessBookingHealthData(updated, { user: request.user, providedToken: request.query.t });
      return reply.send(ok(toAppointmentBookingDto(updated, hasHealthDataAccess)));
    }
  );
}
