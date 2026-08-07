-- AlterEnum
ALTER TYPE "PageStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "scheduledAt" TIMESTAMP(3);
