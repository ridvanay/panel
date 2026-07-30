import { apiFetch, apiFetchPage } from "./client";
import type { CreateOrganizationRequest, Organization, Page, UpdateOrganizationRequest } from "./types";

export function listOrganizations(cursor?: string): Promise<Page<Organization>> {
  return apiFetchPage<Organization>("/organizations", { query: { cursor } });
}

export function createOrganization(input: CreateOrganizationRequest) {
  return apiFetch<Organization>("/organizations", { method: "POST", body: input });
}

export function getOrganization(orgId: string) {
  return apiFetch<Organization>(`/organizations/${orgId}`);
}

export function updateOrganization(orgId: string, input: UpdateOrganizationRequest) {
  return apiFetch<Organization>(`/organizations/${orgId}`, { method: "PATCH", body: input });
}

export function deleteOrganization(orgId: string) {
  return apiFetch<void>(`/organizations/${orgId}`, { method: "DELETE" });
}
