import crypto from "node:crypto";
import { jwtPrivateKey } from "../../../lib/keys";
import { timingSafeEqualHex } from "../../../lib/api-key";
import { hashToken } from "../../../lib/tokens";

/**
 * Blog taslak önizleme belirteçleri.
 *  - Paylaşım belirteci `s_<32 bayt base64url>`: oturumsuz, 7 gün, iptal edilebilir. DB'de YALNIZCA SHA-256 özeti.
 *  - Oturum belirteci `p_v1.<postId>.<expUnix>.<purpose>.<imza>`: durumsuz, 30 dk, HMAC-SHA256.
 *    Anahtar = HKDF(JWT özel anahtarı, "blog-preview-v1") — yeni .env değişkeni YOK.
 */

export const PREVIEW_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIEW_SESSION_TTL_SEC = 30 * 60;

const SESSION_VERSION = "v1";
export type PreviewSessionPurpose = "admin" | "doctor";

let cachedKey: Buffer | null = null;
function sessionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(jwtPrivateKey ?? "", "utf8"), Buffer.alloc(0), Buffer.from("blog-preview-v1", "utf8"), 32));
  }
  return cachedKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", sessionKey()).update(body).digest("base64url");
}

export function generateShareToken(): { token: string; hash: string } {
  const token = `s_${crypto.randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

/** Saklı özet yoksa bile sahte bir karşılaştırma yapılır (zamanlama farkı sızmasın). */
const DUMMY_HASH = hashToken("blog-preview-dummy");
export function verifyShareToken(token: string, storedHash: string | null): boolean {
  const ok = timingSafeEqualHex(hashToken(token), storedHash ?? DUMMY_HASH);
  return ok && storedHash !== null;
}

export function issueSessionToken(postId: string, purpose: PreviewSessionPurpose, nowMs: number = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(nowMs / 1000) + PREVIEW_SESSION_TTL_SEC;
  const body = `${SESSION_VERSION}.${postId}.${exp}.${purpose}`;
  return { token: `p_${body}.${sign(body)}`, expiresAt: new Date(exp * 1000) };
}

export function verifySessionToken(token: string, postId: string, nowMs: number = Date.now()): boolean {
  if (!token.startsWith("p_")) return false;
  const parts = token.slice(2).split(".");
  if (parts.length !== 5) return false;
  const [version, tokenPostId, expRaw, purpose, signature] = parts as [string, string, string, string, string];
  if (version !== SESSION_VERSION || (purpose !== "admin" && purpose !== "doctor") || !/^\d{9,12}$/.test(expRaw)) return false;
  const expected = Buffer.from(sign(`${version}.${tokenPostId}.${expRaw}.${purpose}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  if (tokenPostId !== postId) return false;
  return Number(expRaw) * 1000 > nowMs;
}
