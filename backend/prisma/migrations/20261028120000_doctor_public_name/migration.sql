-- Paket U (C2) — YALNIZCA EKLEME: sitede görünen ad için elle düzeltme alanı (nullable).
-- Boşsa ad, kurucu dışındaki doktorlarda otomatik kısaltılır ("H. Sofu"); `fullName` değişmez.

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN "publicName" TEXT;
