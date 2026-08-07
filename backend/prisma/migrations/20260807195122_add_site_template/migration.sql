-- CreateEnum
CREATE TYPE "SiteTemplate" AS ENUM ('SHOWCASE', 'COMMERCE', 'PORTFOLIO');

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "siteTemplate" "SiteTemplate" NOT NULL DEFAULT 'SHOWCASE';
