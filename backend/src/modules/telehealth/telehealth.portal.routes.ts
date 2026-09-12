import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, CursorQuerySchema } from "../../schemas/common";
import { AppointmentBookingSchema, DoctorPortalProfileSchema } from "../../schemas/entities";
import { toAppointmentBookingDto, toDoctorPortalProfileDto } from "../../mappers";
import { NotADoctorError, TwoFactorRequiredError } from "../../lib/errors";
import { buildPageMeta, parseCursor } from "../../lib/pagination";
import { DoctorBookingsQuerySchema } from "./telehealth.schemas";

const WITH_DOCTOR_RELATIONS = { specialty: true, avatarMedia: true, availability: true } as const;
const WITH_BOOKING_RELATIONS = {
  doctor: { select: { id: true, title: true, fullName: true, slug: true, userId: true } },
  appointments: true,
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
