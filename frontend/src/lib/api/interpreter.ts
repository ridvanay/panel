import { API_BASE_URL } from "../env";
import { getAccessToken } from "./token-store";
import { apiFetch } from "./client";
import type {
  AdminInterpreter,
  AppointmentInterpreterInfo,
  BookingInterpreterState,
  InterpreterAssignment,
  InterpreterConfidentialityText,
  InterpreterMe,
  InterpreterReportRow,
  InterpreterSettings,
  InterpreterTokenResponse,
  InterpreterUserSearchResult,
} from "./types";

/** Paket AA — tercümanın kendi uçları (yalnızca INTERPRETER). */
export function getInterpreterMe(): Promise<InterpreterMe> {
  return apiFetch<InterpreterMe>("/interpreter/me");
}

/** Paket AA-ek — hesap menüsündeki "Tercüman paneli" bağlantısı için (her oturumlu kullanıcı). */
export function getInterpreterAccess(): Promise<{ hasProfile: boolean }> {
  return apiFetch<{ hasProfile: boolean }>("/interpreter/access");
}

export function acceptInterpreterConfidentiality(version: string): Promise<void> {
  return apiFetch<void>("/interpreter/confidentiality/accept", { method: "POST", body: { version } });
}

export function listInterpreterAssignments(): Promise<InterpreterAssignment[]> {
  return apiFetch<InterpreterAssignment[]>("/interpreter/assignments");
}

export function requestInterpreterToken(assignmentId: string): Promise<InterpreterTokenResponse> {
  return apiFetch<InterpreterTokenResponse>(`/interpreter/assignments/${encodeURIComponent(assignmentId)}/meeting-token`, { method: "POST" });
}

export function leaveInterpreterSession(assignmentId: string): Promise<void> {
  return apiFetch<void>(`/interpreter/assignments/${encodeURIComponent(assignmentId)}/leave`, { method: "POST" });
}

/** Sekme kapanırken ayrılış kaydı (`keepalive`) — yanıt beklenmez. */
export function leaveInterpreterSessionOnUnload(assignmentId: string): void {
  const token = getAccessToken();
  void fetch(`${API_BASE_URL}/interpreter/assignments/${encodeURIComponent(assignmentId)}/leave`, {
    method: "POST",
    keepalive: true,
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {});
}

export function getInterpreterRecordingStatus(assignmentId: string): Promise<{ status: string | null }> {
  return apiFetch<{ status: string | null }>(`/interpreter/assignments/${encodeURIComponent(assignmentId)}/recording-status`);
}

/** Hasta/doktor — görüşmeye atanmış tercüman (yoksa `null`). */
export function getAppointmentInterpreter(appointmentId: string, accessToken?: string): Promise<AppointmentInterpreterInfo | null> {
  return apiFetch<AppointmentInterpreterInfo | null>(`/appointments/${encodeURIComponent(appointmentId)}/interpreter`, { query: { t: accessToken } });
}

/** Doktor — tercümanı görüşmeden çıkarır. */
export function removeAppointmentInterpreter(appointmentId: string): Promise<void> {
  return apiFetch<void>(`/appointments/${encodeURIComponent(appointmentId)}/interpreter/remove`, { method: "POST" });
}

/** Hasta — randevu sihirbazındaki "ücretsiz tercüman istiyorum" talebi (`null` talebi kaldırır). */
export function setInterpreterRequest(bookingId: string, language: string | null, accessToken?: string): Promise<void> {
  return apiFetch<void>(`/appointments/bookings/${encodeURIComponent(bookingId)}/interpreter-request`, {
    method: "PUT",
    body: { language },
    query: { t: accessToken },
  });
}

// ---- Admin ----
export function listAdminInterpreters(): Promise<AdminInterpreter[]> {
  return apiFetch<AdminInterpreter[]>("/admin/telehealth/interpreters");
}

export function createAdminInterpreter(input: {
  name: string;
  email: string;
  displayName?: string;
  languages: string[];
  timeZone?: string;
  notes?: string;
}): Promise<{ interpreter: AdminInterpreter; emailStatus: "sent" | "failed" }> {
  return apiFetch("/admin/telehealth/interpreters", { method: "POST", body: input });
}

export function updateAdminInterpreter(
  id: string,
  input: { displayName?: string; languages?: string[]; timeZone?: string; isActive?: boolean; notes?: string | null }
): Promise<AdminInterpreter> {
  return apiFetch<AdminInterpreter>(`/admin/telehealth/interpreters/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function resendInterpreterInvite(id: string): Promise<{ emailStatus: "sent" | "failed" }> {
  return apiFetch(`/admin/telehealth/interpreters/${encodeURIComponent(id)}/resend-invite`, { method: "POST" });
}

export function getInterpreterReport(from: string, to: string): Promise<InterpreterReportRow[]> {
  return apiFetch<InterpreterReportRow[]>("/admin/telehealth/interpreters/report", { query: { from, to } });
}

/** CSV — tarayıcıda indirme için yetkili istekle alınır. */
export async function downloadInterpreterReportCsv(from: string, to: string): Promise<Blob> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/interpreters/report?from=${from}&to=${to}&format=csv`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`CSV indirilemedi (${res.status}).`);
  return res.blob();
}

export function getInterpreterConfidentialityText(): Promise<InterpreterConfidentialityText> {
  return apiFetch<InterpreterConfidentialityText>("/admin/telehealth/interpreters/confidentiality-text");
}

export function updateInterpreterConfidentialityText(input: { en: string; tr: string }): Promise<InterpreterConfidentialityText> {
  return apiFetch<InterpreterConfidentialityText>("/admin/telehealth/interpreters/confidentiality-text", { method: "PUT", body: input });
}

export function getBookingInterpreter(bookingId: string, language?: string): Promise<BookingInterpreterState> {
  return apiFetch<BookingInterpreterState>(`/admin/telehealth/bookings/${encodeURIComponent(bookingId)}/interpreter`, { query: { language } });
}

export function assignBookingInterpreter(bookingId: string, interpreterId: string, language: string): Promise<BookingInterpreterState> {
  return apiFetch<BookingInterpreterState>(`/admin/telehealth/bookings/${encodeURIComponent(bookingId)}/interpreter`, {
    method: "POST",
    body: { interpreterId, language },
  });
}

export function unassignBookingInterpreter(bookingId: string, reason?: string): Promise<BookingInterpreterState> {
  return apiFetch<BookingInterpreterState>(`/admin/telehealth/bookings/${encodeURIComponent(bookingId)}/interpreter`, {
    method: "DELETE",
    body: reason ? { reason } : {},
  });
}

/** Paket AA-ek — var olan kullanıcıya tercümanlık yetkisi. */
export function searchUsersForInterpreter(q: string): Promise<InterpreterUserSearchResult[]> {
  return apiFetch<InterpreterUserSearchResult[]>("/admin/telehealth/interpreters/user-search", { query: { q } });
}

export function createInterpreterFromUser(input: {
  userId: string;
  displayName?: string;
  languages: string[];
  timeZone?: string;
  notes?: string;
}): Promise<{ interpreter: AdminInterpreter; existing: boolean; emailStatus?: "sent" | "failed" }> {
  return apiFetch("/admin/telehealth/interpreters/from-user", { method: "POST", body: input });
}

export function getInterpreterSettings(): Promise<InterpreterSettings> {
  return apiFetch<InterpreterSettings>("/admin/telehealth/interpreters/settings");
}

export function updateInterpreterSettings(input: InterpreterSettings): Promise<InterpreterSettings> {
  return apiFetch<InterpreterSettings>("/admin/telehealth/interpreters/settings", { method: "PUT", body: input });
}
