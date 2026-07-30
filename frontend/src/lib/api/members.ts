import { apiFetch, apiFetchPage } from "./client";
import type { Membership, Page, UpdateMembershipRequest } from "./types";

export function listMembers(orgId: string, cursor?: string): Promise<Page<Membership>> {
  return apiFetchPage<Membership>(`/organizations/${orgId}/members`, { query: { cursor } });
}

export function updateMemberRole(orgId: string, userId: string, input: UpdateMembershipRequest) {
  return apiFetch<Membership>(`/organizations/${orgId}/members/${userId}`, { method: "PATCH", body: input });
}

export function removeMember(orgId: string, userId: string) {
  return apiFetch<void>(`/organizations/${orgId}/members/${userId}`, { method: "DELETE" });
}
