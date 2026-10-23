-- 2026-10-23 (Paket L) — YALNIZCA EKLEME: doktor profili içerik çevirileri. Varsayılanlı (NOT NULL
-- DEFAULT '{}'), mevcut satırlar boş nesne alır; kolon silme/yeniden adlandırma yok.
-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';
