-- Paket O (2026-10-23) — YALNIZCA EKLEME: menü, footer, uzmanlık ve slayt için dil bazlı çeviri kolonu.
-- Varsayılanlı (NOT NULL DEFAULT '{}') — mevcut satırlar '{}' alır, kolon silme/yeniden adlandırma yok.

-- AlterTable
ALTER TABLE "footer_columns" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "footer_links" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "navigation_items" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "slides" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "specialties" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';
