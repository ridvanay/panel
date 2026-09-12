/**
 * [TCT] §9.7.5 KARAR J madde 9 (ENGELLEYİCİ, compliance-agent onaylı) +
 * `.claude/compliance-notes-telehealth.md` "TUR 2" — sağlık verisi (şikâyet notu + tıbbi belge)
 * saklama süpürücüsü. `contact-retention.ts` iskeletiyle AYNI desen (gerçek zaman-tetiklemeli,
 * `setInterval`, kuyruk YOK).
 *
 * **Süre: booking'in TÜM randevu satırlarının `MAX(endsAt)`'inden itibaren 90 GÜN**
 * (compliance-agent'ın bağlayıcı netleştirmesi — çoklu slotta tek bir booking'in SON slotu
 * bitmeden temizlik BAŞLAMAZ). 12 aylık `Appointment.patientName`/`patientEmail`
 * anonimleştirme penceresinden (Tur 1) KASITLI OLARAK DAHA KISADIR — özel nitelikli veri daha
 * sıkı minimizasyon gerektirir.
 *
 * Hiç randevusu KALMAMIŞ (tüm satırları `booking-expiry.ts` tarafından hard-delete edilmiş,
 * yani booking hiç ödenmeden süresi dolmuş) bir booking'in beklenecek bir "son randevu"su
 * YOKTUR — bu durumda sağlık verisi BİR SONRAKİ turda hemen temizlenir (bilinçli karar: ödemesi
 * hiç tamamlanmamış/terk edilmiş bir booking'in sağlık verisini süresiz tutmanın KVKK
 * minimizasyonu açısından bir gerekçesi yoktur).
 *
 * Kadans: **günlük** (compliance-agent notu — saatlik/dakikalık kadans burada GEREKSİZ
 * sıklıktır, `booking-expiry.ts`'in 5 dakikalık kadansıyla KARIŞTIRILMAMALIDIR, farklı amaç).
 *
 * Silinen: `AppointmentDocument` (dosya DİSKTEN gerçekten silinir, satır `deletedAt` ile
 * işaretlenir — erişim denetim izi bütünlüğü için KALIR) ve `AppointmentIntake.noteCiphertext`
 * (`null`'lanır — rıza kanıtı `healthDataConsentAt`/`...Version` denetim bütünlüğü için KORUNUR).
 */
import type { FastifyInstance } from "fastify";
import { telehealthDocumentStorage } from "./telehealth-document-storage";

export const INTAKE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const INTAKE_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface IntakeRetentionSweepResult {
  redactedNotes: number;
  deletedDocuments: number;
}

/** Saklama süresi dolmuş booking id'lerini belirler — bkz. dosya üstü yorum (zero-appointment kuralı). */
async function findDueBookingIds(app: FastifyInstance, cutoff: Date): Promise<string[]> {
  const candidates = await app.prisma.appointmentBooking.findMany({
    where: {
      OR: [{ intake: { noteCiphertext: { not: null } } }, { documents: { some: { deletedAt: null } } }],
    },
    select: { id: true, appointments: { select: { endsAt: true } } },
  });

  return candidates
    .filter((booking) => {
      if (booking.appointments.length === 0) return true;
      const maxEndsAtMs = Math.max(...booking.appointments.map((a) => a.endsAt.getTime()));
      return maxEndsAtMs < cutoff.getTime();
    })
    .map((booking) => booking.id);
}

/** İDEMPOTENT'tir — zaten `null`/`deletedAt` dolu satırlarda no-op (bkz. `where` filtreleri). */
export async function runIntakeRetentionSweep(app: FastifyInstance): Promise<IntakeRetentionSweepResult> {
  const cutoff = new Date(Date.now() - INTAKE_RETENTION_MS);
  const dueBookingIds = await findDueBookingIds(app, cutoff);

  if (dueBookingIds.length === 0) {
    return { redactedNotes: 0, deletedDocuments: 0 };
  }

  const redacted = await app.prisma.appointmentIntake.updateMany({
    where: { bookingId: { in: dueBookingIds }, noteCiphertext: { not: null } },
    data: { noteCiphertext: null },
  });

  const dueDocuments = await app.prisma.appointmentDocument.findMany({
    where: { bookingId: { in: dueBookingIds }, deletedAt: null },
    select: { id: true, storagePath: true },
  });

  let deletedDocuments = 0;
  for (const document of dueDocuments) {
    await telehealthDocumentStorage.remove(document.storagePath);
    await app.prisma.appointmentDocument.updateMany({
      where: { id: document.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    deletedDocuments += 1;
  }

  return { redactedNotes: redacted.count, deletedDocuments };
}

/**
 * `contact-retention.ts::registerContactRetentionScheduler` İLE AYNI desen: açılışta HEMEN bir
 * kez çalışır, ardından her `INTAKE_RETENTION_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `onClose`
 * ile kendi interval'ini temizler.
 */
export function registerIntakeRetentionScheduler(app: FastifyInstance): void {
  const runSweep = () => {
    runIntakeRetentionSweep(app).catch((err) => {
      app.log.error({ err }, "Sağlık verisi (intake/belge) saklama süresi taraması başarısız oldu");
    });
  };

  runSweep();
  const timer = setInterval(runSweep, INTAKE_RETENTION_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
