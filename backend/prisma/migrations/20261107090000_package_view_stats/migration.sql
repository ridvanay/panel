-- Paket X kararı — paket/destinasyon ziyaretleri için anonim günlük sayaç (yalnızca EKLEME).
-- CreateTable
CREATE TABLE "package_view_stats" (
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "package_view_stats_pkey" PRIMARY KEY ("day","kind","key")
);

-- CreateIndex
CREATE INDEX "package_view_stats_kind_day_idx" ON "package_view_stats"("kind", "day");
