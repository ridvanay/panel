-- Paket Z1 — profesyonel blog: tıbbi inceleme alanları (yalnızca ekleme; mevcut veri değişmez).

-- AlterTable
ALTER TABLE "blog_categories" ADD COLUMN     "isMedical" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "careTopicIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "faq" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keyTakeaways" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN     "medicalReviewNote" TEXT,
ADD COLUMN     "medicalReviewStatus" TEXT,
ADD COLUMN     "readingMinutes" INTEGER,
ADD COLUMN     "references" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reviewerDoctorId" TEXT,
ADD COLUMN     "specialtyId" TEXT;

-- CreateIndex
CREATE INDEX "blog_posts_specialtyId_idx" ON "blog_posts"("specialtyId");

-- CreateIndex
CREATE INDEX "blog_posts_reviewerDoctorId_medicalReviewStatus_idx" ON "blog_posts"("reviewerDoctorId", "medicalReviewStatus");

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_reviewerDoctorId_fkey" FOREIGN KEY ("reviewerDoctorId") REFERENCES "doctor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
