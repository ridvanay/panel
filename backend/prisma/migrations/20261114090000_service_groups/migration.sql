-- Paket AI - hizmet gruplari ve kisa aciklama. YALNIZCA EKLEME; mevcut veri degismez/silinmez.

-- AlterTable
ALTER TABLE "specialties" ADD COLUMN "serviceGroup" TEXT,
ADD COLUMN "shortDescription" TEXT;
