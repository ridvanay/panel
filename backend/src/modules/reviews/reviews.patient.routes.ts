import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { assertSameSiteOrigin } from "../crm/crm.public.routes";
import { patientEmailLocale } from "../telehealth/lib/notifications";
import { ReviewSubmissionSchema, anonymizedTestimonialData, authorDisplayFor, isUniqueViolation } from "./reviews.service";
import { requireModuleEnabled } from "../../middleware/module-guard";

/**
 * Paket Y — hasta portalı: tamamlanmış randevunun altında yorum formu ve "Yorumumu sil".
 * Erişim YALNIZCA oturumdaki hastanın KENDİ booking'i (`patientUserId`): tercüman, doktor ve admin
 * bu uçlardan yorum göremez/yazamaz (kural kimlik eşleşmesi, rol değil).
 */
export async function reviewsPatientRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("onRequest", async (request) => {
    if (request.method === "POST" || request.method === "DELETE") assertSameSiteOrigin(request);
  });

  async function ownCompletedBooking(userId: string, bookingId: string) {
    const booking = await app.prisma.appointmentBooking.findFirst({
      where: { id: bookingId, patientUserId: userId, archivedAt: null },
      select: { id: true, patientName: true, locale: true, doctorId: true, doctor: { select: { specialtyId: true } }, appointments: { select: { status: true } } },
    });
    if (!booking) throw new NotFoundError("Randevu bulunamadı.");
    return booking;
  }

  /** Bu randevu için yorum durumu: yorum yazılabilir mi, yazıldıysa durumu. */
  server.get("/bookings/:bookingId/review", { schema: { params: z.object({ bookingId: z.string().uuid() }) } }, async (request, reply) => {
    const booking = await ownCompletedBooking(request.user!.id, request.params.bookingId);
    const any = await app.prisma.testimonial.findFirst({ where: { bookingId: booking.id }, select: { id: true, status: true, rating: true, title: true, createdAt: true, anonymizedAt: true } });
    const completed = booking.appointments.some((a) => a.status === "COMPLETED");
    // Silinmiş (anonimleştirilmiş) yorum gösterilmez ama aynı randevuya yeni yorum da açılmaz.
    const review = any && !any.anonymizedAt ? { id: any.id, status: any.status, rating: any.rating, title: any.title, createdAt: any.createdAt.toISOString() } : null;
    return reply.send(ok({ eligible: completed && !any, review }));
  });

  server.post(
    "/bookings/:bookingId/review",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { params: z.object({ bookingId: z.string().uuid() }), body: ReviewSubmissionSchema } },
    async (request, reply) => {
      const booking = await ownCompletedBooking(request.user!.id, request.params.bookingId);
      if (!booking.appointments.some((a) => a.status === "COMPLETED")) throw new ValidationError("Yorum yalnızca tamamlanmış görüşme için yazılabilir.", { bookingId: ["Görüşme tamamlanmadı."] });
      if (await app.prisma.testimonial.findFirst({ where: { bookingId: booking.id }, select: { id: true } })) throw new ConflictError("Bu randevu için zaten yorum gönderilmiş.");
      const now = new Date();
      const body = request.body;
      const created = await app.prisma
        .$transaction(async (tx) => {
        // E-postadaki davet artık kullanılamaz (aynı randevuya ikinci yorum yok).
        await tx.testimonialInvite.updateMany({ where: { bookingId: booking.id, usedAt: null }, data: { usedAt: now } });
        return tx.testimonial.create({
          data: {
            doctorId: booking.doctorId,
            specialtyId: booking.doctor.specialtyId,
            bookingId: booking.id,
            authorUserId: request.user!.id,
            authorDisplay: authorDisplayFor(booking.patientName, body.displayMode),
            displayMode: body.displayMode,
            country: body.country ?? null,
            consentTextVersion: body.consentTextVersion,
            language: patientEmailLocale(booking),
            rating: body.rating,
            title: body.title,
            body: body.body,
            source: "verified_booking",
            consentAt: now,
            status: "pending",
          },
        });
      })
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) throw new ConflictError("Bu randevu için zaten yorum gönderilmiş.");
          throw err;
        });
      return reply.status(201).send(ok({ id: created.id, status: created.status }));
    }
  );

  /** "Yorumumu sil": metin ve kimlik izleri silinir, yorum yayından kalkar (anonimleştirme). */
  server.delete("/reviews/:id", { schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.undefined() } } }, async (request, reply) => {
    const userId = request.user!.id;
    const row = await app.prisma.testimonial.findFirst({
      where: { id: request.params.id, anonymizedAt: null, OR: [{ authorUserId: userId }, { booking: { patientUserId: userId } }] },
      select: { id: true },
    });
    if (!row) throw new NotFoundError("Yorum bulunamadı.");
    await app.prisma.testimonial.update({ where: { id: row.id }, data: anonymizedTestimonialData(new Date()) });
    await logAudit(app, { actorId: userId, actorEmail: request.user!.email, action: "testimonial.deleted_by_patient", targetType: "Testimonial", targetId: row.id, ipAddress: request.ip });
    return reply.code(204).send();
  });
}
