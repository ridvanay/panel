import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { checkApiKeyRateLimit, __resetApiKeyRateLimitForTests } from "../../src/lib/api-key-rate-limit";
import { PUBLIC_API_KEY_BURST_RATE_LIMIT, PUBLIC_API_KEY_RATE_LIMIT } from "../../src/lib/rate-limit";

describe("checkApiKeyRateLimit", () => {
  beforeEach(() => {
    __resetApiKeyRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under both the per-minute and burst limits", () => {
    const result = checkApiKeyRateLimit("key-1");
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(PUBLIC_API_KEY_RATE_LIMIT.max);
    expect(result.remaining).toBe(PUBLIC_API_KEY_RATE_LIMIT.max - 1);
  });

  it("rejects once the burst limit (20/sn) is exceeded, independent of the per-minute limit", () => {
    for (let i = 0; i < PUBLIC_API_KEY_BURST_RATE_LIMIT.max; i++) {
      expect(checkApiKeyRateLimit("burst-key").allowed).toBe(true);
    }
    expect(checkApiKeyRateLimit("burst-key").allowed).toBe(false);
  });

  it("rejects once the per-minute limit (120/dk) is exceeded, all within the 60sn window", () => {
    vi.useFakeTimers();
    const start = Date.now();
    const batches = PUBLIC_API_KEY_RATE_LIMIT.max / PUBLIC_API_KEY_BURST_RATE_LIMIT.max; // 120 / 20 = 6
    // Saniyelik burst tavanına (20/sn) takılmadan, ama 60sn'lik pencerenin İÇİNDE kalarak
    // dakikalık kovayı (120) doldurmak için art arda saniyelik dilimlerde 20'şer istek gönderir.
    for (let batch = 0; batch < batches; batch++) {
      vi.setSystemTime(start + batch * 1000);
      for (let i = 0; i < PUBLIC_API_KEY_BURST_RATE_LIMIT.max; i++) {
        expect(checkApiKeyRateLimit("minute-key").allowed).toBe(true);
      }
    }
    vi.setSystemTime(start + batches * 1000);
    expect(checkApiKeyRateLimit("minute-key").allowed).toBe(false);
  });

  it("tracks separate buckets per apiKeyId — one key's usage never affects another's", () => {
    for (let i = 0; i < PUBLIC_API_KEY_BURST_RATE_LIMIT.max; i++) {
      checkApiKeyRateLimit("key-a");
    }
    expect(checkApiKeyRateLimit("key-a").allowed).toBe(false);
    expect(checkApiKeyRateLimit("key-b").allowed).toBe(true);
  });

  it("resetSeconds is a positive integer reflecting the sliding window", () => {
    const result = checkApiKeyRateLimit("key-reset");
    expect(result.resetSeconds).toBeGreaterThan(0);
    expect(Number.isInteger(result.resetSeconds)).toBe(true);
  });
});
