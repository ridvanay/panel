-- 2026-10-23 (Paket N4) — YALNIZCA YENİ TABLO: Google Search Console arama analitiği (toplu, kişisel veri yok).
-- Mevcut tablolara dokunulmaz.
-- CreateTable
CREATE TABLE "crm_search_console_rows" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rowKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "crm_search_console_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_search_console_rows_date_idx" ON "crm_search_console_rows"("date");

-- CreateIndex
CREATE UNIQUE INDEX "crm_search_console_rows_date_rowKey_key" ON "crm_search_console_rows"("date", "rowKey");
