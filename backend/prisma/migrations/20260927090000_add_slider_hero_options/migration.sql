-- Gelişmiş Slider / Hero Studio — cihaza göre arka plan görseli, görsel sığdırma modu, cihaza göre
-- odak noktası ve slayt başına okunabilirlik gradyanı. Yalnızca YENİ sütunlar/enum eklenir; mevcut
-- satırların hiçbir değeri değiştirilmez. Metin/dil alanı YOKTUR (varsayılan dilden bağımsız).
--
-- `bgScrimEnabled` varsayılanı false: eskiden görselli her slayta kodda sabit uygulanan koyu gradyan
-- mevcut slaytlarda da KAPALI başlar (kullanıcı kararı, 2026-09-25) — admin'den slayt başına açılabilir.

-- CreateEnum
CREATE TYPE "SliderImageFit" AS ENUM ('COVER', 'CONTAIN');

-- AlterTable
ALTER TABLE "sliders" ADD COLUMN "imageFit" "SliderImageFit" NOT NULL DEFAULT 'COVER';

-- AlterTable
ALTER TABLE "slides" ADD COLUMN "bgTabletMediaId" TEXT,
ADD COLUMN "bgMobileMediaId" TEXT,
ADD COLUMN "bgTabletPositionX" INTEGER,
ADD COLUMN "bgTabletPositionY" INTEGER,
ADD COLUMN "bgMobilePositionX" INTEGER,
ADD COLUMN "bgMobilePositionY" INTEGER,
ADD COLUMN "bgScrimEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "bgScrimOpacity" INTEGER NOT NULL DEFAULT 70;

-- CreateIndex
CREATE INDEX "slides_bgTabletMediaId_idx" ON "slides"("bgTabletMediaId");

-- CreateIndex
CREATE INDEX "slides_bgMobileMediaId_idx" ON "slides"("bgMobileMediaId");

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_bgTabletMediaId_fkey" FOREIGN KEY ("bgTabletMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_bgMobileMediaId_fkey" FOREIGN KEY ("bgMobileMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
