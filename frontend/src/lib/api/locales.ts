import { apiFetch } from "./client";
import type { Locale, LocaleUpdateRequest, LocaleUpsertRequest } from "./types";

/** `GET /admin/locales` — okuma authenticated (herhangi bir SiteRole), devre dışı diller DAHİL. */
export function listAdminLocales(): Promise<Locale[]> {
  return apiFetch<Locale[]>("/admin/locales");
}

/** `POST /admin/locales` — yalnızca SiteRole=ADMIN. Şema değişikliği/migration GEREKTİRMEZ. */
export function createLocale(input: LocaleUpsertRequest): Promise<Locale> {
  return apiFetch<Locale>("/admin/locales", { method: "POST", body: input });
}

/** `PATCH /admin/locales/{code}` — `code` DEĞİŞTİRİLEMEZ. `isDefault:true` URL yapısını değiştirir. */
export function updateLocale(code: string, input: LocaleUpdateRequest): Promise<Locale> {
  return apiFetch<Locale>(`/admin/locales/${code}`, { method: "PATCH", body: input });
}

/** `DELETE /admin/locales/{code}` — varsayılan dil silinemez (422). Kalıcı, geri alınamaz. */
export function deleteLocale(code: string): Promise<void> {
  return apiFetch<void>(`/admin/locales/${code}`, { method: "DELETE" });
}
