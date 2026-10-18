import type { AppointmentStatus, BookingPaymentStatus } from "@prisma/client";

/**
 * 2026-10-18 (Paket A1) — admin'in TEST randevularını kalıcı silebilmesi için uygunluk kuralı.
 * Saf fonksiyon: hem `GET .../deletion-check` hem `DELETE` (transaction içinde yeniden) aynı
 * kararı verir. Tıbbi kayıt saklama yükümlülüğü nedeniyle kural BİLİNÇLİ OLARAK dardır —
 * şüpheli her durum bir engel (blocker) üretir, silme yapılmaz.
 */
export type AppointmentDeletionBlockerCode =
  | "STATUS_NOT_FINAL"
  | "HAS_PAYMENT"
  | "HAS_CONSULTATION_NOTE"
  | "HAS_RECORDING"
  | "HAS_HEALTH_INTAKE"
  | "HAS_DOCUMENTS"
  | "CONSULTATION_HELD";

export interface AppointmentDeletionBlocker {
  code: AppointmentDeletionBlockerCode;
  message: string;
}

export interface AppointmentDeletionInput {
  status: AppointmentStatus;
  startedAt: Date | null;
  consultationNoteCiphertext: string | null;
  recording: { id: string } | null;
  booking: {
    paymentStatus: BookingPaymentStatus;
    paidAt: Date | null;
    paidBy: string | null;
    stripePaymentIntentId: string | null;
    intake: { id: string } | null;
    documentCount: number;
  } | null;
}

const DELETABLE_STATUSES: AppointmentStatus[] = ["CANCELLED", "COMPLETED"];

/** `demo` = geliştirme ortamı ödeme simülatörü (prod'da kapalı), gerçek tahsilat yoktur. */
function isDemoBooking(booking: NonNullable<AppointmentDeletionInput["booking"]>): boolean {
  return booking.paidBy === "demo";
}

/**
 * Ödeme kaydı = PAID/REFUNDED/FAILED durumu, `paidAt` ya da Stripe PaymentIntent. `paidBy: "free"`
 * (ücretsiz seans) de PAID yazıldığı için korunur — gerçek bir görüşmedir.
 */
function hasPaymentRecord(booking: NonNullable<AppointmentDeletionInput["booking"]>): boolean {
  if (isDemoBooking(booking)) return false;
  if (booking.paymentStatus === "PAID" || booking.paymentStatus === "REFUNDED" || booking.paymentStatus === "FAILED") return true;
  return booking.paidAt !== null || booking.stripePaymentIntentId !== null;
}

export function getAppointmentDeletionBlockers(input: AppointmentDeletionInput): AppointmentDeletionBlocker[] {
  const blockers: AppointmentDeletionBlocker[] = [];
  const { booking } = input;

  if (!DELETABLE_STATUSES.includes(input.status)) {
    blockers.push({ code: "STATUS_NOT_FINAL", message: "Yalnızca iptal edilmiş veya tamamlanmış randevular silinebilir." });
  }
  if (booking && hasPaymentRecord(booking)) {
    blockers.push({ code: "HAS_PAYMENT", message: "Randevunun ödeme kaydı var (ücretsiz seans dahil); mali kayıt silinemez." });
  }
  if (input.consultationNoteCiphertext) {
    blockers.push({ code: "HAS_CONSULTATION_NOTE", message: "Doktorun konsültasyon notu var; tıbbi kayıt silinemez." });
  }
  if (input.recording) {
    blockers.push({ code: "HAS_RECORDING", message: "Görüşme kaydı (recording) bulunuyor; silinemez." });
  }
  if (booking?.intake) {
    blockers.push({ code: "HAS_HEALTH_INTAKE", message: "Hastanın sağlık bilgisi formu var; silinemez." });
  }
  if (booking && booking.documentCount > 0) {
    blockers.push({ code: "HAS_DOCUMENTS", message: "Hastanın yüklediği belgeler var; silinemez." });
  }
  // Ödemesiz (eski tekil akış) ama gerçekten başlamış bir görüşme tıbbi kayıttır. Demo hariç.
  if (input.status === "COMPLETED" && input.startedAt !== null && !(booking && isDemoBooking(booking))) {
    blockers.push({ code: "CONSULTATION_HELD", message: "Görüşme gerçekten yapılmış; tıbbi kayıt saklama yükümlülüğü nedeniyle silinemez." });
  }

  return blockers;
}

/** `findUnique` `include`'u — `getAppointmentDeletionBlockers` girdisini üretmek için yeterli alanlar. */
export const APPOINTMENT_DELETION_INCLUDE = {
  recording: { select: { id: true } },
  booking: {
    select: {
      id: true,
      bookingNumber: true,
      paymentStatus: true,
      paidAt: true,
      paidBy: true,
      stripePaymentIntentId: true,
      intake: { select: { id: true } },
      // Soft-delete edilmiş belgeler de sayılır (denetim izi).
      _count: { select: { documents: true, appointments: true } },
    },
  },
} as const;

interface AppointmentWithDeletionRelations {
  status: AppointmentStatus;
  startedAt: Date | null;
  consultationNoteCiphertext: string | null;
  recording: { id: string } | null;
  booking: {
    paymentStatus: BookingPaymentStatus;
    paidAt: Date | null;
    paidBy: string | null;
    stripePaymentIntentId: string | null;
    intake: { id: string } | null;
    _count: { documents: number };
  } | null;
}

export function toDeletionInput(appointment: AppointmentWithDeletionRelations): AppointmentDeletionInput {
  const { booking } = appointment;
  return {
    status: appointment.status,
    startedAt: appointment.startedAt,
    consultationNoteCiphertext: appointment.consultationNoteCiphertext,
    recording: appointment.recording,
    booking: booking
      ? {
          paymentStatus: booking.paymentStatus,
          paidAt: booking.paidAt,
          paidBy: booking.paidBy,
          stripePaymentIntentId: booking.stripePaymentIntentId,
          intake: booking.intake,
          documentCount: booking._count.documents,
        }
      : null,
  };
}
