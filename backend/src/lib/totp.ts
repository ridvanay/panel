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

/** otplib'in varsayılan ±1 zaman penceresi (adım başına 30sn) toleransıyla doğrular. */
export function verifyTotp(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export async function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}
