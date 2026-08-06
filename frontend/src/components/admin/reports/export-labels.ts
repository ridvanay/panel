import type { ExportFileFormat, ExportJobStatus, ExportJobType } from "@/lib/api/types";

/**
 * TÜM eşlemeler backend'in makine-okunur enum değerlerine bağlıdır (openapi.yaml ile birebir) —
 * insan-okunur Türkçe etiketler burada İSTEMCİ TARAFINDA tutulur (bkz. `import-labels.ts` ile
 * AYNI desen, proje kökü CLAUDE.md § Ortak Proje Kuralları).
 */
export const EXPORT_JOB_TYPE_LABELS: Record<ExportJobType, string> = {
  VIEWS: "Görüntülenme (Views)",
  BREAKDOWN: "Cihaz/Ülke Dağılımı",
  SUMMARY: "Özet (KPI)",
  TOP_CONTENT: "En Çok Görüntülenen İçerik",
  USERS: "Kullanıcılar",
  REVENUE: "Gelir (MRR)",
};

export const EXPORT_JOB_TYPE_DESCRIPTIONS: Record<ExportJobType, string> = {
  VIEWS: "Günlük/haftalık/aylık sayfa ve blog görüntülenme sayıları.",
  BREAKDOWN: "Cihaz türü ve ülkeye göre ziyaretçi dağılımı.",
  SUMMARY: "Görüntülenme, yeni kullanıcı, aktif abonelik ve MRR özeti.",
  TOP_CONTENT: "Görüntülenmeye göre sıralanmış sayfa/blog yazısı listesi.",
  USERS: "Kullanıcı kayıt trendi ve rol dağılımı (KİŞİSEL VERİ içerebilir).",
  REVENUE: "MRR zaman serisi ve abonelik iptalleri (churn).",
};

export const EXPORT_FILE_FORMAT_LABELS: Record<ExportFileFormat, string> = {
  CSV: "CSV",
  PDF: "PDF",
};

export const EXPORT_JOB_STATUS_LABELS: Record<ExportJobStatus, string> = {
  PENDING: "Kuyrukta",
  PROCESSING: "İşleniyor",
  COMPLETED: "Tamamlandı",
  FAILED: "Başarısız",
};

export const EXPORT_JOB_STATUS_TONES: Record<ExportJobStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  PROCESSING: "primary",
  COMPLETED: "success",
  FAILED: "danger",
};

/** Yalnızca bu tiplerde tip-bazlı ek filtre (rol/abonelik durumu) anlamlıdır (bkz. backend `ExportFiltersSchema`). */
export const EXPORT_JOB_TYPES_WITH_ROLE_FILTER: ExportJobType[] = ["USERS"];
export const EXPORT_JOB_TYPES_WITH_SUBSCRIPTION_FILTER: ExportJobType[] = ["REVENUE"];

/** PII/kişisel veri içerebilecek rapor tipleri — `unmaskPii` uyarısı bu tiplerde vurgulanır. */
export const EXPORT_JOB_TYPES_WITH_PII: ExportJobType[] = ["USERS"];

export function isExportJobFinished(status: ExportJobStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}
