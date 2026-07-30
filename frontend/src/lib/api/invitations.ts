import { apiFetch } from "./client";
import type { CreateInvitationRequest, Invitation, Membership } from "./types";

export function listInvitations(orgId: string) {
  return apiFetch<Invitation[]>(`/organizations/${orgId}/invitations`);
}

export function createInvitation(orgId: string, input: CreateInvitationRequest) {
  return apiFetch<Invitation>(`/organizations/${orgId}/invitations`, { method: "POST", body: input });
}

export function acceptInvitation(token: string) {
  return apiFetch<Membership>(`/invitations/${token}/accept`, { method: "POST" });
}
