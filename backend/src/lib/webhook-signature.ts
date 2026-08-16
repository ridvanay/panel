import crypto from "node:crypto";

/**
 * §10.13.9 HMAC imza formatı (bağlayıcı — alıcı bu sözleşmeye göre doğrular).
 *
 *   signedPayload = `${timestamp}.${rawBody}`
 *   signature     = HMAC_SHA256(secret, signedPayload) → lowercase hex
 *   header        = `sha256=${signature}`
 *
 * `rawBody` çağıran taraf (dispatcher) tarafından TEK bir `JSON.stringify` çağrısıyla üretilip
 * hem imzalanmalı hem gönderilmelidir — iki kez serileştirme imzayı sessizce geçersiz kılar.
 */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const WEBHOOK_SECRET_RANDOM_BYTES = 32; // 64 hex karakter

/** `whsec_<64hex>` — YALNIZCA oluşturma/rotasyon yanıtında bir kez döner (§10.13.9). */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${crypto.randomBytes(WEBHOOK_SECRET_RANDOM_BYTES).toString("hex")}`;
}

export function webhookSecretLast4(plainSecret: string): string {
  return plainSecret.slice(-4);
}

/** `${timestamp}.${rawBody}` imzalanan dizeyi üretir. */
export function buildSignedPayload(timestampSeconds: number, rawBody: string): string {
  return `${timestampSeconds}.${rawBody}`;
}

/** `sha256=<lowercase hex>` — `X-Webhook-Signature` header değeri. */
export function signWebhookPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  const signedPayload = buildSignedPayload(timestampSeconds, rawBody);
  const digest = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/** Alıcı tarafı doğrulama yardımcı fonksiyonu (dokümantasyon/test amaçlı) — sabit zamanlı karşılaştırma. */
export function verifyWebhookSignature(secret: string, timestampSeconds: number, rawBody: string, header: string): boolean {
  const expected = signWebhookPayload(secret, timestampSeconds, rawBody);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(header);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
