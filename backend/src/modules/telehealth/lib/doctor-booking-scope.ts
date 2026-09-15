import type { Prisma } from "@prisma/client";
import { addCalendarDays, getStartOfCalendarDayInTimeZone, getStartOfDayInTimeZone, getWallClockParts } from "./timezone";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 2 §2.3 (bağlayıcı) —
 * `telehealth.portal.routes.ts::GET /bookings?scope=...` (satır ~187-205) içinden ÇIKARILAN, SAF
 * (DB'ye dokunmayan) where-clause üretimi. Hem `GET /doctor/bookings` HEM DE `GET /doctor/overview`
 * (yeni `upcomingBookingTotal`/`allBookingTotal` sayaçları) BU TEK kaynağı kullanır — kod tekrarı
 * YASAK. `/bookings`'in gözlemlenebilir davranışı bu refactor ile SIFIR değişir.
 *
 * §2.1 (bağlayıcı) — `scope=upcoming`'in `PENDING_PAYMENT` randevuları HARİÇ tutması KASITLI ve
 * DOĞRU davranıştır (ödenmemiş tutma "gelecek onaylı randevu" DEĞİLDİR); bu turda DEĞİŞTİRİLMEZ.
 */
export type DoctorBookingScope = "today" | "upcoming" | "completed";

/**
 * `scope === "today"` doktorun KENDİ `timeZone`'unda (duvar saati) hesaplanır — bu yüzden `timeZone`
 * bu durumda ZORUNLUDUR. Diğer scope'lar (`upcoming`/`completed`) saat dilimi bilmez; `timeZone`
 * parametresi o dallarda yok sayılır.
 */
export function buildDoctorBookingScopeFilter(
  scope: DoctorBookingScope | undefined,
  ctx: { timeZone?: string; now: Date }
): Prisma.AppointmentBookingWhereInput | undefined {
  if (scope === "today") {
    if (!ctx.timeZone) {
      throw new Error("buildDoctorBookingScopeFilter: scope='today' için `timeZone` zorunludur.");
    }
    const wallToday = getWallClockParts(ctx.now, ctx.timeZone);
    const todayStart = getStartOfDayInTimeZone(ctx.now, ctx.timeZone);
    const tomorrowCalendar = addCalendarDays({ year: wallToday.year, month: wallToday.month, day: wallToday.day }, 1);
    const tomorrowStart = getStartOfCalendarDayInTimeZone(tomorrowCalendar, ctx.timeZone);
    return {
      appointments: { some: { startsAt: { gte: todayStart, lt: tomorrowStart }, status: { not: "PENDING_PAYMENT" } } },
    };
  }
  if (scope === "upcoming") {
    return { appointments: { some: { startsAt: { gt: ctx.now }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } } };
  }
  if (scope === "completed") {
    return { appointments: { some: { status: "COMPLETED" } } };
  }
  return undefined;
}

/**
 * Kök neden notu (2026-09-14 araştırması, `telehealth.portal.routes.ts`'ten TAŞINDI) — `PENDING`
 * bir booking süresi dolduğunda (`booking-expiry.ts::runBookingExpirySweep`) VEYA hasta hiç
 * ödemeden iptal ettiğinde, o booking'in TÜM `PENDING_PAYMENT` randevu satırları HARD DELETE
 * edilir ve booking `paymentStatus = "EXPIRED"` olarak KALICI şekilde DB'de yaşamaya devam eder —
 * sıfır `appointments` ile. Bu "hayalet" booking'leri dışlayan filtre: `/bookings`'in varsayılan
 * `scope=all` davranışı VE `/doctor/overview`'in `allBookingTotal` sayacı BUNU kullanır.
 */
export const BOOKINGS_WITH_APPOINTMENTS_FILTER = { appointments: { some: {} } } satisfies Prisma.AppointmentBookingWhereInput;
