import { apiFetch } from "./client";
import type { PermissionsMatrix, SiteSettings, UpdateSiteSettingsRequest } from "./types";

export function getSettings(): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/admin/settings");
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
