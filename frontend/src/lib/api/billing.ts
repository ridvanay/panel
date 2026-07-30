import { apiFetch } from "./client";
import type { BillingPortalResponse, CheckoutSessionResponse, CreateCheckoutSessionRequest, Subscription } from "./types";

export function getSubscription(orgId: string) {
  return apiFetch<Subscription>(`/organizations/${orgId}/subscription`);
}

export function createCheckoutSession(orgId: string, input: CreateCheckoutSessionRequest) {
  return apiFetch<CheckoutSessionResponse>(`/organizations/${orgId}/subscription/checkout-session`, {
    method: "POST",
    body: input,
  });
}

export function createPortalSession(orgId: string) {
  return apiFetch<BillingPortalResponse>(`/organizations/${orgId}/subscription/portal-session`, { method: "POST" });
}
