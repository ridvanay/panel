-- Paket P (İş 3) — YALNIZCA EKLEME: kurucu işareti (varsayılan false) + opsiyonel kadro katmanı.
-- Kurucu ataması migration/script ile YAPILMAZ; admin panelden işaretlenir.

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "isFounder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rosterTier" INTEGER;
