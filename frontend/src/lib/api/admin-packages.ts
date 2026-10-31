import { apiFetch } from "./client";

/**
 * Paket X — admin uçları (sağlık paketleri, destinasyonlar, iletişim kanalları). Sözleşme:
 * scratchpad/X-KONTRAT.md "Admin" bölümü. Telehealth modülü kapalıysa uçlar 404 döner.
 */

export const PACKAGE_CATEGORIES = ["check-up", "aesthetic", "wellness", "longevity", "dental", "women", "men", "other"] as const;
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

export const PACKAGE_CATEGORY_LABELS: Record<PackageCategory, string> = {
  "check-up": "Check-up",
  aesthetic: "Estetik",
  wellness: "Wellness",
  longevity: "Longevity",
  dental: "Diş",
  women: "Kadın sağlığı",
  men: "Erkek sağlığı",
  other: "Diğer",
};

export interface AdminCover {
  url: string;
  compatUrl?: string | null;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export interface PackageFaqItem {
  question: string;
  answer: string;
}

export interface PackageTranslation {
  title: string;
  summary: string;
  includes: string[];
  notIncluded: string[];
  duration: string;
  idealFor: string;
  faq: PackageFaqItem[];
}

export interface PackageInput {
  slug: string;
  category: PackageCategory;
  coverMediaId?: string | null;
  translations: Record<string, PackageTranslation>;
  priceFrom?: number | null;
  currency: string;
  showPrice: boolean;
  relatedSpecialtyIds: string[];
  relatedDoctorIds: string[];
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

export interface AdminPackage extends PackageInput {
  id: string;
  coverMediaId?: string | null;
  cover: AdminCover | null;
  inquiryCount: number;
}

export interface DestinationTreatmentInput {
  label: Record<string, string>;
  priceFrom: number | null;
  currency: string;
}

export interface DestinationTranslation {
  title: string;
  summary: string;
  highlights: string[];
}

export interface DestinationInput {
  slug: string;
  city: string;
  coverMediaId?: string | null;
  translations: Record<string, DestinationTranslation>;
  topTreatments: DestinationTreatmentInput[];
  patientCountLastYear?: number | null;
  dataPeriodLabel?: string | null;
  showPrices: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface AdminDestination extends DestinationInput {
  id: string;
  cover?: AdminCover | null;
}

export interface ContactChannelsSettings {
  whatsappEnabled: boolean;
  whatsappNumber: string | null;
  coordinatorEmail: string | null;
  whatsappMessages: Record<string, string>;
}

/** Liste uçları dizi ya da `{ items }` döndürebilir — ikisini de kabul eder. */
function toList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const items = (raw as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

export async function listAdminPackages(): Promise<AdminPackage[]> {
  return toList<AdminPackage>(await apiFetch<unknown>("/admin/packages"));
}
export function getAdminPackage(id: string): Promise<AdminPackage> {
  return apiFetch<AdminPackage>(`/admin/packages/${id}`);
}
export function createAdminPackage(input: PackageInput): Promise<AdminPackage> {
  return apiFetch<AdminPackage>("/admin/packages", { method: "POST", body: input });
}
export function updateAdminPackage(id: string, input: PackageInput): Promise<AdminPackage> {
  return apiFetch<AdminPackage>(`/admin/packages/${id}`, { method: "PUT", body: input });
}
export function deleteAdminPackage(id: string): Promise<void> {
  return apiFetch<void>(`/admin/packages/${id}`, { method: "DELETE" });
}

export async function listAdminDestinations(): Promise<AdminDestination[]> {
  return toList<AdminDestination>(await apiFetch<unknown>("/admin/destinations"));
}
export function createAdminDestination(input: DestinationInput): Promise<AdminDestination> {
  return apiFetch<AdminDestination>("/admin/destinations", { method: "POST", body: input });
}
export function updateAdminDestination(id: string, input: DestinationInput): Promise<AdminDestination> {
  return apiFetch<AdminDestination>(`/admin/destinations/${id}`, { method: "PUT", body: input });
}
export function deleteAdminDestination(id: string): Promise<void> {
  return apiFetch<void>(`/admin/destinations/${id}`, { method: "DELETE" });
}

export function getContactChannelsSettings(): Promise<ContactChannelsSettings> {
  return apiFetch<ContactChannelsSettings>("/admin/telehealth/settings/contact-channels");
}
export function updateContactChannelsSettings(input: ContactChannelsSettings): Promise<ContactChannelsSettings> {
  return apiFetch<ContactChannelsSettings>("/admin/telehealth/settings/contact-channels", { method: "PUT", body: input });
}
