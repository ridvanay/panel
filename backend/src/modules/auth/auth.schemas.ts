import { z } from "zod";

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
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
  newPassword: z.string().min(8, "Şifre en az 8 karakter olmalı."),
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
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});
