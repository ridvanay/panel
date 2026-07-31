import { apiFetch } from "./client";
import type { AuthResponse, AuthSession, AuthTokens, LoginRequest, LoginResult, RegisterRequest } from "./types";

export function register(input: RegisterRequest) {
  return apiFetch<AuthResponse>("/auth/register", { method: "POST", body: input, skipAuthRetry: true });
}

export function login(input: LoginRequest) {
  return apiFetch<LoginResult>("/auth/login", { method: "POST", body: input, skipAuthRetry: true });
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
