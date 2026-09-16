import { apiFetch } from "./client";
import type {
  EmailSettings,
  EmailSettingsTestResponse,
  PermissionsMatrix,
  SiteSettings,
  UpdateEmailSettingsRequest,
  UpdateSiteSettingsRequest,
} from "./types";

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

/**
 * `GET /admin/settings/email` — yalnızca `SiteRole=ADMIN` (MANAGER/EDITOR → 403).
 * Ayrı singleton alt-kaynak (`.claude/architect-scope-smtp-settings.md` §1/§5) — parola
 * ASLA dönmez, yalnızca `smtpPasswordSet`.
 */
export function getEmailSettings(): Promise<EmailSettings> {
  return apiFetch<EmailSettings>("/admin/settings/email");
}

/**
 * `PATCH /admin/settings/email` — upsert, tüm alanlar opsiyonel. `smtpPassword` ÜÇ DURUMLU:
 * alan hiç gönderilmezse mevcut parola korunur; çağıran yer bu alanı yalnızca kullanıcı
 * gerçekten değiştirdiyse/temizlediyse gövdeye eklemelidir.
 */
export function updateEmailSettings(input: UpdateEmailSettingsRequest): Promise<EmailSettings> {
  return apiFetch<EmailSettings>("/admin/settings/email", { method: "PATCH", body: input });
}

/**
 * `POST /admin/settings/email/test` — gövde YOK, alıcı her zaman isteği yapan admin'in kendi
 * adresi. KAYDEDİLMİŞ satırı test eder (istek gövdesindeki geçici bir yapılandırmayı DEĞİL) —
 * bu yüzden arayüz akışı "önce Kaydet, sonra Test Et" olmalıdır. Başarısızlıkta `502
 * EMAIL_DELIVERY_FAILED` fırlatır (`ApiClientError`).
 */
export function testEmailSettings(): Promise<EmailSettingsTestResponse> {
  return apiFetch<EmailSettingsTestResponse>("/admin/settings/email/test", { method: "POST" });
}
