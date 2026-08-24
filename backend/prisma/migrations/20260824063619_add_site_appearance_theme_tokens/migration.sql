-- CreateEnum
CREATE TYPE "SiteBorderRadius" AS ENUM ('NONE', 'SM', 'MD', 'LG', 'FULL');

-- CreateEnum
CREATE TYPE "SiteButtonStyle" AS ENUM ('SOLID', 'OUTLINE', 'SOFT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SiteFont" ADD VALUE 'PLUS_JAKARTA_SANS';
ALTER TYPE "SiteFont" ADD VALUE 'OUTFIT';

-- AlterTable
ALTER TABLE "site_appearance" ADD COLUMN     "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
ADD COLUMN     "backgroundColor" TEXT NOT NULL DEFAULT '#ffffff',
ADD COLUMN     "borderRadius" "SiteBorderRadius" NOT NULL DEFAULT 'MD',
ADD COLUMN     "buttonStyle" "SiteButtonStyle" NOT NULL DEFAULT 'SOLID',
ADD COLUMN     "mutedTextColor" TEXT NOT NULL DEFAULT '#6b7280',
ADD COLUMN     "surfaceColor" TEXT NOT NULL DEFAULT '#f9fafb',
ADD COLUMN     "textColor" TEXT NOT NULL DEFAULT '#111827';
