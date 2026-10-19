import { apiFetch } from "./client";
import type {
  TwoFactorSetupResponse,
  EnableTwoFactorRequest,
  EnableTwoFactorResponse,
  DisableTwoFactorRequest,
  RegenerateBackupCodesRequest,
  RegenerateBackupCodesResponse,
  Session,
  StaffTwoFactorPolicy,
  UpdateStaffTwoFactorPolicyRequest,
} from "./types";

const TWO_FACTOR_BASE = "/admin/settings/security/2fa";
const SESSIONS_BASE = "/admin/settings/security/sessions";

export function setupTwoFactor() {
  return apiFetch<TwoFactorSetupResponse>(`${TWO_FACTOR_BASE}/setup`, { method: "POST" });
}

export function enableTwoFactor(input: EnableTwoFactorRequest) {
  return apiFetch<EnableTwoFactorResponse>(`${TWO_FACTOR_BASE}/enable`, { method: "POST", body: input });
}

export function disableTwoFactor(input: DisableTwoFactorRequest) {
  return apiFetch<void>(`${TWO_FACTOR_BASE}/disable`, { method: "POST", body: input });
}

export function regenerateBackupCodes(input: RegenerateBackupCodesRequest) {
  return apiFetch<RegenerateBackupCodesResponse>(`${TWO_FACTOR_BASE}/backup-codes/regenerate`, {
    method: "POST",
    body: input,
  });
}

export function listSessions() {
  return apiFetch<Session[]>(SESSIONS_BASE);
}

export function revokeSession(id: string) {
  return apiFetch<void>(`${SESSIONS_BASE}/${id}`, { method: "DELETE" });
}

export function revokeOtherSessions() {
  return apiFetch<void>(`${SESSIONS_BASE}/revoke-others`, { method: "POST" });
}

/** Paket G — personel için zorunlu 2FA anahtarı (YALNIZCA ADMIN). */
export function getStaffTwoFactorPolicy() {
  return apiFetch<StaffTwoFactorPolicy>("/admin/settings/staff-two-factor");
}

/** Paket G — 2FA'sı etkin ADMIN + şifre + TOTP; `requiredAt` en az 7 gün ileride ya da `null` (kapat). */
export function updateStaffTwoFactorPolicy(input: UpdateStaffTwoFactorPolicyRequest) {
  return apiFetch<StaffTwoFactorPolicy>("/admin/settings/staff-two-factor", { method: "PUT", body: input });
}
