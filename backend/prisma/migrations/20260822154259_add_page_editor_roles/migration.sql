-- CreateEnum
CREATE TYPE "PageEditMode" AS ENUM ('FREEFORM', 'TEMPLATE');

-- AlterTable
-- Sayfa düzenleyicide standart/gelişmiş mod ayrımı (bkz.
-- .claude/architect-scope-page-editor-roles.md §2). Varsayılan FREEFORM = bugünkü
-- davranışla birebir aynı; backfill GEREKMEZ (§2.4).
ALTER TABLE "pages" ADD COLUMN     "editMode" "PageEditMode" NOT NULL DEFAULT 'FREEFORM';

-- AlterTable
-- Kullanıcı-başı gelişmiş sayfa düzenleyici yetenek bayrağı (bkz.
-- .claude/architect-scope-page-editor-roles.md §1). Kolon varsayılanı false (yeni hesaplar
-- için en az ayrıcalık) — bkz. aşağıdaki backfill.
ALTER TABLE "users" ADD COLUMN     "advancedBuilderEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Backfill (§6.1 madde 2, bağlayıcı) — mevcut ADMIN/EDITOR hesaplarının yetkisi bu
-- migration ile SESSİZCE DARALTILAMAZ; kolon varsayılanı false olsa da yayındaki bu
-- hesaplar gelişmiş düzenleyiciyi kullanmaya devam eder. VIEWER hesapları etkilenmez
-- (zaten sayfa yazma uçlarına erişemiyor, bkz. requireSiteRole). İDEMPOTENT: tekrar
-- çalıştırıldığında aynı sonucu üretir.
-- ============================================================================
UPDATE "users" SET "advancedBuilderEnabled" = true WHERE "role" IN ('ADMIN', 'EDITOR');
