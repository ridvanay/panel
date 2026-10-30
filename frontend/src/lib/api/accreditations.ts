import { apiFetch } from "./client";
import type { AccreditationInput, AdminAccreditation } from "./types";

/** Paket V — admin "Yetki Belgeleri ve Akreditasyonlar" ekranı. Okuma ADMIN/MANAGER, yazma yalnızca ADMIN. */
export function listAdminAccreditations(): Promise<AdminAccreditation[]> {
  return apiFetch<AdminAccreditation[]>("/admin/accreditations");
}

export function createAccreditation(input: AccreditationInput): Promise<AdminAccreditation> {
  return apiFetch<AdminAccreditation>("/admin/accreditations", { method: "POST", body: input });
}

export function updateAccreditation(id: string, input: AccreditationInput): Promise<AdminAccreditation> {
  return apiFetch<AdminAccreditation>(`/admin/accreditations/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function deleteAccreditation(id: string): Promise<void> {
  return apiFetch<void>(`/admin/accreditations/${encodeURIComponent(id)}`, { method: "DELETE" });
}
