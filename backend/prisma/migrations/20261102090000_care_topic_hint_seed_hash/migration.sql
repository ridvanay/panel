-- Paket W-ek — yalnızca ekleme: konunun bizde karşılığı olmayan doğal uzmanlığı (admin/rapor) ve
-- seed'in yazdığı içeriğin özeti (`--update-existing` yalnızca admin değiştirmemişse günceller).
ALTER TABLE "care_topics" ADD COLUMN "targetSpecialtyHint" TEXT;
ALTER TABLE "care_topics" ADD COLUMN "seedHash" TEXT;
CREATE INDEX "care_topics_targetSpecialtyHint_idx" ON "care_topics"("targetSpecialtyHint");
