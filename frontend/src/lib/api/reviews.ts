import { apiFetch } from "./client";
import type {
  DoctorReviewsResponse,
  PatientBookingReviewState,
  ReviewInviteInfo,
  ReviewSort,
  SubmitReviewRequest,
  SubmitReviewResult,
} from "./types";

/**
 * Paket Y — hasta memnuniyet yorumları (tarayıcı tarafı). Kontrat: docs/prompts/2026-10-30-Y-api-kontrat.md.
 * Public `POST`/`DELETE` yalnızca sitenin kendi origin'inden kabul edilir; normal çağrı yeterlidir.
 */

export interface ListDoctorReviewsParams {
  locale: string;
  sort?: ReviewSort;
  language?: string;
  page?: number;
}

export function listDoctorReviews(slug: string, params: ListDoctorReviewsParams): Promise<DoctorReviewsResponse> {
  return apiFetch<DoctorReviewsResponse>(`/doctors/${encodeURIComponent(slug)}/reviews`, {
    query: { locale: params.locale, sort: params.sort, language: params.language || undefined, page: params.page },
  });
}

// Paket AP — davet token'ı POST gövdesinde (URL'de taşınmaz).
export function getReviewInvite(token: string): Promise<ReviewInviteInfo> {
  return apiFetch<ReviewInviteInfo>("/reviews/invite/lookup", { method: "POST", body: { token }, skipAuthRetry: true });
}

export function submitReviewInvite(token: string, input: SubmitReviewRequest): Promise<SubmitReviewResult> {
  return apiFetch<SubmitReviewResult>("/reviews/invite/submit", { method: "POST", body: { ...input, token }, skipAuthRetry: true });
}

/** `POST /reviews/invite/opt-out` — 204. Geçersiz/kullanılmış token da 204 döner. */
export function optOutReviewInvite(token: string): Promise<void> {
  return apiFetch<void>("/reviews/invite/opt-out", { method: "POST", body: { token }, skipAuthRetry: true });
}

export function getPatientBookingReview(bookingId: string): Promise<PatientBookingReviewState> {
  return apiFetch<PatientBookingReviewState>(`/patient/bookings/${encodeURIComponent(bookingId)}/review`);
}

export function submitPatientBookingReview(bookingId: string, input: SubmitReviewRequest): Promise<SubmitReviewResult> {
  return apiFetch<SubmitReviewResult>(`/patient/bookings/${encodeURIComponent(bookingId)}/review`, { method: "POST", body: input });
}

export function deletePatientReview(reviewId: string): Promise<void> {
  return apiFetch<void>(`/patient/reviews/${encodeURIComponent(reviewId)}`, { method: "DELETE" });
}
