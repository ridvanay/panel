-- AlterTable
ALTER TABLE "site_appearance" ADD COLUMN     "headerLinkActiveColor" TEXT NOT NULL DEFAULT '#4f46e5',
ALTER COLUMN "headerBgColor" SET DEFAULT '#ffffffcc',
ALTER COLUMN "headerLinkColor" SET DEFAULT '#111827b3',
ALTER COLUMN "headerLinkHoverColor" SET DEFAULT '#111827',
ALTER COLUMN "headerStickyBgColor" SET DEFAULT '#fffffff2';
