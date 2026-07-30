-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE', 'DESKTOP', 'TABLET', 'UNKNOWN');

-- DropIndex
DROP INDEX "page_views_pageId_date_key";

-- DropIndex
DROP INDEX "page_views_postId_date_key";

-- AlterTable
ALTER TABLE "page_views" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE UNIQUE INDEX "page_views_pageId_date_deviceType_country_key" ON "page_views"("pageId", "date", "deviceType", "country");

-- CreateIndex
CREATE UNIQUE INDEX "page_views_postId_date_deviceType_country_key" ON "page_views"("postId", "date", "deviceType", "country");
