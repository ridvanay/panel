-- Paket U (B2) — YALNIZCA EKLEME: site ayarlarının görünen metinleri (slogan, başlık CTA etiketi, footer metni)
-- için dil çevirileri. Sayfa/menü/footer ile aynı desen; mevcut satırlar '{}' ile başlar (davranış değişmez).

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN "translations" JSONB NOT NULL DEFAULT '{}';
