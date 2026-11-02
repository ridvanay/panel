-- Paket AG (İş 1) — alt uzmanlık: Specialty.parentId (kendine referans, nullable). Yalnızca ekleme.
-- AlterTable
ALTER TABLE "specialties" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "specialties_parentId_idx" ON "specialties"("parentId");

-- AddForeignKey
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kendi kendinin ustu olamaz (API kurallarina ek son savunma hatti; tek seviye/dongu denetimi API + Serializable transaction).
ALTER TABLE "specialties" ADD CONSTRAINT "specialties_parentId_not_self_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
