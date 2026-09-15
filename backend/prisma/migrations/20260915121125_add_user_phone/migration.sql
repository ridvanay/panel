-- AlterTable
-- Hesap seviyesinde genel iletişim numarası (randevu/SMS hatırlatma vb.). Opsiyonel,
-- backfill YOK; format doğrulaması backend katmanında yapılır (users.schemas.ts).
-- `addresses.phone` (zorunlu, e-ticaret adres defteri alanı) ile KARIŞTIRILMAMALI.
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;
