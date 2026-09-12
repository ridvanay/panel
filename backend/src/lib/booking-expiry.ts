/**
 * [TCT] §9.7.3 KARAR I (bağlayıcı) — `PENDING_PAYMENT` yaşam döngüsü süpürücüsü.
 * `cart-retention.ts` iskeletiyle AYNI desen (süreç-içi `setInterval`, kuyruk/cron YOK).
 *
 * Süre dolumu: `AppointmentBooking.expiresAt < now` VE `paymentStatus === "PENDING"` olan
 * booking'lerde — `PENDING_PAYMENT` randevu satırları HARD DELETE edilir (slot serbest kalır,
 * `@@unique([doctorId, startsAt])` bir daha aynı saati bloklamaz) ve booking
 * `paymentStatus = "EXPIRED"` olur. **Ödenmiş/`SCHEDULED` bir randevunun iptalinde §4.3 AYNEN
 * GEÇERLİDİR** — bu süpürücü YALNIZCA hiç ödenmemiş, henüz onaylanmamış satırları hedefler;
 * hiçbir zaman `SCHEDULED`/`COMPLETED`/`CANCELLED` bir randevuya DOKUNMAZ.
 *
 * Kadans: **5 dakika** (`contact-retention.ts`'in saatlik kadansı burada UYGUN DEĞİLDİR —
 * tutulan bir slotun 55 dakika boşa gitmesi, klinik randevu arzını gereksiz kısıtlar).
 */
import type { FastifyInstance } from "fastify";

export const BOOKING_EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface BookingExpirySweepResult {
  expiredBookings: number;
  deletedAppointments: number;
}

/**
 * İDEMPOTENT'tir — her booking için `updateMany({ where: { paymentStatus: "PENDING" }})` şartı
 * zaten işlenmiş (`EXPIRED`'a geçmiş) satırlarda no-op üretir; iki eşzamanlı sweep turu
 * (teorik, tek-instance varsayımıyla pratikte olmaz) birbirini ikiye katlamaz.
 */
export async function runBookingExpirySweep(app: FastifyInstance): Promise<BookingExpirySweepResult> {
  const now = new Date();
  const expiredBookings = await app.prisma.appointmentBooking.findMany({
    where: { paymentStatus: "PENDING", expiresAt: { lt: now } },
    select: { id: true },
  });

  let deletedAppointments = 0;
  for (const booking of expiredBookings) {
    // Her booking KENDİ transaction'ında — hard-delete + durum geçişi atomik olmalı (aksi
    // hâlde satırlar silinip booking hâlâ "PENDING" kalabilir, bir sonraki turda tekrar
    // silme denemesi zararsız olsa da booking sonsuza dek "PENDING" görünürdü).
    const deletedCount = await app.prisma.$transaction(async (tx) => {
      const deleted = await tx.appointment.deleteMany({ where: { bookingId: booking.id, status: "PENDING_PAYMENT" } });
      await tx.appointmentBooking.updateMany({
        where: { id: booking.id, paymentStatus: "PENDING" },
        data: { paymentStatus: "EXPIRED" },
      });
      return deleted.count;
    });
    deletedAppointments += deletedCount;
  }

  return { expiredBookings: expiredBookings.length, deletedAppointments };
}

/**
 * `cart-retention.ts::registerCartRetentionSweeper` İLE AYNI desen: açılışta HEMEN bir kez
 * çalışır, ardından her `BOOKING_EXPIRY_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `onClose` ile
 * kendi interval'ini temizler (test/process temizliği).
 */
export function registerBookingExpirySweeper(app: FastifyInstance): void {
  const runSweep = () => {
    runBookingExpirySweep(app).catch((err) => {
      app.log.error({ err }, "Randevu rezervasyonu süre dolumu (booking-expiry) taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, BOOKING_EXPIRY_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
