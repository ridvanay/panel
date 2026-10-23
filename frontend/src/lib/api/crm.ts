import { apiFetch } from "@/lib/api/client";

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
