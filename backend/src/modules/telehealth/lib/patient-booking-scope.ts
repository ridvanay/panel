import type { Prisma } from "@prisma/client";

/**
 * `.claude/architect-scope-telehealth-template.md` [KHP] §9.8.4 KARAR O (bağlayıcı) —
 * `telehealth.portal.routes.ts::telehealthPatientPortalRoutes::GET /bookings` içinden ÇIKARILAN,
 * SAF (DB'ye dokunmayan) where-clause üretimi. `lib/doctor-booking-scope.ts` İLE AYNI İSİM/YAPI
 * deseni izlenir, ama hastanın bakış açısına göre semantik KASITLI OLARAK FARKLIDIR — doktor
 * yardımcısı BU DOSYADAN ÇAĞRILMAZ/DEĞİŞTİRİLMEZ, ikisi TAMAMEN AYRI kaynaklardır.
 */
export type PatientBookingScope = "all" | "upcoming" | "past" | "cancelled";

/**
 * `scope=upcoming` (UI: "Aktif") — gelecekte `SCHEDULED`/`IN_PROGRESS` randevusu olan **VEYA**
 * `paymentStatus === "PENDING"` olup gelecekte `PENDING_PAYMENT` randevusu olan booking.
 * Doktor tarafındaki `upcoming` (bkz. `lib/doctor-booking-scope.ts`) ödenmemiş tutmaları BİLİNÇLİ
 * OLARAK SAYMAZ; hasta tarafında ödenmemiş bir rezervasyon "Ödemeyi tamamla" eylemi gerektiren
 * AKTİF bir kayıttır, bu yüzden burada DAHİLDİR (§9.8.4 gerekçe maddesi).
 */
function buildUpcomingFilter(now: Date): Prisma.AppointmentBookingWhereInput {
  return {
    OR: [
      { appointments: { some: { startsAt: { gt: now }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } } } },
      {
        paymentStatus: "PENDING",
        appointments: { some: { startsAt: { gt: now }, status: "PENDING_PAYMENT" } },
      },
    ],
  };
}

/**
 * `scope=cancelled` (UI: "İptal") — `CANCELLED` randevusu olan **VEYA** `paymentStatus` ∈
 * {`EXPIRED`, `REFUNDED`} olan **VEYA** hiç randevu satırı kalmamış ("hayalet") booking. Süresi
 * dolan/ödenmeden iptal edilen booking'lerin randevu satırları HARD DELETE edildiği için (bkz.
 * `lib/doctor-booking-scope.ts` kök neden notu) bu kayıtlar YALNIZCA bu sekmede görünür — bu,
 * hasta tarafının `cancelled` sekmesinin "hayalet" booking'lerin GÖRÜNEBİLDİĞİ TEK sekme olmasının
 * kaynağıdır.
 */
function buildCancelledFilter(): Prisma.AppointmentBookingWhereInput {
  return {
    OR: [
      { appointments: { some: { status: "CANCELLED" } } },
      { paymentStatus: { in: ["EXPIRED", "REFUNDED"] } },
      { appointments: { none: {} } },
    ],
  };
}

/**
 * `scope=past` (UI: "Geçmiş") — `endsAt <= now` olan en az bir randevusu
 * (`COMPLETED`/`NO_SHOW`/`SCHEDULED`/`IN_PROGRESS`) bulunan ve `upcoming` ile eşleşMEYEN booking.
 * `SCHEDULED` BİLİNÇLİ OLARAK dahildir: doktorun "Seansı Tamamla" demediği geçmişte kalmış bir
 * randevu hiçbir sekmede KAYBOLMAMALIDIR (kaybolma regresyonu, §9.8.7 test 30).
 */
function buildPastFilter(now: Date): Prisma.AppointmentBookingWhereInput {
  return {
    AND: [
      {
        appointments: {
          some: { endsAt: { lte: now }, status: { in: ["COMPLETED", "NO_SHOW", "SCHEDULED", "IN_PROGRESS"] } },
        },
      },
      { NOT: buildUpcomingFilter(now) },
    ],
  };
}

/**
 * `scope=all` (varsayılan) `undefined` döner — mevcut filtresiz davranış KORUNUR (hayalet
 * booking'ler DAHİL, geriye dönük uyumluluk).
 */
export function buildPatientBookingScopeFilter(
  scope: PatientBookingScope | undefined,
  ctx: { now: Date }
): Prisma.AppointmentBookingWhereInput | undefined {
  if (scope === "upcoming") return buildUpcomingFilter(ctx.now);
  if (scope === "past") return buildPastFilter(ctx.now);
  if (scope === "cancelled") return buildCancelledFilter();
  return undefined;
}

/**
 * `meta.counts` (`PatientBookingCounts`) — 4 sekmenin TAMAMININ sayısı, istek `scope`'undan
 * BAĞIMSIZ (`lib/content-counts.ts`teki `ContentCounts` disipliniyle AYNI ilke). `all` diğer
 * üçünün toplamı DEĞİLDİR: bir booking birden fazla sekmeye düşebilir (ör. `past` + `cancelled`).
 */
export function buildPatientBookingScopeCountFilters(now: Date): Record<PatientBookingScope, Prisma.AppointmentBookingWhereInput> {
  return {
    all: {},
    upcoming: buildUpcomingFilter(now),
    past: buildPastFilter(now),
    cancelled: buildCancelledFilter(),
  };
}
