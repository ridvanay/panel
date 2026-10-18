import type { AppointmentStatus, Prisma } from "@prisma/client";

/**
 * 2026-10-18 (Paket B2/B4) — arşiv filtrelerinin TEK kaynağı.
 *
 * Doktor arşivi (`DoctorProfile.archivedAt`): arşivleme `isActive=false` da yazar; public filtre
 * ikisini birlikte ister (derinlemesine savunma).
 *
 * Booking arşivi (`AppointmentBooking.archivedAt`): kazanç, analitik ve listelerden hariç tutulur.
 * BİLİNÇLİ OLARAK UYGULANMAYAN yerler: `/doctors/:slug/slots` dolu saatleri (arşivli booking'in
 * slotu dolu kalır — çakışma kontrolü kırmızı çizgideki `booking.ts`'te ve arşivi bilmez),
 * `booking-expiry`, `appointment-auto-close`, `intake-retention`, `recording-retention`, Stripe
 * webhook'u, fatura ve magic-link booking detayı.
 */
export const PUBLIC_DOCTOR_WHERE = { isActive: true, archivedAt: null } satisfies Prisma.DoctorProfileWhereInput;

/** Admin doktor listesinin varsayılan filtresi (`includeArchived=false`). */
export const NOT_ARCHIVED_DOCTOR_WHERE = { archivedAt: null } satisfies Prisma.DoctorProfileWhereInput;

export const NOT_ARCHIVED_BOOKING_WHERE = { archivedAt: null } satisfies Prisma.AppointmentBookingWhereInput;

/**
 * Booking'e bağlı OLMAYAN eski tekil randevular (`bookingId = null`) dahil kalır — `NOT` + ilişki
 * filtresi null ilişkide "eşleşmedi" sayılır, dolayısıyla NOT'u true olur.
 */
export const NOT_ARCHIVED_APPOINTMENT_WHERE = {
  NOT: { booking: { archivedAt: { not: null } } },
} satisfies Prisma.AppointmentWhereInput;

/** Hâlâ "yaşayan" randevu durumları — bunlardan biri varken arşivleme yapılmaz. */
export const OPEN_APPOINTMENT_STATUSES: AppointmentStatus[] = ["PENDING_PAYMENT", "SCHEDULED", "IN_PROGRESS"];

/**
 * Booking arşivlenebilir mi (architect kararı): açık durumda bir randevusu ya da gelecekte iptal
 * edilmemiş bir randevusu varsa HAYIR — aksi hâlde hastanın katılabildiği, hatırlatma e-postası
 * giden ama doktor konsolunda görünmeyen bir "hayalet" randevu oluşur.
 */
export function isBookingArchivable(appointments: readonly { status: AppointmentStatus; startsAt: Date }[], now: Date): boolean {
  return !appointments.some(
    (a) => OPEN_APPOINTMENT_STATUSES.includes(a.status) || (a.startsAt.getTime() > now.getTime() && a.status !== "CANCELLED")
  );
}

/** Doktorun "gelecekte aktif randevusu" — arşivlemeyi engeller (önce iptal/taşıma). */
export function upcomingDoctorAppointmentsWhere(doctorId: string, now: Date): Prisma.AppointmentWhereInput {
  return { doctorId, status: { in: OPEN_APPOINTMENT_STATUSES }, endsAt: { gt: now } };
}
