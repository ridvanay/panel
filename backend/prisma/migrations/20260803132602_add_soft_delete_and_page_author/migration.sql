-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "blog_posts_deletedAt_status_idx" ON "blog_posts"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "blog_posts_authorId_idx" ON "blog_posts"("authorId");

-- CreateIndex
CREATE INDEX "pages_deletedAt_status_idx" ON "pages"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "pages_authorId_idx" ON "pages"("authorId");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
