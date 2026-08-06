/**
 * §10.8.10 Analitik Rapor Dışa Aktarma — kullanıcı tarafından onaylanmış karar: indirilebilir
 * rapor dosyası/linki, oluşturmadan 7 gün sonra süre dolar (`ExportJob.expiresAt`, `POST /`
 * ucunda AYNI ANDA set edilir — bkz. reports.routes.ts).
 */
export const EXPORT_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `import.retention.ts::IMPORT_RETENTION_SWEEP_INTERVAL_MS` İLE AYNI DESEN/GEREKÇE — gerçek
 * zaman-tetiklemeli, saatlik kontrol (7 günlük eşiğe göre fazlasıyla hassas, ihmal edilebilir yük).
 */
export const EXPORT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Tek bir export dosyasında satır patlamasını önlemek için tip başına üst tavan. */
export const EXPORT_ROW_CAPS = {
  TOP_CONTENT: 1000,
  USERS: 5000,
  REVENUE: 5000,
} as const;
