import { apiFetch } from "./client";
import type {
  AppearancePreset,
  ResetAppearanceRequest,
  SiteAppearance,
  SiteCustomCode,
  UpdateCustomCssRequest,
  UpdateCustomJsRequest,
  UpdateSiteAppearanceRequest,
} from "./types";

/** `GET /admin/appearance` — SiteRole=ADMIN/MANAGER/EDITOR (panel kapısı), yazma (`PATCH`) ADMIN veya MANAGER; özel CSS/JS yalnızca ADMIN. */
export function getAdminAppearance(): Promise<SiteAppearance> {
  return apiFetch<SiteAppearance>("/admin/appearance");
}

/**
 * `PATCH /admin/appearance` — panelin 9 bölümünün HEPSİ bu TEK ucu kullanır (özel CSS/JS hariç).
 * Yalnızca gönderilen alanlar yazılır (kısmi PATCH semantiği).
 */
export function updateAppearance(input: UpdateSiteAppearanceRequest): Promise<SiteAppearance> {
  return apiFetch<SiteAppearance>("/admin/appearance", { method: "PATCH", body: input });
}

/** `GET /admin/appearance/presets` — kod içi statik registry (DB tablosu YOKTUR). */
export function getPresets(): Promise<AppearancePreset[]> {
  return apiFetch<AppearancePreset[]>("/admin/appearance/presets");
}

/** `POST /admin/appearance/reset` — özel CSS/JS bu işlemden ETKİLENMEZ. */
export function resetAppearance(input?: ResetAppearanceRequest): Promise<SiteAppearance> {
  return apiFetch<SiteAppearance>("/admin/appearance/reset", { method: "POST", body: input });
}

/** `GET /admin/appearance/custom-code` — okuma eşiği authenticated'tır (kod zaten public HTML'de görünür). */
export function getCustomCode(): Promise<SiteCustomCode> {
  return apiFetch<SiteCustomCode>("/admin/appearance/custom-code");
}

/** `PUT /admin/appearance/custom-code/css` — yalnızca ADMIN, `acknowledged` sunucuda zorlanır. */
export function updateCustomCss(input: UpdateCustomCssRequest): Promise<SiteCustomCode> {
  return apiFetch<SiteCustomCode>("/admin/appearance/custom-code/css", { method: "PUT", body: input });
}

/** `PUT /admin/appearance/custom-code/js` — kontrattaki EN YÜKSEK RİSKLİ yazma ucu. */
export function updateCustomJs(input: UpdateCustomJsRequest): Promise<SiteCustomCode> {
  return apiFetch<SiteCustomCode>("/admin/appearance/custom-code/js", { method: "PUT", body: input });
}
