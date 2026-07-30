/** PageView günlük bucket'ı için: bugünün UTC gece yarısı. */
export function startOfUtcDay(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
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
