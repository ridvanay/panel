import crypto from "node:crypto";
import { hashToken } from "./tokens";

/**
 * §10.13.3 API anahtarı formatı ve hash'leme (security-agent kararı, ARCHITECTURE.md §10.13.3
 * — bağlayıcı, TAHMİN YÜRÜTÜLMEDİ).
 *
 * Ham anahtar: `cmsk_<12hex prefix>_<64hex secret>` (toplam 82 karakter). `cmsk_` sabit ön eki
 * sızıntı taraması (gitleaks/GitHub push protection) içindir. Hex kullanılır (base64url DEĞİL)
 * çünkü base64url alfabesi `_` içerir ve ayırıcı olarak `_` kullanan bu formatta parse
 * belirsizleşirdi. İki parçalı yapı: `keyPrefix` (gizli DEĞİL, indeks araması + admin panelinde
 * "hangi anahtar?" teşhisi için) + `secret` (256 bit rastgele, YALNIZCA hash'i saklanır).
 *
 * Hash'leme `sha256(rawKey)` — `lib/tokens.ts::hashToken` YENİDEN KULLANILIR. Argon2/bcrypt gibi
 * yavaş bir KDF BİLİNÇLİ olarak KULLANILMAZ: sır 256 bit rastgele olduğundan (düşük entropili
 * insan şifresi DEĞİL) yavaşlatmanın güvenlik kazancı sıfırdır, ama maliyeti gerçektir (her public
 * API isteğinde çalışır) — bkz. ARCHITECTURE.md §10.13.3 gerekçe 1-3.
 */

export const API_KEY_PREFIX_BYTES = 6; // 12 hex karakter
export const API_KEY_SECRET_BYTES = 32; // 64 hex karakter, 256 bit
export const API_KEY_FORMAT_PATTERN = /^cmsk_([0-9a-f]{12})_([0-9a-f]{64})$/;

export interface GeneratedApiKey {
  /** `cmsk_<12hex>` — DB'de `ApiKey.keyPrefix` olarak saklanır, gizli DEĞİLDİR. */
  keyPrefix: string;
  /** Ham anahtarın son 4 karakteri — maskeli gösterim için (`ApiKey.last4`). */
  last4: string;
  /** `sha256(rawKey)` hex — DB'de `ApiKey.keyHash` olarak saklanır. */
  keyHash: string;
  /** `cmsk_<12hex>_<64hex>` — YALNIZCA oluşturma yanıtında bir kez döner, DB'ye YAZILMAZ. */
  plainKey: string;
}

/** Yeni bir API anahtarı üretir. `plainKey` çağıran tarafından yalnızca 201 yanıtında kullanılmalı. */
export function generateApiKey(): GeneratedApiKey {
  const prefixHex = crypto.randomBytes(API_KEY_PREFIX_BYTES).toString("hex");
  const secretHex = crypto.randomBytes(API_KEY_SECRET_BYTES).toString("hex");
  const keyPrefix = `cmsk_${prefixHex}`;
  const plainKey = `${keyPrefix}_${secretHex}`;

  return {
    keyPrefix,
    last4: secretHex.slice(-4),
    keyHash: hashToken(plainKey),
    plainKey,
  };
}

export interface ParsedApiKey {
  keyPrefix: string;
}

/** `X-Api-Key` header değerini ayrıştırır; format uymuyorsa `null` (401 — ayrım YAPMAZ). */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const match = API_KEY_FORMAT_PATTERN.exec(raw);
  if (!match) return null;
  return { keyPrefix: `cmsk_${match[1]}` };
}

/** Sunucuda türetilen hazır maskeli gösterim: `keyPrefix` + `…` + `last4`. */
export function buildMaskedKey(keyPrefix: string, last4: string): string {
  return `${keyPrefix}…${last4}`;
}

/**
 * `crypto.timingSafeEqual` sarmalayıcısı — düz `===` YASAK (zamanlama sızıntısı, §10.13.4 madde
 * 3). Uzunluk farklıysa `timingSafeEqual` throw eder; bu durumda `false` dönülür (hash'ler her
 * zaman aynı uzunlukta olmalı, farklı uzunluk zaten "eşleşmiyor" demektir).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// §10.13.4 Doğrulama cache'i — süreç-içi, TTL'li (30 sn), en fazla 500 giriş, yalnızca
// POZİTİF sonuçları önbelleğe alır. İptal/silme/güncelleme ANINDA `invalidateApiKeyCache`
// ile senkron temizlenir — "iptal edilmiş anahtarın 30 sn daha çalışması" penceresi YOKTUR.
// Tek instance varsayımı §10.8.1 ile AYNI (yatay ölçeklemede Redis'e taşınmalı).
// ---------------------------------------------------------------------------

export interface CachedApiKey {
  id: string;
  keyHash: string;
  scope: "READ" | "READ_WRITE";
  status: "ACTIVE" | "REVOKED";
  expiresAt: Date | null;
  name: string;
}

interface CacheEntry {
  value: CachedApiKey;
  expiresAtMs: number;
}

const API_KEY_CACHE_TTL_MS = 30_000;
const API_KEY_CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, CacheEntry>();

export function getCachedApiKey(keyPrefix: string): CachedApiKey | undefined {
  const entry = cache.get(keyPrefix);
  if (!entry) return undefined;
  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(keyPrefix);
    return undefined;
  }
  return entry.value;
}

export function setCachedApiKey(keyPrefix: string, value: CachedApiKey): void {
  // Basit boyut tavanı — en eski girişi (Map ekleme sırasını korur) atarak sınırsız büyümeyi önler.
  if (cache.size >= API_KEY_CACHE_MAX_ENTRIES && !cache.has(keyPrefix)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(keyPrefix, { value, expiresAtMs: Date.now() + API_KEY_CACHE_TTL_MS });
}

/** İptal/silme/güncelleme sonrası ÇAĞRILMALIDIR — `keyPrefix` bilinmiyorsa tüm cache temizlenir. */
export function invalidateApiKeyCache(keyPrefix?: string): void {
  if (keyPrefix) {
    cache.delete(keyPrefix);
    return;
  }
  cache.clear();
}

/** Yalnızca testler için — süreç-içi cache'i sıfırlar. */
export function __resetApiKeyCacheForTests(): void {
  cache.clear();
}
