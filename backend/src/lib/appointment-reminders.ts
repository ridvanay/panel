/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §2.1/§2.3 (bağlayıcı) — 1 saat / 30
 * dakika randevu hatırlatma e-postaları süpürücüsü. `lib/booking-expiry.ts` iskeletiyle BİREBİR
 * AYNI desen (süreç-içi `setInterval`, kuyruk/cron YOK, `timer.unref()`, `onClose`'da
 * `clearInterval`).
 *
 * **Bantlar (bağlayıcı, çift gönderim engeli — alt sınır ZORUNLU):**
 * - 60 dk: `reminded60mAt IS NULL` AND `startsAt ∈ (now + 35dk, now + 65dk]`
 * - 30 dk: `reminded30mAt IS NULL` AND `startsAt ∈ (now + 5dk, now + 35dk]`
 *
 * **Uygunluk yüklemi (§2.3, `meeting-token` ucuyla BİLEREK AYNI):**
 * `status === "SCHEDULED" AND (bookingId IS NULL OR booking.paymentStatus === "PAID")`.
 *
 * **Claim-first (§2.3, bağlayıcı):** damga gönderimden ÖNCE koşullu `updateMany` ile basılır
 * (`count === 1` ise gönder) — DB seviyesinde tek bir satır kilidiyle yarış çözülür, çok-instance
 * ortamda da güvenlidir. SMTP hatasında damga BASILI KALIR (bilinçli tercih — bir hatırlatmanın
 * KAYBOLMASI, İKİ KEZ gitmesinden iyidir), hata `app.log.error` ile loglanır (sessiz başarısızlık
 * YOK, bkz. `modules/telehealth/lib/notifications.ts::triggerAppointmentReminderEmail`).
 *
 * **Çoklu slot bastırması (§2.3, bağlayıcı):** bir randevu iddia edildiğinde, AYNI booking'in,
 * iddia edilen randevudan SONRAKİ 90 dakika içinde başlayan diğer randevuları da AYNI mantıkla
 * damgalanır — ama onlar için e-posta GÖNDERİLMEZ.
 */
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { triggerAppointmentReminderEmail } from "../modules/telehealth/lib/notifications";

export const APPOINTMENT_REMINDER_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type ReminderKind = "60m" | "30m";
type ReminderField = "reminded60mAt" | "reminded30mAt";

interface BandConfig {
  field: ReminderField;
  /** Dakika, EXCLUSIVE alt sınır. */
  lowerMinutes: number;
  /** Dakika, INCLUSIVE üst sınır. */
  upperMinutes: number;
}

const BANDS: Record<ReminderKind, BandConfig> = {
  "60m": { field: "reminded60mAt", lowerMinutes: 35, upperMinutes: 65 },
  "30m": { field: "reminded30mAt", lowerMinutes: 5, upperMinutes: 35 },
};

/** §2.3 — bir randevu iddia edildiğinde, aynı booking'in bu pencere içinde başlayan diğer slotları bastırılır. */
const MULTI_SLOT_SUPPRESSION_MS = 90 * 60 * 1000;

export interface AppointmentReminderSweepResult {
  reminded60m: number;
  reminded30m: number;
  failed: number;
}

const WITH_DOCTOR_AND_BOOKING = {
  doctor: { select: { timeZone: true, title: true, fullName: true, userId: true } },
  booking: { select: { paymentStatus: true } },
} as const;

/**
 * Prisma'nın üretilen `AppointmentWhereInput`/`...UpdateManyMutationInput` tipleri STATİK
 * alan adları bekler — `[band.field]: value` gibi bir hesaplanmış anahtar TypeScript'te bir
 * index signature'a düşer ve derleme zamanı alan-adı güvenliğini kaybettirir. Bu yüzden İKİ
 * dal AÇIKÇA yazılır (kod tekrarı KABUL EDİLİR, tip güvenliği KORUNUR).
 */
function reminderFieldFilter(field: ReminderField, value: Date | null): Prisma.AppointmentWhereInput {
  return field === "reminded60mAt" ? { reminded60mAt: value } : { reminded30mAt: value };
}
function reminderFieldUpdate(field: ReminderField, value: Date): Prisma.AppointmentUpdateManyMutationInput {
  return field === "reminded60mAt" ? { reminded60mAt: value } : { reminded30mAt: value };
}

async function processKind(app: FastifyInstance, kind: ReminderKind, now: Date): Promise<{ sent: number; failed: number }> {
  const band = BANDS[kind];
  const lowerBound = new Date(now.getTime() + band.lowerMinutes * 60_000);
  const upperBound = new Date(now.getTime() + band.upperMinutes * 60_000);

  const candidates = await app.prisma.appointment.findMany({
    where: {
      status: "SCHEDULED",
      ...reminderFieldFilter(band.field, null),
      startsAt: { gt: lowerBound, lte: upperBound },
    },
    include: WITH_DOCTOR_AND_BOOKING,
  });

  let sent = 0;
  let failed = 0;
  // Bir sonraki iterasyonda, bir önceki iterasyonun çoklu-slot bastırmasıyla ZATEN damgaladığı
  // bir randevuyu tekrar İŞLEMEMEK için (aynı `candidates` dizisinde olabilir).
  const handled = new Set<string>();

  for (const appointment of candidates) {
    if (handled.has(appointment.id)) continue;

    const isEligible = appointment.bookingId === null || appointment.booking?.paymentStatus === "PAID";
    if (!isEligible) continue;

    const claim = await app.prisma.appointment.updateMany({
      where: { id: appointment.id, ...reminderFieldFilter(band.field, null) },
      data: reminderFieldUpdate(band.field, now),
    });
    if (claim.count !== 1) continue;
    handled.add(appointment.id);

    if (appointment.bookingId) {
      const suppressUpperBound = new Date(appointment.startsAt.getTime() + MULTI_SLOT_SUPPRESSION_MS);
      const siblings = await app.prisma.appointment.findMany({
        where: {
          bookingId: appointment.bookingId,
          id: { not: appointment.id },
          status: "SCHEDULED",
          ...reminderFieldFilter(band.field, null),
          startsAt: { gt: appointment.startsAt, lte: suppressUpperBound },
        },
        select: { id: true },
      });
      if (siblings.length > 0) {
        await app.prisma.appointment.updateMany({
          where: { id: { in: siblings.map((s) => s.id) }, ...reminderFieldFilter(band.field, null) },
          data: reminderFieldUpdate(band.field, now),
        });
        for (const sibling of siblings) handled.add(sibling.id);
      }
    }

    const success = await triggerAppointmentReminderEmail(app, {
      appointment,
      doctorTimeZone: appointment.doctor.timeZone,
      doctorTitle: appointment.doctor.title,
      doctorFullName: appointment.doctor.fullName,
      doctorUserId: appointment.doctor.userId,
      kind,
    });
    if (success) sent += 1;
    else failed += 1;
  }

  return { sent, failed };
}

/**
 * İDEMPOTENT'tir — claim-first (`updateMany({ where: { ..., [field]: null } })`) zaten
 * damgalanmış satırlarda no-op üretir; ikinci bir tur (veya iki eşzamanlı instance) aynı
 * randevu için e-posta ÜRETMEZ.
 */
export async function runAppointmentReminderSweep(app: FastifyInstance): Promise<AppointmentReminderSweepResult> {
  const now = new Date();
  const sixty = await processKind(app, "60m", now);
  const thirty = await processKind(app, "30m", now);
  return { reminded60m: sixty.sent, reminded30m: thirty.sent, failed: sixty.failed + thirty.failed };
}

/**
 * `booking-expiry.ts::registerBookingExpirySweeper` İLE AYNI desen: açılışta HEMEN bir kez
 * çalışır, ardından her `APPOINTMENT_REMINDER_SWEEP_INTERVAL_MS`'de bir tekrarlanır. `onClose`
 * ile kendi interval'ini temizler. Tur başına `{reminded60m, reminded30m, failed}` sayaçları
 * loglanır (observability-agent'ın izleyeceği metrik adayı).
 */
export function registerAppointmentReminderSweeper(app: FastifyInstance): void {
  const runSweep = () => {
    runAppointmentReminderSweep(app)
      .then((result) => {
        app.log.info(result, "Randevu hatırlatma (appointment-reminders) taraması tamamlandı");
      })
      .catch((err) => {
        app.log.error({ err }, "Randevu hatırlatma (appointment-reminders) taraması başarısız oldu");
      });
  };

  runSweep();
  const timer = setInterval(runSweep, APPOINTMENT_REMINDER_SWEEP_INTERVAL_MS);
  timer.unref();

  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
