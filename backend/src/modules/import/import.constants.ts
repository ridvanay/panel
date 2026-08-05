import type { ImportDuplicateStrategy as PrismaImportDuplicateStrategy, ImportErrorSeverity as PrismaImportErrorSeverity } from "@prisma/client";
import type { ImportDuplicateStrategy, ImportJobErrorSeverity, ImportJobType, ImportSourceFormat } from "../../schemas/entities";

/**
 * §10.8.1 — her 25 kayıtta bir sayaç flush'ı + cancelRequestedAt kontrolü.
 */
export const IMPORT_BATCH_SIZE = 25;

/** §10.8.2 — iş başına en fazla saklanan hata satırı; aşıldığında yazma durur. */
export const IMPORT_ERROR_ROW_CAP = 1000;

/** §10.8.5 — onaylanmamış (PENDING) işler bu süreden sonra tembel süpürmeyle temizlenir. */
export const IMPORT_PENDING_SWEEP_MS = 24 * 60 * 60 * 1000;

/**
 * §10.8.8.1 compliance-agent kararı (2026-08-05, BLOCKER) — `ImportJobError.rawData`
 * (ve `USERS` tipi işlerde PII içeren `sourceRef`) bu süreden sonra REDAKTE edilir
 * (satır SİLİNMEZ — yalnızca PII taşıyan alanlar `null` yapılır; `code`/`message`/
 * `severity`/`rowNumber`/`field`/`jobId` istatistik/denetim amaçlı KALIR).
 * `ImportJob` zarfının kendisinden (90 gün, `IMPORT_JOB_RETENTION_MS`) BAĞIMSIZDIR —
 * amaç yalnızca ADMIN'in hatalı satırı görüp düzeltmesidir, bu ihtiyaç gün/hafta
 * mertebesindedir; PII bundan çok daha erken temizlenir ("progressive redaction").
 */
export const IMPORT_ERROR_ROW_REDACTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * §10.8.8.1 — `COMPLETED`/`FAILED`/`CANCELLED` `ImportJob` zarfının (status, sayaçlar,
 * `filename`, `options`, `createdById` referansı) tamamının saklandığı süre. Süre dolunca
 * satır TAMAMEN silinir (`ImportJobError` `onDelete: Cascade` ile birlikte gider).
 */
export const IMPORT_JOB_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * §10.8.8.1 — retention sweep'in kontrol sıklığı. Gerçek zaman-tetiklemeli olmalı
 * ("bir sonraki upload'ta çalışır" tembel deseni KABUL EDİLEMEZ, bkz. compliance-agent
 * kararı — import nadir kullanılan bir özellik, lazy tetikleme SLA'yı haftalarca
 * geciktirebilir). 30 günlük/90 günlük eşiklere göre saatlik kontrol fazlasıyla
 * hassastır (en kötü ihtimalle ~1 saatlik gecikme) ve DB üzerinde ihmal edilebilir
 * bir yük oluşturur (tek indeksli `updateMany`/`deleteMany`, bkz. import.retention.ts).
 */
export const IMPORT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** §10.8.5 — tip başına dosya boyutu limiti (bytes). */
export const IMPORT_FILE_SIZE_LIMITS: Record<ImportJobType, number> = {
  PAGES: 10 * 1024 * 1024,
  BLOG: 10 * 1024 * 1024,
  USERS: 10 * 1024 * 1024,
  WORDPRESS: 50 * 1024 * 1024,
  MEDIA: 100 * 1024 * 1024,
};

/** §10.8.5 — tip başına kayıt/öğe sayısı tavanı (aşım → 422, iş oluşturulmaz). */
export const IMPORT_RECORD_CAPS: Record<ImportJobType, number> = {
  USERS: 500,
  PAGES: 5000,
  BLOG: 5000,
  WORDPRESS: 10000,
  MEDIA: 500,
};

/** §10.8.7 MEDIA zip bombası koruması. */
export const ZIP_BOMB_LIMITS = {
  maxEntries: 500,
  maxSingleEntryBytes: 5 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
};

/** §10.8.6 WXR XXE savunması — ilk 64 KB'da DOCTYPE/ENTITY taraması + derinlik/öğe tavanı. */
export const WXR_PROLOG_SCAN_BYTES = 64 * 1024;
export const WXR_MAX_DEPTH = 100;

/** Geçerlilik matrisi (ihlal → 422). openapi.yaml `POST /admin/import/jobs` açıklaması. */
export const IMPORT_TYPE_TO_FORMATS: Record<ImportJobType, ImportSourceFormat[]> = {
  PAGES: ["CSV", "JSON"],
  BLOG: ["CSV", "JSON"],
  WORDPRESS: ["XML"],
  USERS: ["CSV"],
  MEDIA: ["ZIP"],
};

/** API (lowerCamel) ↔ Prisma (UPPER_SNAKE) `ImportDuplicateStrategy` dönüşümü. */
export const DUPLICATE_STRATEGY_TO_PRISMA: Record<ImportDuplicateStrategy, PrismaImportDuplicateStrategy> = {
  skip: "SKIP",
  overwrite: "OVERWRITE",
  createNew: "CREATE_NEW",
};

export const DUPLICATE_STRATEGY_FROM_PRISMA: Record<PrismaImportDuplicateStrategy, ImportDuplicateStrategy> = {
  SKIP: "skip",
  OVERWRITE: "overwrite",
  CREATE_NEW: "createNew",
};

/** API (lowercase) ↔ Prisma (UPPERCASE) `ImportErrorSeverity` dönüşümü. */
export const SEVERITY_TO_PRISMA: Record<ImportJobErrorSeverity, PrismaImportErrorSeverity> = {
  error: "ERROR",
  skipped: "SKIPPED",
};

export const SEVERITY_FROM_PRISMA: Record<PrismaImportErrorSeverity, ImportJobErrorSeverity> = {
  ERROR: "error",
  SKIPPED: "skipped",
};

/**
 * §10.8.2 `ImportDuplicateStrategy`: `USERS` yalnızca `skip`, `MEDIA` `createNew` KABUL ETMEZ
 * (yetki yükseltme / anlamsız — bkz. ARCHITECTURE.md §10.8.7).
 */
export function assertDuplicateStrategyAllowed(type: ImportJobType, strategy: ImportDuplicateStrategy): void {
  if (type === "USERS" && strategy !== "skip") {
    throw new Error("USERS_STRATEGY_FORBIDDEN");
  }
  if (type === "MEDIA" && strategy === "createNew") {
    throw new Error("MEDIA_CREATE_NEW_FORBIDDEN");
  }
}

/** `ImportJobPreview.targetFields` — openapi.yaml açıklamasındaki örnek liste ile birebir. */
export const IMPORT_TARGET_FIELDS: Record<"PAGES" | "BLOG" | "USERS", string[]> = {
  BLOG: [
    "title",
    "slug",
    "excerpt",
    "contentHtml",
    "coverImageUrl",
    "status",
    "categoryName",
    "seoTitle",
    "seoDescription",
    "ogTitle",
    "ogImageUrl",
    "canonicalUrl",
    "noIndex",
    "publishedAt",
    "authorEmail",
  ],
  // Page modelinde `excerpt`/`coverImageUrl`/`categoryName` karşılığı YOK (bkz. prisma/schema.prisma::Page).
  PAGES: [
    "title",
    "slug",
    "contentHtml",
    "status",
    "seoTitle",
    "seoDescription",
    "ogTitle",
    "ogImageUrl",
    "canonicalUrl",
    "noIndex",
    "publishedAt",
    "authorEmail",
  ],
  USERS: ["name", "email", "role"],
};

export const IMPORT_REQUIRED_TARGET_FIELDS: Record<"PAGES" | "BLOG" | "USERS", string[]> = {
  PAGES: ["title"],
  BLOG: ["title"],
  USERS: ["email"],
};
