/**
 * compliance-agent kararı (2026-08-06) — `import.retention.ts::IMPORT_JOB_RETENTION_MS` (90 gün)
 * ile KARIŞTIRILMAMALI: import job zarfı ile export dosyası farklı risk profiline sahip — export
 * dosyası, DB satırının aksine doğrudan indirilebilir/kopyalanabilir bir ARTEFAKTTIR ve talep
 * üzerine her an yeniden üretilebilir (kaynak veri DB'de kalıcı, kaybolma riski yok). Bu yüzden
 * import'un 90 günlük "zarf saklama" emsalinden ÇOK daha kısa, varsayılan (maskeli, `unmaskPii:
 * false`) export'lar için 7 gün yeterlidir (`ExportJob.expiresAt`, `POST /` ucunda AYNI ANDA set
 * edilir — bkz. reports.routes.ts).
 */
export const EXPORT_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * compliance-agent kararı (2026-08-06, BLOCKER) — `unmaskPii: true` ile üretilen dosyalar HAM
 * (maskelenmemiş) e-posta içerir; bu, varsayılan maskeli exportlardan daha yüksek risklidir
 * (indirilip sunucu dışında saklanabilecek bir dosyada açık PII). "Progressive redaction" ilkesi
 * gereği (bkz. `import.constants.ts::IMPORT_ERROR_ROW_REDACTION_MS` üstündeki gerekçeyle AYNI
 * desen) ham PII içeren dosyalar çok daha kısa yaşamalı: 48 saat. `reports.routes.ts::POST /`
 * `body.unmaskPii` true ise `expiresAt` hesabında BUNU (7 gün yerine) kullanır.
 */
export const EXPORT_JOB_RETENTION_UNMASKED_MS = 2 * 24 * 60 * 60 * 1000;

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
