-- Paket W-ek (kullanıcı kararı 2026-10-31) — yalnızca ekleme: çocuk konusu seçilince "veli/vasi olarak
-- dolduruyorum" beyanının zamanı (yaşa bakılmaksızın zorunlu).
ALTER TABLE "matcher_submissions" ADD COLUMN "guardianDeclaredAt" TIMESTAMP(3);
