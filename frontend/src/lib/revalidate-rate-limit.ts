/** `POST /api/revalidate` için süreç içi sayaç (bkz. `app/api/revalidate/route.ts`). */

/**
 * Süreç içi dakikalık tavan (security-agent koşulu) — sır sızsa bile sınırsız `revalidateTag`/
 * `revalidatePath` çağrısıyla ISR fırtınası üretilemesin. Admin toplu işlemleri bunun çok altında kalır.
 */
export const REVALIDATE_MAX_PER_MINUTE = 120;
let windowStart = 0;
let windowCount = 0;

export function allowRevalidateRequest(now: number): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= REVALIDATE_MAX_PER_MINUTE;
}

/** Testler için — süreç içi sayacı sıfırlar. */
export function resetRevalidateRateLimitForTests(): void {
  windowStart = 0;
  windowCount = 0;
}
