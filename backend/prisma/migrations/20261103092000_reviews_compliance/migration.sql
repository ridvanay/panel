-- Paket Y (compliance-agent incelemesi) — YALNIZCA EKLEME.
-- Yorum: hangi rıza metnine onay verildiği (sürüm).
ALTER TABLE "testimonials" ADD COLUMN "consentTextVersion" TEXT;
-- Hasta görünen medya: onayı kimin, ne zaman kaydettiği (sunucu yazar).
ALTER TABLE "doctor_media" ADD COLUMN "consentRecordedAt" TIMESTAMP(3);
ALTER TABLE "doctor_media" ADD COLUMN "consentRecordedById" TEXT;
-- "Bir daha yorum isteği gönderme" — e-posta adresinin SHA-256 özeti (ham adres saklanmaz).
CREATE TABLE "review_request_opt_outs" (
    "emailHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_request_opt_outs_pkey" PRIMARY KEY ("emailHash")
);
