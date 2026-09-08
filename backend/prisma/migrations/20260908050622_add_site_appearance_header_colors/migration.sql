-- AlterTable
ALTER TABLE "site_appearance" ADD COLUMN     "headerBgColor" TEXT NOT NULL DEFAULT '#ffffff',
ADD COLUMN     "headerLinkColor" TEXT NOT NULL DEFAULT '#111827',
ADD COLUMN     "headerLinkHoverColor" TEXT NOT NULL DEFAULT '#4f46e5',
ADD COLUMN     "headerStickyBgColor" TEXT NOT NULL DEFAULT '#ffffff',
ADD COLUMN     "headerStickyBlurEnabled" BOOLEAN NOT NULL DEFAULT true;
