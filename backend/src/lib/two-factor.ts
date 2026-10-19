import type { PrismaClient } from "@prisma/client";
import { matchTotpStep } from "./totp";

/**
 * Paket G (2026-10-19) — TOTP tekrar kullanım koruması. Bir kod, eşleştiği 30 sn'lik adım
 * `User.twoFactorLastUsedStep`'ten BÜYÜKSE kabul edilir ve adım atomik olarak kaydedilir; aynı kod
 * (ya da daha eski bir adımın kodu) ikinci kez reddedilir. Eşzamanlı iki istekte `updateMany`
 * koşulu yalnızca birinin kazanmasını garanti eder.
 *
 * Tüm hesap TOTP doğrulamaları (giriş 2FA adımı, admin step-up'ları) bu fonksiyondan geçer.
 * 2FA kurulumu (`/2fa/enable`) yeni secret'ı doğruladığı için adımı kurulum güncellemesinde yazar.
 */
export type TotpConsumeResult = "ok" | "invalid" | "reused";

type UserDelegate = Pick<PrismaClient, "user">;

export async function verifyAndConsumeTotp(
  prisma: UserDelegate,
  userId: string,
  secret: string,
  code: string,
  nowMs: number = Date.now()
): Promise<TotpConsumeResult> {
  const step = matchTotpStep(secret, code, nowMs);
  if (step === null) return "invalid";
  const { count } = await prisma.user.updateMany({
    where: { id: userId, OR: [{ twoFactorLastUsedStep: null }, { twoFactorLastUsedStep: { lt: step } }] },
    data: { twoFactorLastUsedStep: step },
  });
  return count === 1 ? "ok" : "reused";
}

/** Kullanıcıya gösterilen ortak mesaj — kod doğruydu ama bu adımda zaten kullanılmıştı. */
export const TOTP_REUSED_MESSAGE = "Bu kod az önce kullanıldı. Uygulamanızda yeni kodun çıkmasını bekleyip tekrar deneyin.";
