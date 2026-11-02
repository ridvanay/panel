-- Paket AJ-7 - talepte tercih edilen iletisim kanali. YALNIZCA EKLEME; mevcut veri degismez.

-- AlterTable
ALTER TABLE "consultation_requests" ADD COLUMN "preferredContactChannel" TEXT;
