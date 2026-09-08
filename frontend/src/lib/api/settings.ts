import { apiFetch } from "./client";
import type { AdminSiteSettings, PermissionsMatrix, UpdateSiteSettingsRequest } from "./types";

/** `GET /admin/settings` — ADMIN-only, public `GET /settings`'ten farklı olarak `orderNotificationEmail` de döner (bkz. `AdminSiteSettings`). */
export function getSettings(): Promise<AdminSiteSettings> {
  return apiFetch<AdminSiteSettings>("/admin/settings");
}

export function updateSettings(input: UpdateSiteSettingsRequest): Promise<AdminSiteSettings> {
  return apiFetch<AdminSiteSettings>("/admin/settings", { method: "PATCH", body: input });
}

/**
 * Salt-okunur rol izin matrisi — "hangi rol neyi yapabiliyor" tablosu.
 * Backend'de sabit tanımlıdır, bu ekrandan düzenlenemez.
 */
export function getPermissionsMatrix(): Promise<PermissionsMatrix> {
  return apiFetch<PermissionsMatrix>("/admin/settings/permissions");
}
