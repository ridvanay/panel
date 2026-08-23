-- ============================================================================
-- SiteRole: ADMIN/EDITOR/VIEWER (3 tier) -> ADMIN/MANAGER/EDITOR/CUSTOMER/USER (5 tier)
-- Bağlayıcı karar dokümanı: .claude/architect-scope-rbac-5-tier.md §1, §2.4.
-- İZOLE migration — bu dosyaya başka hiçbir şema değişikliği eklenmez (§2.4 kural 2).
--
-- Veri eşlemesi (§2.1):
--   ADMIN    -> ADMIN     (etki yok)
--   EDITOR   -> EDITOR    (etki yok, kapsam daralması uygulama katmanında/route guard'larında)
--   VIEWER   -> USER      (panel erişimini TAMAMEN kaybeder — bilinçli yetki daraltması, §2.2)
--
-- Otomatik terfi YAPILMAZ. Aşağıdaki operasyonel sorgular devops-agent tarafından
-- migration'dan ÖNCE çalıştırılıp deploy notuna eklenmelidir (§2.2, §2.3):
--
--   -- Eski VIEWER hesapları (migration sonrası panele hiç giremeyecek):
--   SELECT id, email, name FROM users WHERE role = 'VIEWER' AND status <> 'DELETED';
--
--   -- Eski EDITOR hesapları (migration sonrası kapsamı daralacak: products/portfolio/
--   -- contact-submissions/stats erişimini kaybedecek, bkz. §2.3):
--   SELECT id, email, name FROM users WHERE role = 'EDITOR' AND status <> 'DELETED';
--
-- Bu listelerdeki hesaplardan panele/ek kapsama gerçekten ihtiyacı olanlar migration
-- SONRASINDA ADMIN tarafından elle MANAGER/EDITOR'e yükseltilir (bkz. README.md, bu klasör).
-- Ayrıntılı README: bu migration klasöründeki README.md.
-- ============================================================================

-- 1) Yeni tip
CREATE TYPE "SiteRole_new" AS ENUM ('ADMIN', 'MANAGER', 'EDITOR', 'CUSTOMER', 'USER');

-- 2) Varsayılanı düşür (varsayılan varken tip dönüşümü yapılamaz)
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

-- 3) Kolonu dönüştür + VIEWER eşlemesi
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "SiteRole_new"
  USING (CASE WHEN "role"::text = 'VIEWER' THEN 'USER' ELSE "role"::text END)::"SiteRole_new";

-- 4) Tipleri takas et
DROP TYPE "SiteRole";
ALTER TYPE "SiteRole_new" RENAME TO "SiteRole";

-- 5) Yeni varsayılan
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

-- 6) §3 — yetenek bayrağı kaldırılır (canUseAdvancedBuilder artık saf rol türevi:
--    role === 'ADMIN'; bkz. backend-agent'ın lib/builder-capability.ts'i).
--    GERİ ALINAMAZ VERİ KAYBI: mevcut advancedBuilderEnabled=true değerleri kaybolur.
--    Kabul edilir (§2.4 kural 3) — yeni modelde bu bilginin türetilebilir bir karşılığı yok
--    ve gerekli de değil (MANAGER/EDITOR için değer zaten her koşulda false'a eşdeğerdi).
ALTER TABLE "users" DROP COLUMN "advancedBuilderEnabled";

-- NOT (indeksleme, bilinçli karar — §2.4 kural 4): "users"."role" üzerinde İNDEKS
-- EKLENMEZ. Bugün de yok; rol dağılımı sorgusu (GET /admin/stats/users) tam tarama yapıyor
-- ve kullanıcı tablosu küçük. İhtiyaç ölçümle kanıtlanırsa performance-agent açar.
