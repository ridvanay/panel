-- ============================================================================
-- DOWN-MIGRATION (elle çalıştırılır — Prisma otomatik down-migration desteklemez).
-- migration.sql'in (SiteRole 3-tier -> 5-tier + advancedBuilderEnabled drop) tersidir.
-- Bkz. .claude/architect-scope-rbac-5-tier.md §2.4 kural 1 ("geri alınabilir bir
-- down-migration yazılabilir" — bu ALTER TYPE ... ADD VALUE DEĞİL, tam tip takası).
--
-- ROUND-TRIP GARANTİSİ: bu migration'ın forward adımından beri HİÇ değişmemiş satırlar
-- için birebir geri döner (ADMIN->ADMIN, EDITOR->EDITOR, VIEWER->USER->VIEWER).
--
-- BEST-EFFORT (veri kaybı riski açıkça işaretli): forward migration'dan SONRA üretilen
-- MANAGER / CUSTOMER değerlerinin eski 3-tier enum'da karşılığı YOKTUR (o roller o zaman
-- yoktu). Fail-closed ilkesiyle (aynı §2.2 gerekçesi — ayrıcalık asla otomatik yükseltilmez):
--   MANAGER  -> EDITOR   (en yakın "panelde bir şeyler yapabilen" eski rol; ADMIN'e
--                          yükseltilmez)
--   CUSTOMER -> VIEWER   (en yakın "panel ayrıcalığı yok/minimal" eski rol)
--   USER     -> VIEWER   (forward migration'ın tersi; yeni kayıt olmuş USER'lar da dahil)
-- Bu geri dönüş kayıpsız DEĞİLDİR — MANAGER/CUSTOMER ayrımı eski enum'da ifade edilemez.
-- Down-migration çalıştırıldıktan sonra etkilenen hesaplar (varsa) elle gözden geçirilmelidir:
--   SELECT id, email, name, role FROM users WHERE role IN ('MANAGER', 'CUSTOMER');
-- (bu sorgu down.sql çalıştırılmadan ÖNCE, forward şemadayken çalıştırılır.)
-- ============================================================================

-- 6-ters) advancedBuilderEnabled kolonunu geri ekle. NOT: forward migration'ın adım 6'sı
-- GERİ ALINAMAZ VERİ KAYBIYDI (§2.4 kural 3) — eski gerçek değerler kurtarılamaz, bu yüzden
-- 20260822154259_add_page_editor_roles migration'ındaki backfill kuralı tekrar uygulanır
-- (ADMIN/EDITOR = true, diğerleri = false) — tam olarak orijinal veriyle AYNI DEĞİL, ama
-- orijinal migration'ın kendi backfill mantığıyla tutarlı en iyi tahmindir.
ALTER TABLE "users" ADD COLUMN "advancedBuilderEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "advancedBuilderEnabled" = true WHERE "role" IN ('ADMIN', 'EDITOR');

-- 5-ters) Varsayılanı düşür (dönüşüm öncesi zorunlu)
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

-- 4/3-ters) Eski 3-tier tipi yeniden oluştur ve USING ile geri cast et
CREATE TYPE "SiteRole_old" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "SiteRole_old"
  USING (
    CASE "role"::text
      WHEN 'ADMIN'    THEN 'ADMIN'
      WHEN 'EDITOR'   THEN 'EDITOR'
      WHEN 'MANAGER'  THEN 'EDITOR'
      WHEN 'CUSTOMER' THEN 'VIEWER'
      WHEN 'USER'     THEN 'VIEWER'
    END
  )::"SiteRole_old";

DROP TYPE "SiteRole";
ALTER TYPE "SiteRole_old" RENAME TO "SiteRole";

-- 2-ters) Eski varsayılan
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
