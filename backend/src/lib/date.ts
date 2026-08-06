/** PageView günlük bucket'ı için: verilen tarihin (varsayılan: şimdi) UTC gece yarısı. */
export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(date.toISOString().slice(0, 10));
}

/** UTC gece yarısına yuvarlanmış bir tarihe gün ekler/çıkarır (negatif `days` geçmişe gider). */
export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** "YYYY-MM-DD" — günlük seri anahtarı olarak kullanılır. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** §10.8.10 haftalık bucket başlangıcı — Pazartesi (ISO 8601), Postgres `date_trunc('week', ...)` ile TUTARLI. */
export function startOfUtcWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay(); // 0=Pazar..6=Cumartesi
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addUtcDays(day, diffToMonday);
}

/** §10.8.10 aylık bucket başlangıcı — ayın 1'i (UTC). */
export function startOfUtcMonth(date: Date): Date {
  const day = startOfUtcDay(date);
  day.setUTCDate(1);
  return day;
}

export type StatsGranularity = "day" | "week" | "month";

/** §10.8.10 — zaman serisi noktalarını granularity'ye göre bucket anahtarına indirger. */
export function bucketDateKey(date: Date, granularity: StatsGranularity): string {
  switch (granularity) {
    case "week":
      return toDateKey(startOfUtcWeek(date));
    case "month":
      return toDateKey(startOfUtcMonth(date));
    default:
      return toDateKey(date);
  }
}
