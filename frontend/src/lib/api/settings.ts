import { apiFetch } from "./client";
import type { SiteSettings, UpdateSiteSettingsRequest } from "./types";

export function getSettings(): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/admin/settings");
}

export function updateSettings(input: UpdateSiteSettingsRequest): Promise<SiteSettings> {
  return apiFetch<SiteSettings>("/admin/settings", { method: "PATCH", body: input });
}
