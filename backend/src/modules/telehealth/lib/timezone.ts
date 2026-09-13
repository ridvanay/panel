/**
 * `.claude/architect-scope-telehealth-template.md` §4.2 (bağlayıcı, TEK bağlayıcı cümle):
 * "Tekrarlayan müsaitlik DUVAR SAATİDİR (doktorun IANA diliminde); randevu ANDIR (UTC
 * timestamptz). Dönüşüm TEK yerde, bu dosyada yapılır ve API sınırından DIŞARIYA yalnızca
 * ISO-8601 `Z`'li ANLAR çıkar."
 *
 * YENİ BAĞIMLILIK YOK (luxon/date-fns-tz/moment-timezone EKLENMEZ) — Node 20 tam ICU ile gelir;
 * `Intl.DateTimeFormat(…, { timeZone })` ile duvar saati ↔ an dönüşümü burada elle yapılır.
 */

/** Bir anın, verilen IANA diliminde DUVAR SAATİ karşılığı. */
export interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
}

/** Yalnızca takvim günü (saat/dakika YOK) — slot üretiminde gün sınırı iterasyonu için. */
export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PARTS_FORMATTER_CACHE.get(timeZone);
  if (!formatter) {
    // `hourCycle: "h23"` — bazı eski V8 sürümlerinde "24:00" üretme hatası bilinen bir tuzaktır
    // (Node 20 bunu düzeltir); aşağıda `hour === 24` için YİNE DE bir güvenlik ağı var.
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS_FORMATTER_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

/** Verilen ANIN, `timeZone`'daki duvar saati karşılığını döner. Geçersiz IANA kimliği → throw (Intl'in kendi hatası). */
export function getWallClockParts(instant: Date, timeZone: string): WallClockParts {
  const parts = getPartsFormatter(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  let hour = Number(map.hour);
  // Bkz. yukarıdaki yorum — "24:00" üretilirse 0'a normalize edilir (savunma amaçlı).
  if (hour === 24) hour = 0;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
  };
}

/** `instant`'ın `timeZone`'daki UTC ofsetini DAKİKA cinsinden döner (local - utc). Doğuda pozitif (ör. Europe/Istanbul → +180). */
function getOffsetMinutesAt(instant: Date, timeZone: string): number {
  const wall = getWallClockParts(instant, timeZone);
  const wallAsUtcMillis = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  return (wallAsUtcMillis - instant.getTime()) / 60000;
}

/**
 * DUVAR SAATİNİ (bir IANA diliminde) MUTLAK ANA çevirir. DST tuzağı (bağlayıcı kural, §4.2):
 * - Var OLMAYAN bir duvar saati (ilkbahar geçişindeki boşluk, ör. 02:30) için `null` döner —
 *   çağıran taraf bu slotu ÜRETMEMELİDİR.
 * - ÇİFT geçen bir duvar saati (sonbahar geçişi, ör. 01:30 iki kez yaşanır) için İLK (DST'li,
 *   yani kronolojik olarak daha ERKEN) örneği döner.
 *
 * Algoritma: wall clock'u önce "sanki UTC'ymiş gibi" bir an olarak ele alıp o andaki ofseti
 * okur, sonra o ofsetle gerçek adayı hesaplar; sonucu yeniden formatlayıp istenen duvar saatiyle
 * round-trip doğrulaması yapar (uyuşmuyorsa an mevcut değildir → `null`).
 */
/**
 * `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §3.1 — `GET
 * /doctor/overview`'un "Bugün" kartı için doktorun kendi `timeZone`'unun DUVAR SAATİNDEKİ takvim
 * gününün (00:00) UTC karşılığı. `wallTimeToUtc`'in "var olmayan duvar saati" (DST ilkbahar
 * geçişi) davranışına uyumlu savunma: tam 00:00 nadiren mevcut olmayabilir (bazı bölgeler gece
 * yarısı geçiş yapar) — bu durumda o günün İLK var olan duvar saati dakikası kullanılır.
 */
export function getStartOfCalendarDayInTimeZone(date: CalendarDate, timeZone: string): Date {
  for (let minute = 0; minute < 180; minute++) {
    const candidate = wallTimeToUtc(
      { year: date.year, month: date.month, day: date.day, hour: Math.floor(minute / 60), minute: minute % 60 },
      timeZone
    );
    if (candidate) return candidate;
  }
  throw new Error(`"${timeZone}" için ${date.year}-${date.month}-${date.day} gün başlangıcı hesaplanamadı.`);
}

/** Bir ANIN `timeZone`'daki duvar takvim gününün BAŞLANGICI (00:00) — `getStartOfCalendarDayInTimeZone`'un ANDAN türetilmiş kısayolu. */
export function getStartOfDayInTimeZone(instant: Date, timeZone: string): Date {
  const wall = getWallClockParts(instant, timeZone);
  return getStartOfCalendarDayInTimeZone({ year: wall.year, month: wall.month, day: wall.day }, timeZone);
}

/** Takvim aritmetiği (zaman diliminden BAĞIMSIZ) — `days` gün ekler/çıkarır. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** `CalendarDate`/`WallClockParts` → `YYYY-MM-DD`. */
export function formatCalendarDateKey(date: Pick<CalendarDate, "year" | "month" | "day">): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function wallTimeToUtc(wall: WallClockParts, timeZone: string): Date | null {
  const guessMillis = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);

  const offsetAtGuess = getOffsetMinutesAt(new Date(guessMillis), timeZone);
  let candidateMillis = guessMillis - offsetAtGuess * 60000;

  const offsetAtCandidate = getOffsetMinutesAt(new Date(candidateMillis), timeZone);
  if (offsetAtCandidate !== offsetAtGuess) {
    candidateMillis = guessMillis - offsetAtCandidate * 60000;
  }

  const roundTrip = getWallClockParts(new Date(candidateMillis), timeZone);
  const matches =
    roundTrip.year === wall.year &&
    roundTrip.month === wall.month &&
    roundTrip.day === wall.day &&
    roundTrip.hour === wall.hour &&
    roundTrip.minute === wall.minute;

  return matches ? new Date(candidateMillis) : null;
}
