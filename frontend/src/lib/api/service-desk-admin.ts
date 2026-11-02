import { apiFetch, apiFetchWithMeta } from "./client";
import type { MeetingTokenResponse } from "./types";

/**
 * AI İş 3 hızlı sürüm — Hizmet Masası admin + koordinatör uçları (kontrat: scratchpad/AI3-HIZLI-KONTRAT.md "API").
 * Zarf `{ success, data, error, meta }`; `apiFetch` `data`'yı açar. Kişisel veri YALNIZCA koordinatör uçlarında
 * ve yalnızca kendi görüşmeleri için döner; admin listesi hasta adını baş harfli verir.
 */

// ---- Ortak tipler ----

export type ServiceConsultationStatus = "PENDING_PAYMENT" | "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export type PreferredChannel = "email" | "whatsapp" | "phone";

/** Hizmet masası dilleri (8 site dili; `tr` ziyaretçiye kapalı olduğundan koordinatör dili olarak seçilmez). */
export const COORDINATOR_LANGUAGES = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
export type CoordinatorLanguage = (typeof COORDINATOR_LANGUAGES)[number];

// ---- Admin: masa ----

export interface ServiceDesk {
  name?: string;
  timeZone: string;
  durationMin: number;
  minNoticeMin: number;
  horizonDays: number;
  maxParticipants?: number;
  /** Bu sürümde hep `false`; `true` göndermek 422 `PAID_CONSULTATIONS_DISABLED` döner. */
  paidEnabled: boolean;
}

export interface ServiceDeskHour {
  /** ISO 1 (Pzt) … 7 (Paz), masa diliminde. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface ServiceDeskClosure {
  id: string;
  /** `YYYY-MM-DD` (masa diliminde tam gün). */
  date: string;
  /** İç not; sağlık verisi yazılmaz. */
  note: string | null;
  createdAt?: string;
}

export interface ServiceDeskOverview {
  desk: ServiceDesk;
  serviceBookingEnabled: boolean;
  hours: ServiceDeskHour[];
  closures: ServiceDeskClosure[];
  stats: { activeCoordinators: number; next7DaysSlots: number };
}

export interface UpdateServiceDeskInput {
  durationMin?: number;
  minNoticeMin?: number;
  horizonDays?: number;
  timeZone?: string;
  /** Yalnızca ADMIN. */
  serviceBookingEnabled?: boolean;
}

export function getServiceDesk(): Promise<ServiceDeskOverview> {
  return apiFetch<ServiceDeskOverview>("/admin/service-desk");
}

export function updateServiceDesk(input: UpdateServiceDeskInput): Promise<Partial<ServiceDeskOverview> | undefined> {
  return apiFetch<Partial<ServiceDeskOverview> | undefined>("/admin/service-desk", { method: "PATCH", body: input });
}

/** `PUT /admin/service-desk/hours` — TAM liste gönderilir (gövde `{ hours }`); sunucu çakışmayı doğrular. */
export async function setServiceDeskHours(hours: ServiceDeskHour[]): Promise<ServiceDeskHour[]> {
  const data = await apiFetch<ServiceDeskHour[] | { hours: ServiceDeskHour[] } | undefined>("/admin/service-desk/hours", {
    method: "PUT",
    body: { hours },
  });
  if (Array.isArray(data)) return data;
  return data?.hours ?? hours;
}

export function createClosure(input: { date: string; note?: string }): Promise<ServiceDeskClosure> {
  return apiFetch<ServiceDeskClosure>("/admin/service-desk/closures", { method: "POST", body: input });
}

export function deleteClosure(id: string): Promise<void> {
  return apiFetch<void>(`/admin/service-desk/closures/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Admin: koordinatörler ----

export interface Coordinator {
  id: string;
  userId: string;
  displayName: string;
  languages: string[];
  isActive: boolean;
  lastAssignedAt?: string | null;
  /** Kullanıcı e-postası/adı (panel hesabı); iç kullanım. */
  user?: { name?: string | null; email?: string | null; role?: string } | null;
  upcomingCount?: number;
}

export interface CoordinatorCandidate {
  id: string;
  name: string;
  email: string;
  role: "EDITOR" | "MANAGER" | string;
}

export function listCoordinators(): Promise<Coordinator[]> {
  return apiFetch<Coordinator[]>("/admin/service-desk/coordinators");
}

export function listCoordinatorCandidates(): Promise<CoordinatorCandidate[]> {
  return apiFetch<CoordinatorCandidate[]>("/admin/service-desk/coordinator-candidates");
}

export function createCoordinator(input: { userId: string; displayName?: string; languages: string[] }): Promise<Coordinator> {
  return apiFetch<Coordinator>("/admin/service-desk/coordinators", { method: "POST", body: input });
}

export function updateCoordinator(
  id: string,
  input: { displayName?: string; languages?: string[]; isActive?: boolean }
): Promise<Coordinator> {
  return apiFetch<Coordinator>(`/admin/service-desk/coordinators/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

// ---- Admin: görüşmeler ----

export interface AdminServiceConsultation {
  id: string;
  consultationNumber: string;
  startsAt: string;
  endsAt: string;
  status: ServiceConsultationStatus;
  serviceName: string;
  /** Yalnızca baş harfli ("Z. Y."). */
  patientName: string;
  contactLanguage: string;
  needsInterpreter: boolean;
  interpreterLanguage: string | null;
  coordinatorName: string | null;
  country?: string | null;
  patientTimeZone?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
}

export interface ListAdminConsultationsParams {
  from?: string;
  to?: string;
  status?: ServiceConsultationStatus | "";
  page?: number;
}

export interface AdminConsultationsPage {
  items: AdminServiceConsultation[];
  page: number;
  hasNext: boolean;
}

export const ADMIN_CONSULTATIONS_PAGE_SIZE = 20;

export async function listAdminConsultations(params: ListAdminConsultationsParams = {}): Promise<AdminConsultationsPage> {
  const page = params.page ?? 1;
  const { data, meta } = await apiFetchWithMeta<AdminServiceConsultation[]>("/admin/service-desk/consultations", {
    query: { from: params.from || undefined, to: params.to || undefined, status: params.status || undefined, page },
  });
  const items = Array.isArray(data) ? data : [];
  const m = meta as unknown as Record<string, unknown>;
  const totalPages = typeof m.totalPages === "number" ? m.totalPages : typeof m.pageCount === "number" ? m.pageCount : null;
  const hasNext =
    typeof m.hasNext === "boolean" ? m.hasNext : typeof m.hasMore === "boolean" ? m.hasMore : totalPages !== null ? page < totalPages : items.length >= ADMIN_CONSULTATIONS_PAGE_SIZE;
  return { items, page, hasNext };
}

export function getAdminConsultation(id: string): Promise<AdminServiceConsultation> {
  return apiFetch<AdminServiceConsultation>(`/admin/service-desk/consultations/${encodeURIComponent(id)}`);
}

export function cancelAdminConsultation(id: string, reason?: string): Promise<{ status: ServiceConsultationStatus } | undefined> {
  return apiFetch<{ status: ServiceConsultationStatus } | undefined>(`/admin/service-desk/consultations/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

// ---- Koordinatör ----

export interface CoordinatorConsultation {
  id: string;
  consultationNumber: string;
  startsAt: string;
  endsAt: string;
  status: ServiceConsultationStatus;
  serviceName: string;
  patientName: string;
  country: string | null;
  contactLanguage: string;
  needsInterpreter: boolean;
  interpreterLanguage: string | null;
  preferredContactChannel: PreferredChannel | null;
  hasMessage: boolean;
  joinOpensAt: string;
  canJoin: boolean;
  /** Hastanın saat dilimi (varsa; satırda ikinci saat için). */
  patientTimeZone?: string | null;
}

export interface CoordinatorConsultationDetail extends CoordinatorConsultation {
  email: string;
  phone: string | null;
}

export function listCoordinatorConsultations(scope: "today" | "upcoming"): Promise<CoordinatorConsultation[]> {
  return apiFetch<CoordinatorConsultation[]>("/coordinator/consultations", { query: { scope } });
}

export function getCoordinatorConsultation(id: string): Promise<CoordinatorConsultationDetail> {
  return apiFetch<CoordinatorConsultationDetail>(`/coordinator/consultations/${encodeURIComponent(id)}`);
}

/** 2FA kapalıysa 403 `TWO_FACTOR_REQUIRED`; her çağrı audit'e yazılır (`cache-control: no-store`). */
export function getCoordinatorConsultationMessage(id: string): Promise<{ message: string | null }> {
  return apiFetch<{ message: string | null }>(`/coordinator/consultations/${encodeURIComponent(id)}/message`);
}

/** AG `POST /meetings/:id/host-token` ile AYNI yanıt biçimi. */
export function requestCoordinatorHostToken(id: string): Promise<MeetingTokenResponse> {
  return apiFetch<MeetingTokenResponse>(`/coordinator/consultations/${encodeURIComponent(id)}/host-token`, { method: "POST" });
}
