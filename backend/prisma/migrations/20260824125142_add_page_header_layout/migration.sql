-- CreateEnum
CREATE TYPE "PageHeaderLayout" AS ENUM ('CENTERED', 'LEFT_OVERLAY', 'MINIMAL_LINE', 'SPLIT');

-- AlterTable
ALTER TABLE "site_appearance" ADD COLUMN     "pageHeaderLayout" "PageHeaderLayout" NOT NULL DEFAULT 'CENTERED';
