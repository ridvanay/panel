import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "../../lib/password-policy";

/**
 * Paket S — yeni şifre alanları: şemada yalnızca boş olmama + üst sınır; asıl kurallar (uzunluk,
 * karakter grupları, dizi/yaygın/kişisel) kullanıcı bağlamıyla servis katmanında
 * `assertPasswordPolicy` ile uygulanır (kural kodları 6 dile çevrilebilsin diye tek yerden).
 */
export const NewPasswordSchema = z.string().min(1, "Şifre gerekli.").max(PASSWORD_MAX_LENGTH, `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`);

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: NewPasswordSchema,
  name: z.string().min(1),
});

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: NewPasswordSchema,
});

/** §10.4 Güvenlik & 2FA — POST /auth/2fa/verify body'si. `code`: 6 haneli TOTP veya "XXXX-XXXX" backup kodu. */
export const VerifyTwoFactorRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(4),
});

/**
 * `.claude/architect-scope-guest-account-otp.md` §4 (bağlayıcı) — OTP altyapısının üç yeni ucu.
 * `code`: tam 6 haneli, yalnızca rakam (`lib/otp.ts::consumeVerificationCode` boşluk/tire
 * temizliğini KENDİSİ yapar — burada yalnızca istemcinin GÖNDERDİĞİ biçim doğrulanır).
 */
export const VerifyEmailRequestSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^[0-9]{6}$/, "Kod tam 6 haneli olmalı."),
});

/** §3.5 (bağlayıcı) — gövde YALNIZCA `email` taşır, `purpose` BİLİNÇLİ OLARAK YOKTUR. */
export const ResendVerificationCodeRequestSchema = z.object({
  email: z.string().email(),
});

/** §4.4/§5 (bağlayıcı) — `password` kuralı `RegisterRequest`/`reset-password` ile BİREBİR AYNI. */
export const ActivateAccountRequestSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^[0-9]{6}$/, "Kod tam 6 haneli olmalı."),
  password: NewPasswordSchema,
});
