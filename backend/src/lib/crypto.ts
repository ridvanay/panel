import crypto from "node:crypto";
import { env } from "../config/env";

/**
 * §10.4 Güvenlik & 2FA — TOTP secret'ı (base32) DB'ye asla düz metin yazılmaz,
 * AES-256-GCM ile bu modül üzerinden şifrelenir (bkz. ARCHITECTURE.md §10.4).
 */

// `as const` önemli: string'e genişlerse TS `createCipheriv`'in genel (GCM-siz) overload'ını
// seçer ve dönen `Cipher` tipinde `getAuthTag`/`setAuthTag` bulunmaz.
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH_BYTES = 12; // GCM için önerilen 96-bit IV.
const KEY_LENGTH_BYTES = 32; // AES-256.

const encryptionKey = Buffer.from(env.ENCRYPTION_KEY, "base64");

if (encryptionKey.length !== KEY_LENGTH_BYTES) {
  throw new Error(
    `ENCRYPTION_KEY 32 byte (base64) olmalı, ${encryptionKey.length} byte bulundu. Üretmek için: openssl rand -base64 32`
  );
}

/** Düz metni şifreler; dönüş formatı `iv:authTag:ciphertext` (hex, tek string). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);

  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** `encryptSecret` ile şifrelenmiş bir değeri çözer. */
export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(":");
  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (parts.length !== 3 || !ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Geçersiz şifreli değer formatı.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plain.toString("utf8");
}
