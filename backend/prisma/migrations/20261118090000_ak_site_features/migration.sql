-- Paket AK (K3) - site ozellik anahtarlari. YALNIZCA EKLEME; varsayilan true = mevcut davranis.

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN "findTreatmentEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "bookConsultationCtaEnabled" BOOLEAN NOT NULL DEFAULT true;
