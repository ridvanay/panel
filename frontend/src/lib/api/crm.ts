import { apiFetch, apiFetchWithMeta, refreshAccessToken } from "@/lib/api/client";
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
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value);
  const send = (token: string | null) =>
    fetch(url.toString(), {
      headers: { "x-request-id": requestId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "include",
    });
  let res: Response;
  try {
    res = await send(getAccessToken());
    // `apiFetch` ile aynı davranış: erişim belirteci süresi dolmuşsa bir kez yenilenip tekrar denenir.
    if (res.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) res = await send(refreshed);
    }
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

// ---------------------------------------------------------------------------------------------
// N3 — analitik ekranları
// ---------------------------------------------------------------------------------------------

export interface CrmRange {
  from: string;
  to: string;
}

export interface CrmPageRow {
  path: string;
  pageviews: number;
  visitors: number;
  entries: number;
  contacts: number;
  clicks: number;
  avgEngagedSeconds: number;
  avgScrollPct: number | null;
}

export interface CrmSourceRow {
  source: string;
  medium: string;
  campaign: string | null;
  sessions: number;
  visitors: number;
  pageviews?: number;
  entries?: number;
  contacts: number;
  bookingsStarted: number;
}

export interface CrmClickRow {
  path: string;
  selector: string | null;
  text: string | null;
  target: string | null;
  clicks: number;
  contacts: number;
  visitors: number;
  whatsappClicks?: number;
  phoneClicks?: number;
  emailClicks?: number;
}

export interface CrmVisitorRow {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  country: string | null;
  language: string | null;
  deviceType: string;
  sessionCount: number;
  pageviewCount: number;
  engagedSeconds: number;
  contactClicks: number;
  reachedBooking: boolean;
  score: number;
  refCode: string | null;
  firstSource: string | null;
  firstMedium: string | null;
  firstCampaign: string | null;
}

export interface CrmOverview {
  kpis: {
    liveNow: number;
    visitors: number;
    pageviews: number;
    whatsappClicks: number;
    phoneClicks: number;
    emailClicks: number;
    leads: number;
    conversionRate: number;
  };
  series: { date: string; visitors: number; pageviews: number; contacts: number }[];
  sources: CrmSourceRow[];
  contactPages: CrmPageRow[];
  entryPages: CrmPageRow[];
  prePages: { path: string; sessions: number; visitors: number }[];
  topClicks: CrmClickRow[];
  recentLeads: { id: string; seq: number; name: string | null; channel: CrmLeadChannel; status: CrmLeadStatus; createdAt: string }[];
  hotVisitors: CrmVisitorRow[];
  hotThreshold: number;
}

export interface CrmLiveSession {
  visitorId: string;
  currentPath: string;
  landingPath: string;
  country: string | null;
  city: string | null;
  deviceType: string;
  browser: string | null;
  os: string | null;
  source: string;
  medium: string;
  campaign: string | null;
  pageCount: number;
  durationSeconds: number;
  startedAt: string;
  lastSeenAt: string;
  score: number;
  returning: boolean;
  refCode: string | null;
}

export interface CrmVisitorEvent {
  id: string;
  sessionId: string;
  type: string;
  occurredAt: string;
  path: string;
  title: string | null;
  text: string | null;
  target: string | null;
  name: string | null;
  scrollPct: number | null;
  step: number | null;
  isRage: boolean;
  isDead: boolean;
}

export interface CrmVisitorDetail extends CrmVisitorRow {
  timezone: string | null;
  firstReferrerHost: string | null;
  firstLandingPath: string | null;
  sessions: {
    id: string;
    startedAt: string;
    lastSeenAt: string;
    source: string;
    medium: string;
    campaign: string | null;
    referrerHost: string | null;
    landingPath: string;
    exitPath: string | null;
    pageCount: number;
    durationSeconds: number;
    country: string | null;
    city: string | null;
    ip: string | null;
    deviceType: string;
    browser: string | null;
    os: string | null;
    hasAdClickId: boolean;
    bookingStarted: boolean;
  }[];
  events: CrmVisitorEvent[];
  leads: { id: string; seq: number; name: string | null; status: CrmLeadStatus; channel: CrmLeadChannel }[];
}

export interface CrmAudienceRow {
  key: string;
  label: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  contacts: number;
  bookingsStarted: number;
}

export interface CrmAudience {
  countries: CrmAudienceRow[];
  languages: CrmAudienceRow[];
  timezones: CrmAudienceRow[];
  devices: CrmAudienceRow[];
  doctors: CrmAudienceRow[];
  specialties: CrmAudienceRow[];
}

export interface CrmHeatmap {
  pageviews: number;
  clickCount: number;
  rageClicks: number;
  deadClicks: number;
  medianDocHeight: number | null;
  points: { x: number; y: number; ex: number | null; ey: number | null; sel: string | null; rage: boolean; dead: boolean }[];
  scrollReach: { depth: number; pct: number }[];
  scrollSamples: number;
  likelyClickable: { selector: string; count: number; text: string | null }[];
  rageTargets: { selector: string; count: number; text: string | null }[];
}

export const getCrmOverview = (range: CrmRange) => apiFetch<CrmOverview>("/admin/crm/analytics/overview", { query: { ...range } });
export const getCrmLive = () => apiFetch<CrmLiveSession[]>("/admin/crm/analytics/live");
export const getCrmPages = (range: CrmRange) => apiFetch<CrmPageRow[]>("/admin/crm/analytics/pages", { query: { ...range } });
export const getCrmSources = (range: CrmRange) => apiFetch<CrmSourceRow[]>("/admin/crm/analytics/sources", { query: { ...range } });
export const getCrmAudience = (range: CrmRange) => apiFetch<CrmAudience>("/admin/crm/analytics/audience", { query: { ...range } });
export const getCrmClicks = (range: CrmRange & { path?: string }) => apiFetch<CrmClickRow[]>("/admin/crm/analytics/clicks", { query: { ...range } });
export const getCrmHeatmapPages = (range: CrmRange) =>
  apiFetch<{ path: string; pageviews: number; clicks: number }[]>("/admin/crm/analytics/heatmap/pages", { query: { ...range } });
export const getCrmHeatmap = (query: CrmRange & { path: string; device: "mobile" | "desktop" }) =>
  apiFetch<CrmHeatmap>("/admin/crm/analytics/heatmap", { query: { ...query } });

export async function listCrmVisitors(query: { q?: string; hot?: "true" | "false"; page?: number; pageSize?: number }) {
  const { data, meta } = await apiFetchWithMeta<CrmVisitorRow[]>("/admin/crm/visitors", { query: { ...query } });
  return { items: data, meta: meta as unknown as { total: number; page: number; pageSize: number; hotThreshold: number } };
}

export const getCrmVisitor = (id: string) => apiFetch<CrmVisitorDetail>(`/admin/crm/visitors/${encodeURIComponent(id)}`);

export const CRM_EVENT_LABELS: Record<string, string> = {
  PAGEVIEW: "Sayfa",
  CLICK: "Tıklama",
  SCROLL: "Kaydırma",
  WHATSAPP_CLICK: "WhatsApp",
  PHONE_CLICK: "Telefon",
  EMAIL_CLICK: "E-posta",
  FORM_SUBMIT: "Form gönderimi",
  BOOKING_STEP: "Randevu adımı",
  BOOKING_COMPLETED: "Randevu oluştu",
  CUSTOM: "Özel olay",
};

export const CRM_DEVICE_LABELS: Record<string, string> = { DESKTOP: "Masaüstü", MOBILE: "Mobil", TABLET: "Tablet", UNKNOWN: "Bilinmiyor" };

// ---------------------------------------------------------------------------------------------
// N4 — Google entegrasyonları
// ---------------------------------------------------------------------------------------------

export type KeywordGroup = "1-3" | "4-10" | "11-20" | "21+";

export interface CrmKeywordRow {
  query: string;
  position: number;
  /** Önceki eşit uzunluktaki döneme göre; pozitif = sıralama yükseldi. */
  change: number | null;
  clicks: number;
  impressions: number;
  ctr: number;
  bestPage: string | null;
  group: KeywordGroup;
}

export interface CrmKeywordsReport {
  connection: { connected: boolean; propertyUrl: string | null; lastSyncAt: string | null; lastSyncError: string | null };
  rows: CrmKeywordRow[];
  groups: Record<KeywordGroup, number>;
  total: number;
  previousRange: { from: string; to: string };
}

export const getCrmKeywords = (query: { from: string; to: string; group?: "all" | KeywordGroup; q?: string }) =>
  apiFetch<CrmKeywordsReport>("/admin/crm/keywords", { query: { ...query } });

export const connectSearchConsole = (input: { propertyUrl: string; credentialsJson: string }) =>
  apiFetch<CrmSettings>("/admin/crm/search-console/connect", { method: "POST", body: input });
export const disconnectSearchConsole = () => apiFetch<CrmSettings>("/admin/crm/search-console/connect", { method: "DELETE" });
export const syncSearchConsole = () =>
  apiFetch<{ ok: boolean; from: string | null; to: string | null; rows: number; error: string | null }>("/admin/crm/search-console/sync", { method: "POST" });

export const importAdsLeads = (csv: string) =>
  apiFetch<{ created: number; skipped: number; errors: string[] }>("/admin/crm/ads/import-leads", { method: "POST", body: { csv } });

export const downloadAdsConversions = (range: CrmRange) =>
  downloadCrmFile("/admin/crm/ads/conversions", { from: range.from, to: range.to }, `google-ads-donusumler-${range.from}_${range.to}.csv`);
