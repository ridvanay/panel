import { apiFetch, apiFetchPage } from "./client";
import type {
  AdminUser,
  CreateAdminUserRequest,
  CreateAdminUserResponse,
  Page,
  SiteRole,
  SiteUserStatus,
} from "./types";

export function listAdminUsers(cursor?: string): Promise<Page<AdminUser>> {
  return apiFetchPage<AdminUser>("/admin/users", { query: { cursor, limit: 100 } });
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

export function updateUserStatus(userId: string, status: SiteUserStatus): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/status`, { method: "PATCH", body: { status } });
}
