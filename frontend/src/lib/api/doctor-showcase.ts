import { apiFetch } from "./client";
import type { VideoUploadInfo } from "./media";

/** Paket Y — hekim vitrini (İşlemler + Foto/Video) ve önce/sonra ayarı. Yalnızca admin uçları; fiyat alanı YOKTUR. */

/** Sitenin 9 arayüz dili (admin dil sekmeleri). */
export const SHOWCASE_LOCALES = ["tr", "en", "de", "fr", "es", "ru", "ar", "ro", "sr-latn"] as const;

export interface DoctorProcedureText {
  title: string;
  description: string;
  duration: string;
  anesthesia: string;
  hospitalStay: string;
  recovery: string;
}

export interface DoctorProcedureInput {
  translations: Record<string, DoctorProcedureText>;
  relatedCareTopicIds: string[];
  sortOrder: number;
  isPublished: boolean;
}

export interface AdminDoctorProcedure extends DoctorProcedureInput {
  id: string;
  doctorId: string;
  createdAt: string;
  updatedAt: string;
}

export type DoctorMediaKind = "photo" | "video";
export type DoctorMediaCategory = "about" | "clinic" | "procedure" | "interview" | "before-after";
export type VideoProviderName = "youtube" | "vimeo" | "upload";

export const MEDIA_CATEGORY_LABELS: Record<DoctorMediaCategory, string> = {
  about: "Hekim hakkında",
  clinic: "Klinik / hastane",
  procedure: "İşlem",
  interview: "Röportaj",
  "before-after": "Önce / sonra",
};

export interface DoctorMediaText {
  title: string;
  description: string;
  alt: string;
}

export interface DoctorMediaInput {
  kind: DoctorMediaKind;
  mediaId?: string | null;
  videoProvider?: VideoProviderName | null;
  videoId?: string | null;
  /** Yalnızca `videoProvider: "upload"`: kapak görseli (görsel Media id) ve altyazı (text/vtt Media id). */
  posterMediaId?: string | null;
  captionsMediaId?: string | null;
  captionsLang?: string | null;
  category: DoctorMediaCategory;
  translations: Record<string, DoctorMediaText>;
  showsPatient: boolean;
  patientConsentConfirmed: boolean;
  consentNote?: string | null;
  isPublished: boolean;
  sortOrder: number;
}

export interface AdminDoctorMedia extends DoctorMediaInput {
  id: string;
  doctorId: string;
  media: { id: string; url: string; width: number | null; height: number | null; filename: string; mimeType?: string } | null;
  /** Poster ya da YouTube/Vimeo yerel küçük resmi. */
  thumbnailUrl?: string | null;
  thumbnailMediaId?: string | null;
  captionsUrl?: string | null;
  video?: VideoUploadInfo | null;
  createdAt: string;
  updatedAt: string;
}

/** Hastanın görünebildiği içerik: önce/sonra kategorisi ya da "hasta görünüyor" işareti (backend `requiresPatientConsent` ile aynı). */
export function requiresPatientConsent(item: { category: DoctorMediaCategory; showsPatient: boolean }): boolean {
  return item.category === "before-after" || item.showsPatient;
}

const base = (doctorId: string) => `/admin/telehealth/doctors/${encodeURIComponent(doctorId)}`;

export const listDoctorProcedures = (doctorId: string) => apiFetch<AdminDoctorProcedure[]>(`${base(doctorId)}/procedures`);
export const createDoctorProcedure = (doctorId: string, input: DoctorProcedureInput) =>
  apiFetch<AdminDoctorProcedure>(`${base(doctorId)}/procedures`, { method: "POST", body: input });
export const updateDoctorProcedure = (doctorId: string, id: string, input: DoctorProcedureInput) =>
  apiFetch<AdminDoctorProcedure>(`${base(doctorId)}/procedures/${encodeURIComponent(id)}`, { method: "PUT", body: input });
export const deleteDoctorProcedure = (doctorId: string, id: string) =>
  apiFetch<void>(`${base(doctorId)}/procedures/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listDoctorMedia = (doctorId: string) => apiFetch<AdminDoctorMedia[]>(`${base(doctorId)}/media`);
export const createDoctorMedia = (doctorId: string, input: DoctorMediaInput) =>
  apiFetch<AdminDoctorMedia>(`${base(doctorId)}/media`, { method: "POST", body: input });
export const updateDoctorMedia = (doctorId: string, id: string, input: DoctorMediaInput) =>
  apiFetch<AdminDoctorMedia>(`${base(doctorId)}/media/${encodeURIComponent(id)}`, { method: "PUT", body: input });
export const deleteDoctorMedia = (doctorId: string, id: string) =>
  apiFetch<void>(`${base(doctorId)}/media/${encodeURIComponent(id)}`, { method: "DELETE" });

export interface DoctorMediaSettings {
  beforeAfterEnabled: boolean;
  /** 1..500 MB, varsayılan 100 (Nginx `client_max_body_size` ile uyumlu olmalı). */
  maxVideoUploadMb: number;
}
export const getDoctorMediaSettings = () => apiFetch<DoctorMediaSettings>("/admin/telehealth/settings/doctor-media");
/** PUT kısmi gövde kabul eder; yanıt birleşmiş ayardır. */
export const updateDoctorMediaSettings = (input: Partial<DoctorMediaSettings>) =>
  apiFetch<DoctorMediaSettings>("/admin/telehealth/settings/doctor-media", { method: "PUT", body: input });
