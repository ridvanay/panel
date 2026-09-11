import type { CalendarDate } from "./timezone";
import { getWallClockParts, wallTimeToUtc } from "./timezone";

/**
 * `.claude/architect-scope-telehealth-template.md` §3.4/§4.2 — `DoctorAvailability` satırının
 * saf (DB'siz) temsili. `dayOfWeek` ISO-8601 (1 = Pazartesi … 7 = Pazar) — JS'in 0-6 (0 = Pazar)
 * konvansiyonu BİLİNÇLİ olarak KULLANILMAZ, dönüşüm TEK YERDE (bu dosyada) yapılır.
 */
export interface DoctorAvailabilityRule {
  dayOfWeek: number; // ISO 1-7
  startMinute: number; // gün başlangıcından itibaren dakika (0-1440), doktorun timeZone'unda
  endMinute: number;
  isActive: boolean;
}

export interface GeneratedSlot {
  startsAt: Date;
  endsAt: Date;
  available: boolean;
}

/**
 * §4.2 — "Geçmişteki ve şu andan itibaren 2 saatten yakın slotlar `available: false` döner
 * (rezervasyon tamponu; SABİT, ayar DEĞİL)."
 */
export const SLOT_BOOKING_BUFFER_MS = 2 * 60 * 60 * 1000;

/**
 * `"YYYY-MM-DD"` → `CalendarDate`. Girdi biçimi zaten route şemasında (`telehealth.schemas.ts::
 * DoctorSlotsQuerySchema`) bir regex ile zorlandığı için burada YENİDEN doğrulanmaz — yalnızca
 * ayrıştırır (`noUncheckedIndexedAccess` altında güvenli, dizi yıkımı yerine).
 */
export function parseIsoCalendarDate(value: string): CalendarDate {
  const [yearStr, monthStr, dayStr] = value.split("-");
  return { year: Number(yearStr), month: Number(monthStr), day: Number(dayStr) };
}

/** ISO-8601 (1=Pazartesi…7=Pazar) → JavaScript `Date.getUTCDay()` (0=Pazar…6=Cumartesi). */
export function jsDayFromIsoDayOfWeek(isoDayOfWeek: number): number {
  return isoDayOfWeek === 7 ? 0 : isoDayOfWeek;
}

/** JavaScript `Date.getUTCDay()` (0=Pazar…6=Cumartesi) → ISO-8601 (1=Pazartesi…7=Pazar). */
export function isoDayOfWeekFromJsDay(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/** `from`/`to` (dahil) arasındaki TAKVİM günlerini (doktorun kendi yerel takvimi) sırayla döner. */
function calendarDaysBetweenInclusive(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  const fromMillis = Date.UTC(from.year, from.month - 1, from.day);
  const toMillis = Date.UTC(to.year, to.month - 1, to.day);
  const days: CalendarDate[] = [];
  for (let millis = fromMillis; millis <= toMillis; millis += 86_400_000) {
    const d = new Date(millis);
    days.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }
  return days;
}

/** Bir takvim gününün ISO(1-7) haftanın günü — takvim aritmetiği zaman diliminden BAĞIMSIZDIR. */
function isoDayOfWeekOf(date: CalendarDate): number {
  const jsDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return isoDayOfWeekFromJsDay(jsDay);
}

export interface GenerateAvailableSlotsParams {
  timeZone: string;
  sessionDurationMin: number;
  rules: DoctorAvailabilityRule[];
  /** DAHİL, doktorun kendi yerel takvimindeki gün aralığı (sunucu/istemci diliminden BAĞIMSIZ). */
  fromDate: CalendarDate;
  toDate: CalendarDate;
  now: Date;
  /** Zaten rezerve edilmiş `Appointment.startsAt` anlarının epoch-ms kümesi. */
  bookedStartTimesMs: ReadonlySet<number>;
}

/**
 * §4.2 — SAF slot üretim fonksiyonu (DB erişimi YOK, tamamen test edilebilir). Haftalık
 * tekrarlayan kurallardan + verilen tarih aralığından somut, MUTLAK (UTC) slotlar türetir.
 *
 * DST kuralı (bağlayıcı): var olmayan bir duvar saati (ilkbahar geçişi) hiç ÜRETİLMEZ; çift
 * geçen bir duvar saati (sonbahar geçişi) yalnızca BİR KEZ (ilk/DST'li örnek) üretilir — bu
 * davranış `lib/timezone.ts::wallTimeToUtc`'nin kendisinden miras alınır (bkz. o dosyanın
 * yorumu), burada ayrıca bir dedupe/özel durum GEREKMEZ.
 */
export function generateAvailableSlots(params: GenerateAvailableSlotsParams): GeneratedSlot[] {
  const { timeZone, sessionDurationMin, rules, fromDate, toDate, now, bookedStartTimesMs } = params;

  const rulesByIsoDay = new Map<number, DoctorAvailabilityRule[]>();
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const list = rulesByIsoDay.get(rule.dayOfWeek);
    if (list) list.push(rule);
    else rulesByIsoDay.set(rule.dayOfWeek, [rule]);
  }

  const slots: GeneratedSlot[] = [];
  const bookingCutoffMs = now.getTime() + SLOT_BOOKING_BUFFER_MS;

  for (const day of calendarDaysBetweenInclusive(fromDate, toDate)) {
    const dayRules = rulesByIsoDay.get(isoDayOfWeekOf(day));
    if (!dayRules) continue;

    for (const rule of dayRules) {
      for (let minute = rule.startMinute; minute + sessionDurationMin <= rule.endMinute; minute += sessionDurationMin) {
        const startsAt = wallTimeToUtc(
          { year: day.year, month: day.month, day: day.day, hour: Math.floor(minute / 60), minute: minute % 60 },
          timeZone
        );
        // Var olmayan duvar saati (DST ilkbahar boşluğu) — bu slot hiç üretilmez.
        if (!startsAt) continue;

        const endsAt = new Date(startsAt.getTime() + sessionDurationMin * 60_000);
        const isTooSoonOrPast = startsAt.getTime() < bookingCutoffMs;
        const isBooked = bookedStartTimesMs.has(startsAt.getTime());

        slots.push({ startsAt, endsAt, available: !isTooSoonOrPast && !isBooked });
      }
    }
  }

  slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return slots;
}

/**
 * §4.3 madde 2 — "istenen `startsAt` gerçekten bir slot mu?" doğrulaması. Yapısal (haftalık
 * kurallara uyuyor mu, DST'de gerçekten var mı) VE zamanlama (rezervasyon tamponu) kontrolünü
 * BİRLİKTE yapar; DOLULUK kontrolü (başka bir randevu tarafından alınmış mı) BURAYA DAHİL
 * DEĞİLDİR — o, `lib/booking.ts`'te AYRI bir DB sorgusu + `@@unique` ikinci savunma hattıdır.
 */
export function isBookableSlotStart(
  startsAt: Date,
  params: Pick<GenerateAvailableSlotsParams, "timeZone" | "sessionDurationMin" | "rules" | "now">
): boolean {
  const day = getWallClockParts(startsAt, params.timeZone);
  const calendarDay: CalendarDate = { year: day.year, month: day.month, day: day.day };

  const slots = generateAvailableSlots({
    ...params,
    fromDate: calendarDay,
    toDate: calendarDay,
    bookedStartTimesMs: new Set(),
  });

  return slots.some((slot) => slot.startsAt.getTime() === startsAt.getTime() && slot.available);
}
