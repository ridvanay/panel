import { apiFetch, apiFetchPage } from "./client";
import type {
  AdminContactPage,
  ContactPageContent,
  ContactPageSubmissionRequest,
  ContactForm,
  ContactFormField,
  ContactSubmission,
  ContactSubmissionStatus,
  ContactSubmissionSummary,
  CreateContactSubmissionRequest,
  CreateContactSubmissionResponse,
  Page,
  PublicContactForm,
  ReplaceContactFormFieldsRequest,
  UpdateContactFormRequest,
  UpdateContactSubmissionRequest,
} from "./types";

// ---- Admin — form yapılandırması (bkz. ARCHITECTURE.md §10.16.8) ----

export function getContactForm() {
  return apiFetch<ContactForm>("/admin/contact/form");
}

export function updateContactForm(input: UpdateContactFormRequest) {
  return apiFetch<ContactForm>("/admin/contact/form", { method: "PATCH", body: input });
}

/** TAM DEĞİŞTİRME (`PUT /admin/navigation` deseni) — gövdedeki dizi mevcut alanların TAMAMININ yerine geçer. */
export function replaceContactFormFields(input: ReplaceContactFormFieldsRequest) {
  return apiFetch<ContactFormField[]>("/admin/contact/form/fields", { method: "PUT", body: input });
}

// ---- Admin — gönderimler (submissions) ----

export interface ListSubmissionsParams {
  cursor?: string;
  limit?: number;
  status?: ContactSubmissionStatus;
  q?: string;
}

export function listSubmissions(params: ListSubmissionsParams = {}): Promise<Page<ContactSubmissionSummary>> {
  return apiFetchPage<ContactSubmissionSummary>("/admin/contact/submissions", {
    query: { cursor: params.cursor, limit: params.limit ?? 20, status: params.status, q: params.q },
  });
}

/** Yan etkisizdir — okundu İŞARETLEMEZ (bunun için `updateSubmissionStatus(..., "READ")`). */
export function getSubmission(submissionId: string) {
  return apiFetch<ContactSubmission>(`/admin/contact/submissions/${submissionId}`);
}

export function updateSubmissionStatus(submissionId: string, input: UpdateContactSubmissionRequest) {
  return apiFetch<ContactSubmission>(`/admin/contact/submissions/${submissionId}`, { method: "PATCH", body: input });
}

/** Geri alınamaz — çöp kutusu YOKTUR. KVKK silme talebinin karşılığıdır. */
export function deleteSubmission(submissionId: string) {
  return apiFetch<void>(`/admin/contact/submissions/${submissionId}`, { method: "DELETE" });
}

// ---- Public (kimlik doğrulama YOK) ----

/** `isEnabled=false` ise backend 404 döner. */
export function getPublicContactForm() {
  return apiFetch<PublicContactForm>("/contact/form");
}

export function submitContactForm(input: CreateContactSubmissionRequest) {
  return apiFetch<CreateContactSubmissionResponse>("/contact/submissions", { method: "POST", body: input });
}

// ---- İletişim sayfası (`/contact`) ----

/** İmzalı zaman damgası — form açıldığında (ve süresi dolunca) tarayıcıdan alınır. */
export function getContactPageToken() {
  return apiFetch<{ token: string }>("/contact/page/token");
}

/**
 * Gönderim TARAYICIDAN doğrudan API'ye yapılır (`NEXT_PUBLIC_API_URL`, prod'da nginx `/api`) —
 * Next.js sunucusu aracı değildir; rate limit gerçek ziyaretçi IP'sine göre işler.
 */
export function submitContactPage(input: ContactPageSubmissionRequest) {
  return apiFetch<{ id: string }>("/contact/page-submissions", { method: "POST", body: input });
}

export function getAdminContactPage() {
  return apiFetch<AdminContactPage>("/admin/contact/page");
}

export function updateAdminContactPage(content: ContactPageContent) {
  return apiFetch<AdminContactPage>("/admin/contact/page", { method: "PUT", body: content });
}
