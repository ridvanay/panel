import { apiFetch } from "./client";
import type { PermissionsMatrix, SiteSettings, UpdateSiteSettingsRequest } from "./types";

export function getSettings(): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/admin/settings");
}

/**
 * Herkese açık `GET /settings` — auth GEREKTİRMEZ. `booking-payment-step.tsx` bunu, demo ödeme
 * butonunun runtime (`SiteSettings.demoPaymentsEnabled`, env `&&` DB AND-gate sonucu) görünürlük
 * kontrolü için çağırır (bkz. `.claude/security-review-demo-payment-toggle.md` Madde 4).
 */
export function getPublicSettings(): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/settings");
}

export function updateSettings(input: UpdateSiteSettingsRequest): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/admin/settings", { method: "PATCH", body: input });
}

/**
 * Salt-okunur rol izin matrisi — "hangi rol neyi yapabiliyor" tablosu.
 * Backend'de sabit tanımlıdır, bu ekrandan düzenlenemez.
 */
export function getPermissionsMatrix(): Promise<PermissionsMatrix> {
  return apiFetch<PermissionsMatrix>("/admin/settings/permissions");
}
