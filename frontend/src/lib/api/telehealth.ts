import { apiFetch, apiFetchPage } from "./client";
import type {
  Appointment,
  AvailabilitySlot,
  CreateAppointmentRequest,
  CreateAppointmentResult,
  CreateDoctorRequest,
  CreateSpecialtyRequest,
  DoctorAvailabilityRule,
  DoctorProfile,
  MeetingTokenResponse,
  Page,
  SetDoctorAvailabilityRequest,
  Specialty,
  UpdateDoctorRequest,
  UpdateSpecialtyRequest,
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
