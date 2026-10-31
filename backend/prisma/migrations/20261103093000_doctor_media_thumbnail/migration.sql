-- Paket Y (kullanıcı kararı) — YALNIZCA EKLEME: video küçük resminin yerel kopyası (Media). Sitede yalnızca bu
-- gösterilir; "Oynat"a basılana kadar youtube/ytimg/vimeo alanlarına istek gitmez.
ALTER TABLE "doctor_media" ADD COLUMN "thumbnailMediaId" TEXT;
CREATE INDEX "doctor_media_thumbnailMediaId_idx" ON "doctor_media"("thumbnailMediaId");
ALTER TABLE "doctor_media" ADD CONSTRAINT "doctor_media_thumbnailMediaId_fkey" FOREIGN KEY ("thumbnailMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
