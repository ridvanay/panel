import { authenticator } from "otplib";
import QRCode from "qrcode";

/** §10.4 Güvenlik & 2FA — `otplib`'i sarmalayan ince katman (bkz. ARCHITECTURE.md §10.4). */

const ISSUER = "Admin Panel";

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(secret: string, email: string): string {
  return authenticator.keyuri(email, ISSUER, secret);
}

/** TOTP zaman adımı (sn) — otplib varsayılanı. */
export const TOTP_STEP_MS = 30_000;

/**
 * Kodu doğrular. otplib'in etkin penceresi 0'dır (`authenticator.allOptions().window === 0`):
 * yalnızca o anki 30 sn'lik adımın kodu kabul edilir. Paket G — eskiden burada "±1 pencere" yazıyordu,
 * bu yanlıştı. Yeniden kullanım koruması GEREKEN yerlerde (giriş, step-up, 2FA kurulumu) bunun yerine
 * `lib/two-factor.ts::verifyAndConsumeTotp` kullanılır.
 */
export function verifyTotp(secret: string, code: string): boolean {
  return matchTotpStep(secret, code) !== null;
}

/**
 * Kodun eşleştiği zaman adımını (`floor(epochMs / 30000)`) döndürür; eşleşmezse `null`. Adım ve
 * doğrulama AYNI `nowMs` ile yapılır (adım sınırında yarış olmasın diye).
 */
export function matchTotpStep(secret: string, code: string, nowMs: number = Date.now()): number | null {
  try {
    const delta = authenticator.clone({ epoch: nowMs }).checkDelta(code, secret);
    if (delta === null) return null;
    return Math.floor(nowMs / TOTP_STEP_MS) + delta;
  } catch {
    return null;
  }
}

export async function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}
