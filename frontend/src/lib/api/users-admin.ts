import { apiFetch, apiFetchPage } from "./client";
import type {
  AdminResetPasswordResponse,
  AdminUser,
  CreateAdminUserRequest,
  CreateAdminUserResponse,
  Page,
  SiteRole,
  SiteUserStatus,
} from "./types";

/**
 * `includeDeleted` — `true` ise `status: DELETED` (yumuşak silinmiş) kullanıcılar da listeye
 * dahil edilir. Verilmezse backend varsayılanı (`false`) geçerlidir — bkz. openapi.yaml
 * `GET /admin/users`.
 */
export function listAdminUsers(cursor?: string, includeDeleted?: boolean): Promise<Page<AdminUser>> {
  return apiFetchPage<AdminUser>("/admin/users", { query: { cursor, limit: 100, includeDeleted } });
}

/**
 * `listAdminUsers()`'ın TEK sayfasının aksine (`limit: 100`), cursor'ı sonuna kadar
 * takip ederek TÜM kullanıcıları döner — aynı desen `content-list/use-content-list.ts`
 * (satır ~87-106) içinde kullanılıyor. Dışa aktarma gibi "eksik olursa sessizce yanlış
 * sonuç üretir" senaryolarında `listAdminUsers()` YERİNE bu kullanılmalıdır.
 */
export async function listAllAdminUsers(): Promise<AdminUser[]> {
  let cursor: string | undefined;
  const collected: AdminUser[] = [];
  while (true) {
    const page = await listAdminUsers(cursor);
    collected.push(...page.items);
    if (!page.meta.nextCursor) break;
    cursor = page.meta.nextCursor;
  }
  return collected;
}

export function createAdminUser(input: CreateAdminUserRequest): Promise<CreateAdminUserResponse> {
  return apiFetch<CreateAdminUserResponse>("/admin/users", { method: "POST", body: input });
}

export function updateUserRole(userId: string, role: SiteRole): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/role`, { method: "PATCH", body: { role } });
}

export function updateUserStatus(
  userId: string,
  status: Exclude<SiteUserStatus, "DELETED">
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/status`, { method: "PATCH", body: { status } });
}

/**
 * Yumuşak silme — kullanıcıyı `status: DELETED` yapar, oturumlarını iptal eder. Fiziksel
 * silme DEĞİLDİR, `restoreUser()` ile geri alınabilir. Olası 409'lar: "Kendi hesabınızı
 * silemezsiniz." / "Sistemde en az bir yönetici kalmalı." Bkz. openapi.yaml
 * `DELETE /admin/users/{userId}`.
 */
export function deleteUser(userId: string): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}`, { method: "DELETE" });
}

/**
 * `status: DELETED` bir kullanıcıyı `ACTIVE`'e döndürür. Olası 409: "Bu kullanıcı
 * silinmemiş." (hedef zaten ACTIVE/SUSPENDED). Bkz. openapi.yaml
 * `POST /admin/users/{userId}/restore`.
 */
export function restoreUser(userId: string): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/restore`, { method: "POST" });
}

/**
 * Hedef kullanıcı için (admin adına) şifre sıfırlama e-postası tetikler — gövde YOKTUR.
 * `emailStatus: "failed"` olsa bile token üretilmiş ve önceki token'lar geçersiz kılınmıştır
 * (yanıt yine 200 döner, hata FIRLATILMAZ) — bkz. `NewUserDialog`'daki `emailStatus`
 * kullanım deseni. Olası hatalar: 404 (kullanıcı yok/silinmiş), 409 (SUSPENDED), 429
 * (60sn içinde tekrar istek veya route limiti aşımı). Bkz. openapi.yaml
 * `POST /admin/users/{userId}/reset-password` / `AdminResetPasswordResponse`.
 */
export function resetUserPassword(userId: string): Promise<AdminResetPasswordResponse> {
  return apiFetch<AdminResetPasswordResponse>(`/admin/users/${userId}/reset-password`, { method: "POST" });
}
