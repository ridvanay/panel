import { apiFetch } from "./client";

/** Paket Y — hasta yorumları moderasyonu (ADMIN/MANAGER). Metin DÜZENLENEMEZ; yalnızca maskeleme (redact). */

export type TestimonialStatus = "pending" | "approved" | "rejected" | "hidden";
export type TestimonialSource = "verified_booking" | "manual_with_consent" | "imported";

export interface AdminTestimonial {
  id: string;
  doctorId: string | null;
  doctorName: string | null;
  specialtyId: string | null;
  bookingId: string | null;
  authorDisplay: string;
  displayMode: string;
  country: string | null;
  language: string;
  rating: number;
  title: string;
  body: string;
  translations: Record<string, { title?: string | null; body: string }> | null;
  source: TestimonialSource;
  verified: boolean;
  consentAt: string;
  consentEvidenceNote: string | null;
  status: TestimonialStatus;
  moderatedAt: string | null;
  redactionCount: number;
  featuredOnHome: boolean;
  publishedAt: string | null;
  doctorReply: string | null;
  anonymizedAt: string | null;
  createdAt: string;
}

export interface AdminTestimonialPage {
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<TestimonialStatus, number>>;
  items: AdminTestimonial[];
}

export interface ManualTestimonialInput {
  doctorId?: string | null;
  authorDisplay: string;
  country?: string | null;
  language: string;
  rating: number;
  title: string;
  body: string;
  source: "manual_with_consent" | "imported";
  consentEvidenceNote: string;
  consentAt?: string;
}

export interface TestimonialUpdateInput {
  translations?: Record<string, { title: string; body: string }>;
  featuredOnHome?: boolean;
  doctorReply?: string | null;
}

export const listAdminTestimonials = (params: { status?: TestimonialStatus; doctorId?: string; page?: number } = {}) =>
  apiFetch<AdminTestimonialPage>("/admin/testimonials", { query: { status: params.status, doctorId: params.doctorId, page: params.page } });
export const createManualTestimonial = (input: ManualTestimonialInput) => apiFetch<AdminTestimonial>("/admin/testimonials", { method: "POST", body: input });
export const setTestimonialStatus = (id: string, status: "approved" | "rejected" | "hidden") =>
  apiFetch<AdminTestimonial>(`/admin/testimonials/${encodeURIComponent(id)}/status`, { method: "POST", body: { status } });
export const redactTestimonial = (id: string, field: "title" | "body", snippet: string) =>
  apiFetch<AdminTestimonial>(`/admin/testimonials/${encodeURIComponent(id)}/redact`, { method: "POST", body: { field, snippet } });
export const updateTestimonial = (id: string, input: TestimonialUpdateInput) =>
  apiFetch<AdminTestimonial>(`/admin/testimonials/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
export const removeTestimonial = (id: string) => apiFetch<AdminTestimonial>(`/admin/testimonials/${encodeURIComponent(id)}/remove`, { method: "POST" });
