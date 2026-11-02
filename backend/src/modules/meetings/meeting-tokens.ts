import crypto from "node:crypto";
import { jwtPrivateKey } from "../../lib/keys";
import { timingSafeEqualHex } from "../../lib/api-key";
import { hashToken } from "../../lib/tokens";
import { env } from "../../config/env";
import { toCustomerEmailLocale } from "../../lib/branded-email";
import { MEETING_END_GRACE_MS } from "../telehealth/lib/meeting-livekit";

/**
 * Paket AG (İş 3) — harici toplantı misafir belirteçleri (blog önizleme `s_`/`p_` deseninin uyarlaması).
 *  - Misafir bağlantısı belirteci `mg_<32 bayt base64url>` (256 bit): DB'de YALNIZCA SHA-256 özeti. Düz belirteç
 *    oluşturma / yeniden üretme yanıtında bir kez döner; log, audit ve hata gövdesine ASLA yazılmaz.
 *  - Misafir oturum belirteci `gs_v1.<guestId>.<meetingId>.<expUnix>.<imza>`: durumsuz HMAC-SHA256. Anahtar =
 *    HKDF(JWT özel anahtarı, "meeting-guest-v1") — blog anahtarından AYRI bağlam (çapraz kullanılamaz), yeni .env YOK.
 */

export const GUEST_TOKEN_REGEX = /^mg_[A-Za-z0-9_-]{43}$/;
const SESSION_VERSION = "v1";

let cachedKey: Buffer | null = null;
function sessionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(jwtPrivateKey ?? "", "utf8"), Buffer.alloc(0), Buffer.from("meeting-guest-v1", "utf8"), 32));
  }
  return cachedKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", sessionKey()).update(body).digest("base64url");
}

export function generateGuestToken(): { token: string; hash: string } {
  const token = `mg_${crypto.randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

/** Saklı özet yoksa bile sahte bir karşılaştırma yapılır (zamanlama farkı sızmasın). */
const DUMMY_HASH = hashToken("meeting-guest-dummy");
export function verifyGuestToken(token: string, storedHash: string | null): boolean {
  const ok = timingSafeEqualHex(hashToken(token), storedHash ?? DUMMY_HASH);
  return ok && storedHash !== null;
}

/**
 * `https://<site>/{lang}/meet/join#mg_…` — belirteç URL PARÇASINDA (sunucuya/loglara/Referer'a gitmez).
 * Bağlantıyı alan kişi dış misafirdir: Türkçe ziyaretçiye kapalı olduğundan `tr`/bilinmeyen dil `en`'e düşer (Paket AH).
 */
export function buildGuestLink(token: string, locale: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/${toCustomerEmailLocale(locale)}/meet/join#${token}`;
}

/** İstemcinin gönderdiği bağlantıdan (veya çıplak belirteçten) `mg_…` belirtecini çıkarır; biçim uymuyorsa null. */
export function extractGuestToken(linkOrToken: string): string | null {
  const candidate = linkOrToken.includes("#") ? linkOrToken.slice(linkOrToken.lastIndexOf("#") + 1) : linkOrToken;
  return GUEST_TOKEN_REGEX.test(candidate) ? candidate : null;
}

export function issueGuestSession(guestId: string, meetingId: string, endsAt: Date): string {
  const exp = Math.floor((endsAt.getTime() + MEETING_END_GRACE_MS) / 1000);
  const body = `${SESSION_VERSION}.${guestId}.${meetingId}.${exp}`;
  return `gs_${body}.${sign(body)}`;
}

/** Geçerliyse `{ guestId }`, aksi hâlde null (kurcalanmış, başka toplantıya ait, süresi dolmuş, biçim bozuk). */
export function verifyGuestSession(token: string, meetingId: string, nowMs: number = Date.now()): { guestId: string } | null {
  if (!token.startsWith("gs_")) return null;
  const parts = token.slice(3).split(".");
  if (parts.length !== 5) return null;
  const [version, guestId, tokenMeetingId, expRaw, signature] = parts as [string, string, string, string, string];
  if (version !== SESSION_VERSION || !/^\d{9,12}$/.test(expRaw)) return null;
  const expected = Buffer.from(sign(`${version}.${guestId}.${tokenMeetingId}.${expRaw}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (tokenMeetingId !== meetingId) return null;
  if (Number(expRaw) * 1000 <= nowMs) return null;
  return { guestId };
}
