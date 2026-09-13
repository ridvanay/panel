import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, CursorQuerySchema } from "../../schemas/common";
import { AppointmentBookingSchema, DoctorEarningsResponseSchema, DoctorPortalProfileSchema } from "../../schemas/entities";
import { toAppointmentBookingDto, toDoctorPortalProfileDto } from "../../mappers";
import { NotADoctorError, TwoFactorRequiredError } from "../../lib/errors";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { env } from "../../config/env";
import { DoctorBookingsQuerySchema } from "./telehealth.schemas";
import { splitCommission } from "./lib/commission";

const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
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
 * [TCT] §9.7.7 KARAR K madde 1/2 (bağlayıcı) — `SiteRole.DOCTOR` EKLENMEZ: doktorluk
 * `DoctorProfile.userId === user.id` İLİŞKİSİDİR. 2FA ZORUNLULUĞU yeni bir DB kolonu/2FA ucu
 * İLE DEĞİL, route seviyesinde bir KAPI ile uygulanır (`user.twoFactorEnabled !== true` →
 * `403 TWO_FACTOR_REQUIRED`). Sıra bilinçlidir: önce ilişki (`NOT_A_DOCTOR`), sonra 2FA kapısı —
 * doktor OLMAYAN birine "2FA açman lazım" demek yanıltıcı olurdu.
 */
async function requireDoctorPortalAccess(
  app: FastifyInstance,
  userId: string
): Promise<{ user: { id: string; email: string; name: string; twoFactorEnabled: boolean }; doctorProfileId: string }> {
  const user = await app.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, twoFactorEnabled: true },
  });
  if (!user) throw new NotADoctorError();

  const doctorProfile = await app.prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!doctorProfile) throw new NotADoctorError();

  if (user.twoFactorEnabled !== true) throw new TwoFactorRequiredError();

  return { user, doctorProfileId: doctorProfile.id };
}

/**
 * `/doctor` prefix'i altında bağlanır (bkz. app.ts) — panel DEĞİLDİR (doktor bir admin
 * kullanıcısı değildir), oturum GEREKTİRİR. `/admin/telehealth/*` bundan TAMAMEN AYRIDIR.
 */
export async function telehealthDoctorPortalRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/me",
    { schema: { response: { 200: ApiSuccessSchema(DoctorPortalProfileSchema) } } },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      const doctorProfile = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: doctorProfileId },
        include: WITH_DOCTOR_RELATIONS,
      });

      return reply.send(ok(toDoctorPortalProfileDto(user, doctorProfile)));
    }
  );

  server.get(
    "/bookings",
    {
      schema: {
        querystring: DoctorBookingsQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentBookingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      const { from, to, paymentStatus, cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      // `doctorId` sorgu parametresi BİLİNÇLİ OLARAK YOKTUR (IDOR yüzeyi) — yalnızca oturumun
      // KENDİ `DoctorProfile`'ı üzerinden filtrelenir.
      const rows = await app.prisma.appointmentBooking.findMany({
        where: {
          doctorId: doctorProfileId,
          ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
          ...(from || to
            ? {
                appointments: {
                  some: {
                    ...(from ? { startsAt: { gte: new Date(from) } } : {}),
                    ...(to ? { startsAt: { lte: new Date(to) } } : {}),
                  },
                },
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

  /**
   * §9.7 TADİLAT — salt-okunur kazanç özeti. `/doctor/me`/`/doctor/bookings` İLE AYNI şekilde
   * rate limit/audit log GEREKMEZ (hassas bir yazma eylemi değil).
   */
  server.get(
    "/earnings",
    {
      schema: {
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessWithMeta(DoctorEarningsResponseSchema, z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);

      // Tek para birimi varsayımı — `DoctorProfile.currency`/`sessionPriceCents` İLE AYNI desen.
      const doctorProfile = await app.prisma.doctorProfile.findUniqueOrThrow({
        where: { id: doctorProfileId },
        select: { currency: true },
      });
      const currency = doctorProfile.currency;
      const rate = env.PLATFORM_COMMISSION_RATE_PERCENT;

      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      // `summary` — SAYFALAMA UYGULANMADAN tüm tamamlanmış randevular üzerinden hesaplanır (satır
      // bazında YUVARLA, SONRA topla — `sessions.items` ile toplamda TUTARSIZLIK olmasın).
      const allCompleted = await app.prisma.appointment.findMany({
        where: { doctorId: doctorProfileId, status: "COMPLETED" },
        select: { priceCents: true },
      });
      let grossCents = 0;
      let commissionCents = 0;
      let netCents = 0;
      for (const row of allCompleted) {
        const split = splitCommission(row.priceCents, rate);
        grossCents += split.grossCents;
        commissionCents += split.commissionCents;
        netCents += split.netCents;
      }

      // `doctorId` sorgu parametresi BİLİNÇLİ OLARAK YOKTUR (IDOR yüzeyi, `/bookings` İLE AYNI
      // disiplin) — yalnızca oturumun KENDİ `DoctorProfile`'ı üzerinden filtrelenir.
      const rows = await app.prisma.appointment.findMany({
        where: {
          doctorId: doctorProfileId,
          status: "COMPLETED",
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
        },
        orderBy: { seq: "desc" },
        take: limit,
        include: { booking: { select: { id: true } } },
      });

      const items = rows.map((appointment) => {
        const split = splitCommission(appointment.priceCents, rate);
        return {
          // `booking` YOKSA (bu tur ÖNCESİ deprecated tekil randevu) `appointmentId`'ye düşer.
          bookingId: appointment.booking?.id ?? appointment.id,
          appointmentId: appointment.id,
          patientName: appointment.patientName,
          startsAt: appointment.startsAt.toISOString(),
          grossCents: split.grossCents,
          commissionCents: split.commissionCents,
          netCents: split.netCents,
          currency: appointment.currency,
        };
      });

      return reply.send(
        ok(
          {
            summary: {
              grossCents,
              commissionCents,
              netCents,
              currency,
              commissionRatePercent: rate,
              completedSessionCount: allCompleted.length,
            },
            sessions: { items },
          },
          buildPageMeta(rows, limit)
        )
      );
    }
  );
}

/**
 * `/patient` prefix'i altında bağlanır (bkz. app.ts) — oturum GEREKTİRİR, **2FA ZORUNLU
 * DEĞİLDİR** (hasta bir panel kullanıcısı değildir, §9.7.10). Oturumu olmayan misafir hasta
 * bunun yerine magic-link'li `GET /appointments/bookings/{bookingId}?t=` yolunu kullanır.
 */
export async function telehealthPatientPortalRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get(
    "/bookings",
    {
      schema: {
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(AppointmentBookingSchema), z.object({ nextCursor: z.string().nullable() })) },
      },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.appointmentBooking.findMany({
        where: { patientUserId: request.user!.id, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
        orderBy: { seq: "asc" },
        take: limit,
        include: WITH_BOOKING_RELATIONS,
      });

      return reply.send(ok(rows.map(toAppointmentBookingDto), buildPageMeta(rows, limit)));
    }
  );
}
