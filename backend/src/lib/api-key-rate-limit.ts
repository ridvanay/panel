import { PUBLIC_API_KEY_BURST_RATE_LIMIT, PUBLIC_API_KEY_RATE_LIMIT } from "./rate-limit";

/**
 * §10.13.6 Katman 2 — doğrulanmış `ApiKey.id` başına kota. `api-key-auth.ts` preHandler'ından
 * SONRA, aynı route kapsamında ikinci bir preHandler olarak çalışır (bkz. middleware/
 * api-key-auth.ts). Doğrulanmamış/uydurma bir anahtar bu katmana HİÇ ulaşamaz (önce 401 alır) —
 * kova bölünmesiyle atlatma imkânsızdır (§10.13.6 bağlayıcı gerekçe).
 *
 * `@fastify/rate-limit` KULLANILMAZ: o `onRequest` seviyesinde çalışır ve preHandler'dan önce
 * tetiklenir (bkz. rate-limit.ts açıklaması) — bu yüzden burada iki ayrı sabit sürgülü pencere
 * sayaç, süreç-içi `Map` ile elle uygulanır. Tek instance varsayımı §10.8.1 ile AYNI.
 */

interface Bucket {
  /** Pencere başlangıcındaki istek zaman damgaları (ms) — sürgülü pencere, "sabit dakika" DEĞİL. */
  timestamps: number[];
}

const dailyBuckets = new Map<string, Bucket>();
const burstBuckets = new Map<string, Bucket>();

function pruneAndCount(bucket: Bucket, windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let firstValidIndex = 0;
  while (firstValidIndex < bucket.timestamps.length && bucket.timestamps[firstValidIndex]! <= cutoff) {
    firstValidIndex += 1;
  }
  if (firstValidIndex > 0) bucket.timestamps.splice(0, firstValidIndex);
  return bucket.timestamps.length;
}

function timeWindowToMs(timeWindow: string): number {
  const match = /^(\d+)\s*(second|minute)s?$/.exec(timeWindow.trim());
  if (!match) return 60_000;
  const value = Number(match[1]);
  return match[2] === "second" ? value * 1000 : value * 60_000;
}

const MINUTE_WINDOW_MS = timeWindowToMs(PUBLIC_API_KEY_RATE_LIMIT.timeWindow);
const BURST_WINDOW_MS = timeWindowToMs(PUBLIC_API_KEY_BURST_RATE_LIMIT.timeWindow);

export interface ApiKeyRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Pencerenin sıfırlanmasına kalan saniye (dakikalık pencere baz alınır — `PublicApiKeyInfo.rateLimit` ile AYNI). */
  resetSeconds: number;
}

/**
 * `apiKeyId` başına HEM dakikalık (120/dk) HEM saniyelik (20/sn) kovayı kontrol eder — ikisinden
 * biri aşılırsa istek reddedilir. Yanıt header'ları (§10.13.6) HER ZAMAN dakikalık kovanın
 * değerlerini taşır (entegratör için anlamlı olan odur).
 */
export function checkApiKeyRateLimit(apiKeyId: string): ApiKeyRateLimitResult {
  const now = Date.now();

  const minuteBucket = dailyBuckets.get(apiKeyId) ?? { timestamps: [] };
  const burstBucket = burstBuckets.get(apiKeyId) ?? { timestamps: [] };

  const minuteCount = pruneAndCount(minuteBucket, MINUTE_WINDOW_MS, now);
  const burstCount = pruneAndCount(burstBucket, BURST_WINDOW_MS, now);

  const minuteAllowed = minuteCount < PUBLIC_API_KEY_RATE_LIMIT.max;
  const burstAllowed = burstCount < PUBLIC_API_KEY_BURST_RATE_LIMIT.max;
  const allowed = minuteAllowed && burstAllowed;

  if (allowed) {
    minuteBucket.timestamps.push(now);
    burstBucket.timestamps.push(now);
  }
  dailyBuckets.set(apiKeyId, minuteBucket);
  burstBuckets.set(apiKeyId, burstBucket);

  const oldestInWindow = minuteBucket.timestamps[0];
  const resetSeconds = oldestInWindow
    ? Math.max(1, Math.ceil((oldestInWindow + MINUTE_WINDOW_MS - now) / 1000))
    : Math.ceil(MINUTE_WINDOW_MS / 1000);

  return {
    allowed,
    limit: PUBLIC_API_KEY_RATE_LIMIT.max,
    remaining: Math.max(0, PUBLIC_API_KEY_RATE_LIMIT.max - minuteBucket.timestamps.length),
    resetSeconds,
  };
}

/** Yalnızca testler için — süreç-içi kovaları sıfırlar. */
export function __resetApiKeyRateLimitForTests(): void {
  dailyBuckets.clear();
  burstBuckets.clear();
}
