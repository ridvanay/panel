import { apiFetch } from "./client";
import type { ContactLanguage, PreferredContactChannel } from "./consultation-requests";
import type { AvailabilitySlot } from "./types";

/**
 * AI İş 3 (hızlı sürüm) — ziyaretçi hizmet görüşmesi (hasta koordinatörüyle ücretsiz görüntülü görüşme) istemcisi.
 * Kontrat: `AI3-HIZLI-KONTRAT.md` "API / Public". Ödeme yok, hesap yok; katılım ve yönetim bağlantıları yalnızca e-postaya gider.
 */

/** `GET /service-consultations/config` (60 sn önbellek). */
export interface ServiceConsultationConfig {
  enabled: boolean;
  timeZone: string;
  durationMin: number;
  minNoticeMin: number;
  horizonDays: number;
}

export interface ServiceSlotsResponse {
  timeZone: string;
  durationMin: number;
  slots: { startsAt: string; endsAt: string }[];
  /** BE isteğe bağlı olarak ekleyebilir (masa diliminde gün durumları); yoksa yok sayılır. */
  days?: { date: string; status: "available" | "full" | "closed" }[];
}

export function getServiceConsultationConfig(): Promise<ServiceConsultationConfig> {
  return apiFetch<ServiceConsultationConfig>("/service-consultations/config", { skipAuthRetry: true });
}

/** `GET /service-consultations/slots?from&to` (aralık en çok 31 gün). Takvimin beklediği biçime (`available: true`) çevrilir. */
export async function getServiceConsultationSlots(from: string, to: string): Promise<AvailabilitySlot[]> {
  const res = await apiFetch<ServiceSlotsResponse>("/service-consultations/slots", { query: { from, to }, skipAuthRetry: true });
  return (res?.slots ?? []).map((slot) => ({ startsAt: slot.startsAt, endsAt: slot.endsAt, available: true }));
}

/** `POST /service-consultations` gövdesi: AH talep gövdesinin alan adları + `startsAt`, `patientTimeZone`, `locale`. */
export interface ServiceConsultationBody {
  /** AH istemcisindeki ad (`serviceSlug`); kontrat metni `specialtySlug` der — ikisi de gönderilir (bkz. `buildServiceConsultationPayload`). */
  serviceSlug: string | null;
  specialtySlug: string | null;
  packageSlug: string | null;
  country: string;
  contactLanguage: ContactLanguage;
  needsInterpreter: boolean;
  /** Tercüman dili (yalnızca `needsInterpreter` iken). */
  interpreterLanguage?: ContactLanguage | null;
  fullName: string;
  email: string;
  phone: string | null;
  preferredContactChannel: PreferredContactChannel | null;
  message: string | null;
  contactConsent: boolean;
  healthDataConsent: boolean;
  locale: string;
  /** Honeypot. */
  website: string;
  startsAt: string;
  patientTimeZone: string;
}

export interface ServiceConsultationCreated {
  consultationNumber: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  joinOpensAt: string;
}

/** AH gövdesine ek olarak randevu alanlarını ekleyip hizmet alanını iki adıyla da yazar. */
export function buildServiceConsultationPayload(input: Omit<ServiceConsultationBody, "specialtySlug">): ServiceConsultationBody {
  return { ...input, specialtySlug: input.serviceSlug };
}

export function createServiceConsultation(body: ServiceConsultationBody): Promise<ServiceConsultationCreated> {
  return apiFetch<ServiceConsultationCreated>("/service-consultations", { method: "POST", body, skipAuthRetry: true });
}

export type ServiceConsultationStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "PENDING_PAYMENT";

export interface ServiceConsultationManageView {
  consultationNumber: string;
  status: ServiceConsultationStatus;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  serviceName: string;
  canCancel: boolean;
  canReschedule: boolean;
}

/** Yönetim belirteci (`sc_…`) yalnızca POST gövdesinde taşınır (URL parçasından okunur; query/path'e yazılmaz). */
export function lookupServiceConsultation(t: string): Promise<ServiceConsultationManageView> {
  return apiFetch<ServiceConsultationManageView>("/service-consultations/manage/lookup", { method: "POST", body: { t }, skipAuthRetry: true });
}

export function cancelServiceConsultation(t: string): Promise<{ status: "CANCELLED" }> {
  return apiFetch<{ status: "CANCELLED" }>("/service-consultations/manage/cancel", { method: "POST", body: { t }, skipAuthRetry: true });
}

export function rescheduleServiceConsultation(input: { t: string; startsAt: string; patientTimeZone: string }): Promise<ServiceConsultationManageView> {
  return apiFetch<ServiceConsultationManageView>("/service-consultations/manage/reschedule", { method: "POST", body: input, skipAuthRetry: true });
}
