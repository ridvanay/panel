import crypto from "node:crypto";
import { hashToken } from "./tokens";

/**
 * §10.4 Güvenlik & 2FA — tek kullanımlık yedek kodlar. Format `XXXX-XXXX`,
 * karışabilecek karakterler (0/O, 1/I/L) elenmiş bir alfabe kullanılır.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    // noUncheckedIndexedAccess: crypto.randomBytes(length) length kadar eleman garanti eder.
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${randomSegment(4)}-${randomSegment(4)}`);
}

/** sha256 tabanlı — tek kullanımlık kısa kod olduğu için argon2 gerekmez (bkz. lib/tokens.ts::hashToken). */
export function hashBackupCode(code: string): string {
  return hashToken(code.trim().toUpperCase());
}
