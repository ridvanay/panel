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

export function createAdminUser(input: CreateAdminUserRequest): Promise<CreateAdminUserResponse> {
  return apiFetch<CreateAdminUserResponse>("/admin/users", { method: "POST", body: input });
}

export function updateUserRole(userId: string, role: SiteRole): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/role`, { method: "PATCH", body: { role } });
}

export function updateUserStatus(userId: string, status: SiteUserStatus): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/status`, { method: "PATCH", body: { status } });
}
