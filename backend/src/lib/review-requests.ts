import type { FastifyInstance } from "fastify";
import { REVIEW_REQUEST_DELAY_MS, REVIEW_REQUEST_MAX_AGE_MS, purgeReviewData, sendReviewInvite } from "../modules/reviews/reviews.service";

/**
 * Paket Y — "Deneyiminizi paylaşın": tamamlanmış görüşmeden 24 saat sonra hastaya tek kullanımlık,
 * 30 gün geçerli davet. `appointment-reminders.ts` deseni: önce SAHİPLENME (`reviewRequestedAt`
 * koşullu `updateMany`), sonra gönderim — çoklu örnek/tekrar turunda çift e-posta yok.
 * Booking başına en çok bir davet (`TestimonialInvite.bookingId` benzersiz). Yalnızca son 7 gün içinde
 * biten görüşmeler: yayına alındığı gün eski hastalara toplu e-posta gitmez.
 */
export const REVIEW_REQUEST_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const BATCH = 50;

export async function runReviewRequestSweep(app: FastifyInstance, now = new Date()): Promise<{ claimed: number; sent: number; failed: number }> {
  const dueBefore = new Date(now.getTime() - REVIEW_REQUEST_DELAY_MS);
  const notOlderThan = new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS);
  const candidates = await app.prisma.appointment.findMany({
    where: {
      status: "COMPLETED",
      reviewRequestedAt: null,
      bookingId: { not: null },
      booking: { archivedAt: null },
      OR: [{ endedAt: { lte: dueBefore, gte: notOlderThan } }, { endedAt: null, endsAt: { lte: dueBefore, gte: notOlderThan } }],
    },
    select: { id: true, bookingId: true },
    orderBy: { endsAt: "asc" },
    take: BATCH,
  });
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  for (const appointment of candidates) {
    const claim = await app.prisma.appointment.updateMany({ where: { id: appointment.id, reviewRequestedAt: null }, data: { reviewRequestedAt: now } });
    if (claim.count === 0) continue;
    claimed++;
    try {
      if (await sendReviewInvite(app, appointment.bookingId!, now)) sent++;
    } catch (err) {
      failed++;
      app.log.error({ err, appointmentId: appointment.id }, "Yorum daveti e-postası gönderilemedi");
    }
  }
  return { claimed, sent, failed };
}

export function registerReviewRequestSweeper(app: FastifyInstance): void {
  const runSweep = () => {
    runReviewRequestSweep(app)
      .then(async (result) => {
        if (result.claimed > 0) app.log.info(result, "Yorum daveti (review-requests) taraması tamamlandı");
        const purged = await purgeReviewData(app);
        if (purged.invites || purged.reviews) app.log.info(purged, "Yorum verisi saklama temizliği");
      })
      .catch((err) => app.log.error({ err }, "Yorum daveti (review-requests) taraması başarısız oldu"));
  };
  runSweep();
  const timer = setInterval(runSweep, REVIEW_REQUEST_SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}
