-- Paket AE — sunucuya yüklenen hekim videosu (yalnızca EKLEME; mevcut veri değişmez).
ALTER TABLE "media" ADD COLUMN "videoCodec" TEXT;
ALTER TABLE "media" ADD COLUMN "videoFaststart" BOOLEAN;
ALTER TABLE "media" ADD COLUMN "durationSec" DOUBLE PRECISION;

ALTER TABLE "doctor_media" ADD COLUMN "captionsMediaId" TEXT;
ALTER TABLE "doctor_media" ADD COLUMN "captionsLang" TEXT;
CREATE INDEX "doctor_media_captionsMediaId_idx" ON "doctor_media"("captionsMediaId");
ALTER TABLE "doctor_media" ADD CONSTRAINT "doctor_media_captionsMediaId_fkey" FOREIGN KEY ("captionsMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
