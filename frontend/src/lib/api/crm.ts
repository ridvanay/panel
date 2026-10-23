import { apiFetch, apiFetchWithMeta } from "@/lib/api/client";
import { ApiClientError } from "@/lib/api/error";
import { getAccessToken } from "@/lib/api/token-store";
import { API_BASE_URL } from "@/lib/env";
import type { ApiErrorBody } from "@/lib/api/types";

/**
 * Paket N (2026-10-23) — WM CRM admin API istemcisi (`/admin/crm/*`, yalnızca ADMIN + 2FA). Tipler bu
 * dosyada tutulur (CRM kendi içinde kapalı bir modüldür). Panelde gösterilen her serbest metin
 * (sayfa başlığı, öğe metni, kaynak adı) ziyaretçiden gelir — React ile METİN olarak basılır,
 * `dangerouslySetInnerHTML` YASAK.
 */
export interface CrmScoreWeights {
  perEngagedMinute: number;
  perPageview: number;
  perReturnVisit: number;
  bookingPage: number;
  contactClick: number;
  hotThreshold: number;
}

export interface CrmSettings {
  trackingEnabled: boolean;
  trackStaff: boolean;
  ipMode: "masked" | "full";
  excludedIps: string[];
  excludedPaths: string[];
  retentionDays: number;
  leadRetentionDays: number;
  notificationEmail: string | null;
  whatsappRef: boolean;
  scoreWeights: CrmScoreWeights;
  slaHours: number;
  adsConversionName: string;
  adsLeadConversionName: string;
  searchConsole: {
    propertyUrl: string | null;
    connected: boolean;
    clientEmailMasked: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    initialSyncDone: boolean;
  };
}

export type UpdateCrmSettingsRequest = Partial<Omit<CrmSettings, "searchConsole" | "scoreWeights">> & {
  scoreWeights?: Partial<CrmScoreWeights>;
};

export function getCrmSettings(): Promise<CrmSettings> {
  return apiFetch<CrmSettings>("/admin/crm/settings");
}

export function updateCrmSettings(input: UpdateCrmSettingsRequest): Promise<CrmSettings> {
  return apiFetch<CrmSettings>("/admin/crm/settings", { method: "PATCH", body: input });
}

// ---------------------------------------------------------------------------------------------
// N2 — talepler ve hasta yolculuğu
// ---------------------------------------------------------------------------------------------

export type CrmLeadStatus =
  | "NEW"
  | "CALLED"
  | "UNREACHABLE"
  | "APPOINTMENT_GIVEN"
  | "CONSULTED"
  | "TREATMENT_PLANNED"
  | "TREATED"
  | "NEGATIVE"
  | "SPAM";

export type CrmLeadChannel = "CONTACT_FORM" | "LIVE_CHAT" | "WHATSAPP" | "PHONE" | "EMAIL" | "BOOKING_ABANDONED" | "MANUAL" | "ADS_IMPORT";

export const CRM_LEAD_STATUS_OPTIONS: { value: CrmLeadStatus; label: string }[] = [
  { value: "NEW", label: "Yeni" },
  { value: "CALLED", label: "Arandı" },
  { value: "UNREACHABLE", label: "Ulaşılamadı" },
  { value: "APPOINTMENT_GIVEN", label: "Randevu Verildi" },
  { value: "CONSULTED", label: "Görüşme Yapıldı" },
  { value: "TREATMENT_PLANNED", label: "Tedavi Planlandı" },
  { value: "TREATED", label: "Tedavi Oldu" },
  { value: "NEGATIVE", label: "Olumsuz" },
  { value: "SPAM", label: "Test/Spam" },
];

export const CRM_LEAD_CHANNEL_OPTIONS: { value: CrmLeadChannel; label: string }[] = [
  { value: "CONTACT_FORM", label: "İletişim formu" },
  { value: "LIVE_CHAT", label: "Canlı destek" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "PHONE", label: "Telefon" },
  { value: "EMAIL", label: "E-posta" },
  { value: "BOOKING_ABANDONED", label: "Yarım kalan randevu" },
  { value: "MANUAL", label: "Manuel" },
  { value: "ADS_IMPORT", label: "Google Ads" },
];

export const leadStatusLabel = (s: CrmLeadStatus) => CRM_LEAD_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
export const leadChannelLabel = (c: CrmLeadChannel) => CRM_LEAD_CHANNEL_OPTIONS.find((o) => o.value === c)?.label ?? c;

export interface CrmLead {
  id: string;
  seq: number;
  channel: CrmLeadChannel;
  status: CrmLeadStatus;
  candidate: boolean;
  name: string | null;
  phone: string | null;
  email: string | null;
  country: string | null;
  language: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPath: string | null;
  refCode: string | null;
  gclid: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  firstResponseAt: string | null;
  nextActionAt: string | null;
  statusChangedAt: string;
  bookingId: string | null;
  visitorId: string | null;
  anonymizedAt: string | null;
  createdAt: string;
  sla: { state: "met" | "late" | "pending" | "breached"; minutes: number };
}

export interface CrmLeadNote {
  id: string;
  kind: "NOTE" | "STATUS" | "SYSTEM";
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface CrmBookingSuggestion {
  id: string;
  bookingNumber: string;
  createdAt: string;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  doctorName: string;
  reason: string;
}

export interface CrmLeadDetail extends CrmLead {
  notes: CrmLeadNote[];
  bookingSuggestions: CrmBookingSuggestion[];
  linkedBooking: { id: string; bookingNumber: string; paymentStatus: string; totalCents: number; currency: string; createdAt: string } | null;
}

export interface CrmVisitorCandidate {
  id: string;
  lastSeenAt: string;
  country: string | null;
  deviceType: string;
  score: number;
  refCode: string | null;
  firstSource: string | null;
  reason: string;
}

export interface CrmLeadListQuery {
  status?: string;
  channel?: string;
  q?: string;
  candidate?: "true" | "false" | "all";
  assignedToId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface CrmLeadListMeta {
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<CrmLeadStatus, number>;
}

export async function listCrmLeads(query: CrmLeadListQuery): Promise<{ items: CrmLead[]; meta: CrmLeadListMeta }> {
  const { data, meta } = await apiFetchWithMeta<CrmLead[]>("/admin/crm/leads", { query: { ...query } });
  return { items: data, meta: meta as unknown as CrmLeadListMeta };
}

export const listTodayCrmLeads = () => apiFetch<CrmLead[]>("/admin/crm/leads/today");
export const listCrmAssignees = () => apiFetch<{ id: string; name: string }[]>("/admin/crm/leads/assignees");
export const getCrmLead = (id: string) => apiFetch<CrmLeadDetail>(`/admin/crm/leads/${id}`);
export const getCrmLeadVisitorCandidates = (id: string) => apiFetch<CrmVisitorCandidate[]>(`/admin/crm/leads/${id}/visitor-candidates`);
export const syncCrmLeads = () => apiFetch<{ created: number }>("/admin/crm/leads/sync", { method: "POST" });

export interface CreateCrmLeadInput {
  channel?: CrmLeadChannel;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  country?: string | null;
  language?: string | null;
  source?: string | null;
  campaign?: string | null;
  visitorId?: string | null;
  note?: string;
}

export const createCrmLead = (input: CreateCrmLeadInput) => apiFetch<CrmLead>("/admin/crm/leads", { method: "POST", body: input });

export interface UpdateCrmLeadInput {
  status?: CrmLeadStatus;
  assignedToId?: string | null;
  nextActionAt?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  country?: string | null;
  language?: string | null;
  bookingId?: string | null;
  visitorId?: string | null;
  candidate?: boolean;
}

export const updateCrmLead = (id: string, input: UpdateCrmLeadInput) => apiFetch<CrmLead>(`/admin/crm/leads/${id}`, { method: "PATCH", body: input });
export const addCrmLeadNote = (id: string, body: string) => apiFetch<CrmLeadNote>(`/admin/crm/leads/${id}/notes`, { method: "POST", body: { body } });
export const bulkUpdateCrmLeadStatus = (ids: string[], status: CrmLeadStatus) =>
  apiFetch<{ updated: number }>("/admin/crm/leads/bulk-status", { method: "POST", body: { ids, status } });
export const deleteCrmLead = (id: string) => apiFetch<void>(`/admin/crm/leads/${id}`, { method: "DELETE" });

/** JSON olmayan CRM indirmeleri (CSV) — `reports.ts::downloadExportJob` deseni. */
export async function downloadCrmFile(path: string, query: Record<string, string | undefined>, filename: string): Promise<void> {
  const requestId = crypto.randomUUID();
  const token = getAccessToken();
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "x-request-id": requestId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "include",
    });
  } catch {
    throw new ApiClientError(0, { code: "NETWORK_ERROR", message: "Sunucuya ulaşılamadı." }, requestId);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiClientError(res.status, body?.error ?? { code: "INTERNAL_ERROR" as const, message: "Dosya indirilemedi." }, requestId);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export interface CrmFunnelRow {
  key: string;
  label: string;
  visits: number;
  doctorPage: number;
  bookingStarted: number;
  bookings: number;
  paid: number;
  consulted: number;
  revenue: Record<string, number>;
  conversionRate: number;
}

export type CrmFunnelGroupBy = "none" | "source" | "campaign" | "country" | "language" | "device" | "doctor";

export const getCrmFunnel = (query: { from: string; to: string; model: "first" | "last"; groupBy: CrmFunnelGroupBy }) =>
  apiFetch<{ rows: CrmFunnelRow[]; total: CrmFunnelRow }>("/admin/crm/funnel", { query: { ...query } });
