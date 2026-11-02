-- Blog taslak önizleme bağlantısı (yalnızca ekleme; mevcut veri değişmez). Belirtecin yalnızca SHA-256 özeti saklanır.

-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "previewTokenCreatedAt" TIMESTAMP(3),
ADD COLUMN     "previewTokenCreatedById" TEXT,
ADD COLUMN     "previewTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "previewTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_previewTokenHash_key" ON "blog_posts"("previewTokenHash");
