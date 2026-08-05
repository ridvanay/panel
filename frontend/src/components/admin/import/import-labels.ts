import type {
  ImportDuplicateStrategy,
  ImportJobStatus,
  ImportPreviewFieldStatus,
} from "@/lib/api/types";

/**
 * TÜM eşlemeler backend'in makine-okunur `code`/enum değerlerine bağlıdır (openapi.yaml
 * ile birebir) — insan-okunur Türkçe etiketler burada İSTEMCİ TARAFINDA tutulur, ASLA
 * backend `message` alanına bağlanmaz (bkz. proje kökü CLAUDE.md § Ortak Proje Kuralları).
 */
export const IMPORT_JOB_STATUS_LABELS: Record<ImportJobStatus, string> = {
  PENDING: "Onay Bekliyor",
  QUEUED: "Kuyrukta",
  PROCESSING: "İşleniyor",
  COMPLETED: "Tamamlandı",
  FAILED: "Başarısız",
  CANCELLED: "İptal Edildi",
};

export const IMPORT_JOB_STATUS_TONES: Record<ImportJobStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  QUEUED: "neutral",
  PROCESSING: "primary",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

/** İş sonlanmış mı — sonlanan işler artık poll edilmez (bkz. import-progress-panel.tsx). */
export function isImportJobFinished(status: ImportJobStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

export const IMPORT_DUPLICATE_STRATEGY_LABELS: Record<ImportDuplicateStrategy, string> = {
  skip: "Atla (mevcut kayıt korunur)",
  overwrite: "Üzerine yaz (mevcut kayıt güncellenir)",
  createNew: "Yeni kayıt oluştur (slug'a -2, -3… eklenir)",
};

export const IMPORT_PREVIEW_FIELD_STATUS_LABELS: Record<ImportPreviewFieldStatus, string> = {
  matched: "Eşleşti",
  unmatched: "Eşleşmedi",
  ignored: "Desteklenmiyor",
  missingRequired: "Zorunlu alan eksik",
};

export const IMPORT_PREVIEW_FIELD_STATUS_TONES: Record<
  ImportPreviewFieldStatus,
  "neutral" | "primary" | "success" | "danger" | "warning"
> = {
  matched: "success",
  unmatched: "neutral",
  ignored: "neutral",
  missingRequired: "danger",
};
