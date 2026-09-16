import { apiFetch } from "./client";
import type {
  ActivateAccountRequest,
  AuthResponse,
  AuthSession,
  AuthTokens,
  LoginRequest,
  LoginResult,
  RegisterRequest,
  RegistrationPendingVerification,
  ResendVerificationCodeRequest,
  VerifyEmailRequest,
} from "./types";

/**
 * `.claude/architect-scope-guest-account-otp.md` §2.1 (bağlayıcı) — ARTIK `AuthResponse`
 * DÖNMEZ. Token/cookie YOK; kullanıcı `POST /auth/verify-email`e yönlendirilmelidir.
 */
export function register(input: RegisterRequest) {
  return apiFetch<RegistrationPendingVerification>("/auth/register", {
    method: "POST",
    body: input,
    skipAuthRetry: true,
  });
}

export function login(input: LoginRequest) {
  return apiFetch<LoginResult>("/auth/login", { method: "POST", body: input, skipAuthRetry: true });
}

/** §2/§4 — kayıt sonrası (Özellik A) e-posta doğrulama kodunu tüketir, başarıda normal login ile
 * BİREBİR AYNI çıktıyı (`AuthResponse`) verir. */
export function verifyEmail(input: VerifyEmailRequest) {
  return apiFetch<AuthResponse>("/auth/verify-email", { method: "POST", body: input, skipAuthRetry: true });
}

/** §3.5 — HER koşulda `202`/`void` döner; `forgot-password` ile AYNI numaralandırma-karşıtı
 * disiplin (kullanıcı yok / zaten doğrulanmış / cooldown içinde — ayırt edilemez). */
export function resendVerificationCode(input: ResendVerificationCodeRequest) {
  return apiFetch<void>("/auth/resend-verification-code", { method: "POST", body: input, skipAuthRetry: true });
}

/** §5/§4.4 — misafir randevu ödemesiyle açılmış hesabı kod + yeni parolayla aktive eder,
 * başarıda normal login ile BİREBİR AYNI çıktıyı (`AuthResponse`) verir. */
export function activateAccount(input: ActivateAccountRequest) {
  return apiFetch<AuthResponse>("/auth/activate-account", { method: "POST", body: input, skipAuthRetry: true });
}

/** §10.4 — `login()` `requiresTwoFactor: true` döndürdüğünde bu uçla TOTP/backup kodu doğrulanır. */
export function verifyTwoFactor(challengeToken: string, code: string) {
  return apiFetch<AuthResponse>("/auth/2fa/verify", {
    method: "POST",
    body: { challengeToken, code },
    skipAuthRetry: true,
  });
}

export function refresh() {
  return apiFetch<AuthTokens>("/auth/refresh", { method: "POST", skipAuthRetry: true });
}

export function logout() {
  return apiFetch<void>("/auth/logout", { method: "POST", skipAuthRetry: true });
}

export function forgotPassword(email: string) {
  return apiFetch<void>("/auth/forgot-password", { method: "POST", body: { email }, skipAuthRetry: true });
}

export function resetPassword(token: string, newPassword: string) {
  return apiFetch<void>("/auth/reset-password", {
    method: "POST",
    body: { token, newPassword },
    skipAuthRetry: true,
  });
}

export function getSession() {
  return apiFetch<AuthSession>("/auth/me");
}
