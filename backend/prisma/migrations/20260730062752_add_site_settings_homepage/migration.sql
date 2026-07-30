-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "homePageId" TEXT;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_homePageId_fkey" FOREIGN KEY ("homePageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
