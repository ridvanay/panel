import { apiFetch } from "./client";

/** Paket W — "Find my physician" (herkese açık uçlar + admin). Kişisel veri YALNIZCA `submitMatcher`'da gider. */
export type MatcherBodyArea =
  | "head"
  | "neck-spine"
  | "chest"
  | "abdomen"
  | "pelvis-urology"
  | "women"
  | "skin-aesthetic"
  | "dental"
  | "joints-bones"
  | "general-checkup"
  | "cancer"
  | "mental-wellbeing"
  | "other";

export const MATCHER_BODY_AREAS: MatcherBodyArea[] = [
  "head",
  "neck-spine",
  "chest",
  "abdomen",
  "pelvis-urology",
  "women",
  "skin-aesthetic",
  "dental",
  "joints-bones",
  "general-checkup",
  "cancer",
  "mental-wellbeing",
  "other",
];

export interface MatcherTopic {
  id: string;
  slug: string;
  bodyArea: MatcherBodyArea;
  isRedFlag: boolean;
  label: string;
  description: string;
  synonyms: string[];
}

export interface MatcherCatalog {
  contactRequired: boolean;
  topics: MatcherTopic[];
}

export type MatcherPreference = "online" | "in_person" | "either";
export type MatcherDuration = "lt1w" | "1to4w" | "1to6m" | "gt6m";
export type MatcherPriorDiagnosis = "yes" | "no" | "unknown";

export interface MatcherDoctor {
  id: string;
  slug: string;
  displayName: string;
  title: string;
  avatarUrl: string | null;
  specialtyName: string | null;
  languages: string[];
  primaryMatch: boolean;
  speaksLanguage: boolean;
  slots: { startsAt: string; endsAt: string }[];
}

export interface MatcherRecommendation {
  redFlag: boolean;
  redFlagTopicSlugs: string[];
  coordinator: boolean;
  interpreterIncluded: boolean;
  topicSlugs: string[];
  specialties: { id: string; slug: string; name: string; description: string | null; score: number }[];
  doctors: MatcherDoctor[];
}

export interface MatcherSubmitInput {
  website?: string;
  locale: string;
  name: string;
  age?: number;
  birthYear?: number;
  guardianName?: string;
  email?: string;
  phoneCountry?: string;
  phoneNumber?: string;
  country?: string;
  timeZone?: string;
  forWhom: "self" | "relative";
  duration?: MatcherDuration;
  priorDiagnosis?: MatcherPriorDiagnosis;
  preference: MatcherPreference;
  preferredLanguage: string;
  topicIds: string[];
  freeText?: string;
  redFlagAcknowledged: boolean;
  consentHealth: boolean;
  consentContact: boolean;
  callback?: boolean;
}

export type MatcherStep = "1" | "2" | "3" | "4" | "5" | "red_flag" | "red_flag_continue" | "no_match";

export function getMatcherCatalog(lang: string): Promise<MatcherCatalog> {
  return apiFetch<MatcherCatalog>("/matcher/topics", { query: { lang } });
}

export function recommendPhysicians(input: { topicIds: string[]; preferredLanguage: string; locale: string; preference?: MatcherPreference }): Promise<MatcherRecommendation> {
  return apiFetch<MatcherRecommendation>("/matcher/recommend", { method: "POST", body: input });
}

/** Anonim adım sayacı — hata sessizce yutulur (akışı asla bloklamaz). */
export function reportMatcherProgress(step: MatcherStep): void {
  apiFetch<void>("/matcher/progress", { method: "POST", body: { step } }).catch(() => {});
}

export function submitMatcher(input: MatcherSubmitInput): Promise<{ id: string; number: number; token: string }> {
  return apiFetch<{ id: string; number: number; token: string }>("/matcher/submit", { method: "POST", body: input });
}

export function requestMatcherCallback(id: string, token: string): Promise<void> {
  return apiFetch<void>(`/matcher/submissions/${encodeURIComponent(id)}/callback`, { method: "POST", body: { token, consentContact: true } });
}

/** WhatsApp numarası (iletişim sayfası içeriğinden); yoksa boş. */
export async function getMatcherWhatsappDigits(locale: string): Promise<string> {
  try {
    return (await apiFetch<{ whatsappDigits: string }>("/contact/page", { query: { locale } })).whatsappDigits ?? "";
  } catch {
    return "";
  }
}

// ---- Admin ----
export interface AdminCareTopicText {
  label: string;
  description: string;
  synonyms: string[];
}

export interface AdminCareTopic {
  id: string;
  slug: string;
  bodyArea: MatcherBodyArea;
  translations: Record<string, AdminCareTopicText>;
  isRedFlag: boolean;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
  weights: { specialtyId: string; specialtySlug: string; specialtyName: string; weight: number }[];
}

export interface AdminCareTopicInput {
  slug: string;
  bodyArea: MatcherBodyArea;
  translations: Record<string, AdminCareTopicText>;
  isRedFlag: boolean;
  isActive: boolean;
  sortOrder: number;
  weights: { specialtyId: string; weight: number }[];
}

export interface MatcherPreview {
  topics: { id: string; slug: string; label: string; isRedFlag: boolean; score: number }[];
  specialties: { id: string; slug: string; name: string; isActive: boolean; score: number; hasDoctors: boolean; passesThreshold: boolean }[];
}

export interface MatcherReport {
  topTopics: { key: string; label: string; count: number }[];
  unmatchedTerms: { key: string; count: number }[];
  funnel: { step: string; reached: number; dropOffRate: number | null }[];
  redFlags: { key: string; count: number }[];
}

export interface MatcherSettings {
  contactRequired: boolean;
  retentionDays: number;
}

export interface MatcherLeadCard {
  number: number;
  createdAt: string;
  topics: { slug: string; label: string; isRedFlag: boolean }[];
  freeText: string | null;
  ageBand: string | null;
  birthYear: number | null;
  guardianName: string | null;
  forWhom: string;
  duration: string | null;
  priorDiagnosis: string | null;
  preference: string;
  preferredLanguage: string;
  country: string | null;
  timeZone: string | null;
  recommendedSpecialties: string[];
  recommendedDoctors: { name: string; slug: string }[];
  redFlagAcknowledgedAt: string | null;
  consentHealthAt: string | null;
  consentContactAt: string | null;
  callbackRequestedAt: string | null;
  anonymizedAt: string | null;
}

export const listAdminCareTopics = () => apiFetch<AdminCareTopic[]>("/admin/matcher/topics");
export const createAdminCareTopic = (input: AdminCareTopicInput) => apiFetch<AdminCareTopic>("/admin/matcher/topics", { method: "POST", body: input });
export const updateAdminCareTopic = (id: string, input: AdminCareTopicInput) =>
  apiFetch<AdminCareTopic>(`/admin/matcher/topics/${encodeURIComponent(id)}`, { method: "PUT", body: input });
export const deleteAdminCareTopic = (id: string) => apiFetch<void>(`/admin/matcher/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
export const previewMatcher = (q: string, lang: string) => apiFetch<MatcherPreview>("/admin/matcher/preview", { query: { q, lang } });
export const getMatcherReport = (from: string, to: string) => apiFetch<MatcherReport>("/admin/matcher/report", { query: { from, to } });
export const getMatcherSettings = () => apiFetch<MatcherSettings>("/admin/matcher/settings");
export const updateMatcherSettings = (input: MatcherSettings) => apiFetch<MatcherSettings>("/admin/matcher/settings", { method: "PUT", body: input });
export const getMatcherLeadCard = (leadId: string) => apiFetch<MatcherLeadCard>(`/admin/matcher/leads/${encodeURIComponent(leadId)}`);
