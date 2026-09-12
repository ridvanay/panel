import { API_BASE_URL } from "../env";
import { getAccessToken } from "./token-store";
import { ApiClientError } from "./error";
import { apiFetch, apiFetchPage } from "./client";
import type {
  ApiErrorBody,
  Appointment,
  AppointmentBooking,
  AppointmentDocument,
  AppointmentIntake,
  AvailabilitySlot,
  BookingCheckoutSessionResponse,
  BookingInvoice,
  CancelBookingRequest,
  CreateAppointmentRequest,
  CreateAppointmentResult,
  CreateBookingRequest,
  CreateBookingResult,
  CreateDoctorRequest,
  CreateSpecialtyRequest,
  DoctorAvailabilityRule,
  DoctorPortalProfile,
  DoctorProfile,
  ListDoctorBookingsParams,
  ListPatientBookingsParams,
  MeetingTokenResponse,
  Page,
  SetDoctorAvailabilityRequest,
  Specialty,
  UpdateDoctorRequest,
  UpdateSpecialtyRequest,
  UpsertIntakeRequest,
} from "./types";

/**
 * `.claude/architect-scope-telehealth-template.md` + `docs/architecture/openapi.yaml`
 * `TeleHealth` tag'i (tek doğruluk kaynağı) — public + admin uçları BİREBİR.
 */

// ---------- Public ----------

export interface ListPublicDoctorsParams {
  specialtySlug?: string;
  language?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

/** `GET /doctors` — `telehealth` modülü kapalıysa `404`. */
export function listPublicDoctors(params: ListPublicDoctorsParams = {}): Promise<Page<DoctorProfile>> {
  return apiFetchPage<DoctorProfile>("/doctors", {
    query: {
      specialtySlug: params.specialtySlug,
      language: params.language,
      search: params.search,
      cursor: params.cursor,
      limit: params.limit ?? 50,
    },
  });
}

export function getPublicDoctor(slug: string): Promise<DoctorProfile> {
  return apiFetch<DoctorProfile>(`/doctors/${encodeURIComponent(slug)}`);
}

/** `GET /doctors/{slug}/slots?from=&to=` — `from`/`to` YYYY-MM-DD, en fazla 31 gün aralık. */
export function getDoctorSlots(slug: string, from: string, to: string): Promise<AvailabilitySlot[]> {
  return apiFetch<AvailabilitySlot[]>(`/doctors/${encodeURIComponent(slug)}/slots`, { query: { from, to } });
}

/** `POST /appointments` — kimlik doğrulama GEREKMEZ, route-level hız sınırı 5 istek/dk. */
export function createAppointment(input: CreateAppointmentRequest): Promise<CreateAppointmentResult> {
  return apiFetch<CreateAppointmentResult>("/appointments", { method: "POST", body: input });
}

/** `?t=` opak misafir erişim token'ı — oturum sahibi hasta/doktor/ADMIN/MANAGER için opsiyoneldir. */
export function getAppointment(id: string, accessToken?: string): Promise<Appointment> {
  return apiFetch<Appointment>(`/appointments/${id}`, { query: { t: accessToken } });
}

export function cancelAppointment(id: string, accessToken?: string, reason?: string): Promise<Appointment> {
  return apiFetch<Appointment>(`/appointments/${id}/cancel`, {
    method: "POST",
    query: { t: accessToken },
    body: reason ? { reason } : undefined,
  });
}

/**
 * `POST /appointments/{id}/meeting-token` — integration-agent'ın ucu (§4.4). Yapılandırılmamışsa
 * `503 LIVEKIT_NOT_CONFIGURED`; katılım penceresi dışındaysa `409 APPOINTMENT_NOT_JOINABLE`.
 * Bu uç bu turda henüz `openapi.yaml`'a işlenmedi (integration-agent paralel çalışıyor) — sözleşme
 * mimari §4.4/§12'den alınmıştır, kontrat güncellendiğinde hizalanmalıdır.
 */
export function requestMeetingToken(id: string, accessToken?: string): Promise<MeetingTokenResponse> {
  return apiFetch<MeetingTokenResponse>(`/appointments/${id}/meeting-token`, {
    method: "POST",
    query: { t: accessToken },
  });
}

/** `POST /appointments/{id}/complete` — doktor/ADMIN, integration-agent'ın ucu. */
export function completeAppointment(id: string, accessToken?: string): Promise<Appointment> {
  return apiFetch<Appointment>(`/appointments/${id}/complete`, { method: "POST", query: { t: accessToken } });
}

// ---------- [TCT] §9.7 TADİLAT TURU 2 — çoklu slot booking + ödeme + sağlık verisi ----------

/**
 * `POST /appointments/bookings` — kimlik doğrulama GEREKMEZ, hız sınırı 5 istek/dk. `slots`
 * 1..4 öğe, hepsi AYNI doktora/AYNI takvim gününe ait olmalı (sunucu ayrıca doğrular). Tutar
 * İSTEMCİDEN ASLA kabul edilmez — yanıttaki `totalCents` kanoniktir.
 */
export function createBooking(input: CreateBookingRequest): Promise<CreateBookingResult> {
  return apiFetch<CreateBookingResult>("/appointments/bookings", { method: "POST", body: input });
}

/** `?t=` opak misafir erişim token'ı — oturum sahibi hasta/booking'in doktoru/ADMIN/MANAGER için opsiyoneldir. */
export function getBooking(bookingId: string, accessToken?: string): Promise<AppointmentBooking> {
  return apiFetch<AppointmentBooking>(`/appointments/bookings/${bookingId}`, { query: { t: accessToken } });
}

/**
 * `POST .../checkout-session` (integration-agent'ın ucu) — Stripe Checkout oturumu. Yapılandırılmamışsa
 * `503 PAYMENTS_NOT_CONFIGURED`; booking zaten ödenmiş/süresi dolmuşsa `409 BOOKING_NOT_PAYABLE`/`BOOKING_EXPIRED`.
 */
export function createBookingCheckoutSession(bookingId: string, accessToken?: string): Promise<BookingCheckoutSessionResponse> {
  return apiFetch<BookingCheckoutSessionResponse>(`/appointments/bookings/${bookingId}/checkout-session`, {
    method: "POST",
    query: { t: accessToken },
  });
}

export function cancelBooking(bookingId: string, accessToken?: string, input?: CancelBookingRequest): Promise<AppointmentBooking> {
  return apiFetch<AppointmentBooking>(`/appointments/bookings/${bookingId}/cancel`, {
    method: "POST",
    query: { t: accessToken },
    body: input,
  });
}

/** §9.7.0 madde 11 — "Ödeme Belgesi (bilgi amaçlıdır)", yalnızca `paymentStatus: "PAID"` iken üretilebilir. */
export function getBookingInvoice(bookingId: string, accessToken?: string): Promise<BookingInvoice> {
  return apiFetch<BookingInvoice>(`/appointments/bookings/${bookingId}/invoice`, { query: { t: accessToken } });
}

/** Magic-link'i yeniden gönderir — ham token yanıtta DÖNMEZ, her zaman `202` (varlık sızdırılmaz). Hız sınırı 1/dk. */
export function resendBookingLink(bookingId: string): Promise<void> {
  return apiFetch<void>(`/appointments/bookings/${bookingId}/resend-link`, { method: "POST" });
}

/** §9.7.5 KARAR J — opsiyonel adım, AYRI açık rıza (`healthDataConsent`) ZORUNLU. */
export function upsertBookingIntake(bookingId: string, input: UpsertIntakeRequest, accessToken?: string): Promise<AppointmentIntake> {
  return apiFetch<AppointmentIntake>(`/appointments/bookings/${bookingId}/intake`, {
    method: "PUT",
    query: { t: accessToken },
    body: input,
  });
}

/** Hasta/booking'in doktoru/ADMIN (MANAGER HARİÇ) — her okuma sunucuda denetlenir (audit log). */
export function getBookingIntake(bookingId: string, accessToken?: string): Promise<AppointmentIntake> {
  return apiFetch<AppointmentIntake>(`/appointments/bookings/${bookingId}/intake`, { query: { t: accessToken } });
}

/** KVKK md.11 — not METNİ `null`'lanır, rıza kanıtı denetim bütünlüğü için korunur. */
export function deleteBookingIntake(bookingId: string, accessToken?: string): Promise<void> {
  return apiFetch<void>(`/appointments/bookings/${bookingId}/intake`, { method: "DELETE", query: { t: accessToken } });
}

/**
 * `POST .../documents` — multipart, istek başına 1 dosya, booking başına ≤5, ≤5MB, hız sınırı
 * 10/dk. `onProgress` — native `fetch` ilerleme olayı VERMEZ, bu yüzden `XMLHttpRequest` kullanılır
 * (`.claude/design-notes-telehealth.md` §12.3.4'ün ilerleme çubuğu için); yeni bir HTTP istemci
 * paketi EKLENMEZ (code-quality-agent §9.7.9 notu).
 */
export function uploadBookingDocument(
  bookingId: string,
  file: File,
  options: { accessToken?: string; onProgress?: (percent: number) => void; signal?: AbortSignal } = {}
): Promise<AppointmentDocument> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE_URL}/appointments/bookings/${bookingId}/documents`);
    if (options.accessToken) url.searchParams.set("t", options.accessToken);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url.toString());
    xhr.withCredentials = true;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body: ApiErrorBody & { data?: AppointmentDocument };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { error: { code: "INTERNAL_ERROR", message: "Belge yüklenemedi." } };
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.data) {
        resolve(body.data);
      } else {
        const error = body.error ?? { code: "INTERNAL_ERROR", message: "Belge yüklenemedi." };
        reject(new ApiClientError(xhr.status, error));
      }
    };
    xhr.onerror = () => reject(new ApiClientError(0, { code: "NETWORK_ERROR", message: "Sunucuya ulaşılamadı." }));
    xhr.onabort = () => reject(new ApiClientError(0, { code: "NETWORK_ERROR", message: "Yükleme iptal edildi." }));

    if (options.signal) {
      options.signal.addEventListener("abort", () => xhr.abort());
    }

    const formData = new FormData();
    formData.set("file", file);
    xhr.send(formData);
  });
}

/** Hasta/doktor/ADMIN (MANAGER yalnızca sayıyı — `booking.documentCount` — görebilir, bu listeyi GÖREMEZ). */
export function listBookingDocuments(bookingId: string, accessToken?: string): Promise<AppointmentDocument[]> {
  return apiFetch<AppointmentDocument[]>(`/appointments/bookings/${bookingId}/documents`, { query: { t: accessToken } });
}

/**
 * `GET /appointments/documents/{documentId}/content` düz bir `<a href>` ile AÇILAMAZ — uç yalnızca
 * `Authorization: Bearer` (bellekte tutulan access token, çerez DEĞİL) veya `?t=` ile yetkilendirir;
 * bu yüzden içerik burada BLOB olarak alınıp yeni sekmede açılır (`window.open`) — görsel sonuç
 * (`.claude/design-notes-telehealth.md` §12.5.4 "yeni sekmede açar") DEĞİŞMEZ, yalnızca taşıma
 * mekanizması bu projenin auth modeliyle uyumlu hâle getirilir.
 */
export async function fetchDocumentContentBlob(documentId: string, accessToken?: string): Promise<{ blob: Blob; filename: string | null }> {
  const url = new URL(`${API_BASE_URL}/appointments/documents/${documentId}/content`);
  if (accessToken) url.searchParams.set("t", accessToken);

  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers, credentials: "include" });
  } catch {
    throw new ApiClientError(0, { code: "NETWORK_ERROR", message: "Sunucuya ulaşılamadı." } as never);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = body?.error ?? { code: "NOT_FOUND", message: "Belge bulunamadı." };
    throw new ApiClientError(res.status, error);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]*)"/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? null };
}

export function deleteBookingDocument(documentId: string, accessToken?: string): Promise<void> {
  return apiFetch<void>(`/appointments/documents/${documentId}`, { method: "DELETE", query: { t: accessToken } });
}

// ---------- [TCT] §9.7.7 — Doktor portalı (`/doctor/*`, oturum + 2FA ZORUNLU) ----------

/** `GET /doctor/me` — `403 NOT_A_DOCTOR` (ilişki yok) veya `403 TWO_FACTOR_REQUIRED` (2FA kapalı). */
export function getDoctorPortalProfile(): Promise<DoctorPortalProfile> {
  return apiFetch<DoctorPortalProfile>("/doctor/me");
}

/** `GET /doctor/bookings` — yalnızca oturumun KENDİ `DoctorProfile`'ı (IDOR yüzeyi yok, `doctorId` parametresi YOK). */
export function listDoctorBookings(params: ListDoctorBookingsParams = {}): Promise<Page<AppointmentBooking>> {
  return apiFetchPage<AppointmentBooking>("/doctor/bookings", {
    query: {
      from: params.from,
      to: params.to,
      paymentStatus: params.paymentStatus,
      cursor: params.cursor,
      limit: params.limit ?? 20,
    },
  });
}

// ---------- [TCT] §9.7.7 — Hasta portalı (`/patient/*`, oturum GEREKİR, 2FA GEREKMEZ) ----------

/** `GET /patient/bookings` — oturum sahibi hastanın KENDİ booking'leri. Misafir hasta magic-link'i (`?t=`) kullanır. */
export function listPatientBookings(params: ListPatientBookingsParams = {}): Promise<Page<AppointmentBooking>> {
  return apiFetchPage<AppointmentBooking>("/patient/bookings", {
    query: { cursor: params.cursor, limit: params.limit ?? 20 },
  });
}

// ---------- Admin ----------

export function listAdminSpecialties(): Promise<Specialty[]> {
  return apiFetch<Specialty[]>("/admin/telehealth/specialties");
}

export function createSpecialty(input: CreateSpecialtyRequest): Promise<Specialty> {
  return apiFetch<Specialty>("/admin/telehealth/specialties", { method: "POST", body: input });
}

export function updateSpecialty(specialtyId: string, input: UpdateSpecialtyRequest): Promise<Specialty> {
  return apiFetch<Specialty>(`/admin/telehealth/specialties/${specialtyId}`, { method: "PATCH", body: input });
}

export function deleteSpecialty(specialtyId: string): Promise<void> {
  return apiFetch<void>(`/admin/telehealth/specialties/${specialtyId}`, { method: "DELETE" });
}

export interface ListAdminDoctorsParams {
  specialtyId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export function listAdminDoctors(params: ListAdminDoctorsParams = {}): Promise<Page<DoctorProfile>> {
  return apiFetchPage<DoctorProfile>("/admin/telehealth/doctors", {
    query: { specialtyId: params.specialtyId, search: params.search, cursor: params.cursor, limit: params.limit ?? 100 },
  });
}

export function createDoctor(input: CreateDoctorRequest): Promise<DoctorProfile> {
  return apiFetch<DoctorProfile>("/admin/telehealth/doctors", { method: "POST", body: input });
}

export function getAdminDoctor(doctorId: string): Promise<DoctorProfile> {
  return apiFetch<DoctorProfile>(`/admin/telehealth/doctors/${doctorId}`);
}

export function updateDoctor(doctorId: string, input: UpdateDoctorRequest): Promise<DoctorProfile> {
  return apiFetch<DoctorProfile>(`/admin/telehealth/doctors/${doctorId}`, { method: "PATCH", body: input });
}

/** Kalıcı silme — `Appointment.doctor` `onDelete: Restrict`; geçmiş/gelecek randevusu varsa `409`. */
export function deleteDoctor(doctorId: string): Promise<void> {
  return apiFetch<void>(`/admin/telehealth/doctors/${doctorId}`, { method: "DELETE" });
}

export function getDoctorAvailability(doctorId: string): Promise<DoctorAvailabilityRule[]> {
  return apiFetch<DoctorAvailabilityRule[]>(`/admin/telehealth/doctors/${doctorId}/availability`);
}

/** Haftalık ızgaranın TAMAMINI değiştirir — eski kurallar silinir, yenileri tek seferde yazılır. */
export function setDoctorAvailability(doctorId: string, input: SetDoctorAvailabilityRequest): Promise<DoctorAvailabilityRule[]> {
  return apiFetch<DoctorAvailabilityRule[]>(`/admin/telehealth/doctors/${doctorId}/availability`, { method: "PUT", body: input });
}

export interface ListAdminAppointmentsParams {
  doctorId?: string;
  status?: Appointment["status"];
  search?: string;
  cursor?: string;
  limit?: number;
}

/** `GET /admin/telehealth/appointments` — SALT-OKUNUR, yalnızca ADMIN/MANAGER (§8.4, hasta PII'si). */
export function listAdminAppointments(params: ListAdminAppointmentsParams = {}): Promise<Page<Appointment>> {
  return apiFetchPage<Appointment>("/admin/telehealth/appointments", {
    query: {
      doctorId: params.doctorId,
      status: params.status,
      search: params.search,
      cursor: params.cursor,
      limit: params.limit ?? 50,
    },
  });
}
