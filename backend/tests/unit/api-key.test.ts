import { describe, expect, it, beforeEach } from "vitest";
import {
  API_KEY_FORMAT_PATTERN,
  buildMaskedKey,
  generateApiKey,
  getCachedApiKey,
  invalidateApiKeyCache,
  parseApiKey,
  setCachedApiKey,
  timingSafeEqualHex,
  __resetApiKeyCacheForTests,
} from "../../src/lib/api-key";
import { hashToken } from "../../src/lib/tokens";

describe("generateApiKey", () => {
  it("produces a raw key matching cmsk_<12hex>_<64hex>", () => {
    const { plainKey } = generateApiKey();
    expect(plainKey).toMatch(API_KEY_FORMAT_PATTERN);
    expect(plainKey).toHaveLength("cmsk_".length + 12 + 1 + 64);
  });

  it("derives keyHash as sha256(plainKey)", () => {
    const generated = generateApiKey();
    expect(generated.keyHash).toBe(hashToken(generated.plainKey));
  });

  it("derives last4 from the raw secret's final 4 characters", () => {
    const generated = generateApiKey();
    expect(generated.plainKey.endsWith(generated.last4)).toBe(true);
    expect(generated.last4).toHaveLength(4);
  });

  it("produces unique keys on repeated calls", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plainKey).not.toBe(b.plainKey);
    expect(a.keyPrefix).not.toBe(b.keyPrefix);
  });
});

describe("parseApiKey", () => {
  it("parses a well-formed key and returns its keyPrefix", () => {
    const { plainKey, keyPrefix } = generateApiKey();
    expect(parseApiKey(plainKey)).toEqual({ keyPrefix });
  });

  it("rejects malformed keys without leaking which part failed", () => {
    expect(parseApiKey("not-a-key")).toBeNull();
    expect(parseApiKey("cmsk_tooshort_abc")).toBeNull();
    expect(parseApiKey("Bearer cmsk_abc")).toBeNull();
  });

  it("rejects a key with valid prefix but non-hex secret", () => {
    expect(parseApiKey(`cmsk_${"a".repeat(12)}_${"z".repeat(64)}`)).toBeNull();
  });
});

describe("buildMaskedKey", () => {
  it("formats as keyPrefix…last4", () => {
    expect(buildMaskedKey("cmsk_7f3ka9dm2q0x", "9f2c")).toBe("cmsk_7f3ka9dm2q0x…9f2c");
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for identical hex strings", () => {
    const hash = hashToken("some-value");
    expect(timingSafeEqualHex(hash, hash)).toBe(true);
  });

  it("returns false for different hex strings of the same length", () => {
    expect(timingSafeEqualHex(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("returns false (not throw) for mismatched lengths", () => {
    expect(timingSafeEqualHex("ab", "abcd")).toBe(false);
  });
});

describe("API key validation cache", () => {
  beforeEach(() => {
    __resetApiKeyCacheForTests();
  });

  const sample = {
    id: "11111111-1111-1111-1111-111111111111",
    keyHash: "hash",
    scope: "READ" as const,
    status: "ACTIVE" as const,
    expiresAt: null,
    name: "Test",
  };

  it("returns undefined for a cache miss", () => {
    expect(getCachedApiKey("cmsk_missing")).toBeUndefined();
  });

  it("returns a cached entry after being set", () => {
    setCachedApiKey("cmsk_abc", sample);
    expect(getCachedApiKey("cmsk_abc")).toEqual(sample);
  });

  it("invalidateApiKeyCache removes a single entry", () => {
    setCachedApiKey("cmsk_abc", sample);
    invalidateApiKeyCache("cmsk_abc");
    expect(getCachedApiKey("cmsk_abc")).toBeUndefined();
  });

  it("invalidateApiKeyCache() without an argument clears everything", () => {
    setCachedApiKey("cmsk_abc", sample);
    setCachedApiKey("cmsk_def", sample);
    invalidateApiKeyCache();
    expect(getCachedApiKey("cmsk_abc")).toBeUndefined();
    expect(getCachedApiKey("cmsk_def")).toBeUndefined();
  });
});
