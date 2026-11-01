-- Paket Z2 (kullanıcı onaylı) — kategori adı çevirileri (yalnızca EKLEME; mevcut kayıtlar {} ile başlar).
-- AlterTable
ALTER TABLE "blog_categories" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';
