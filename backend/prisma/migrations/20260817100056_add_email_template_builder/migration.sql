-- CreateEnum
CREATE TYPE "EmailTemplatePurpose" AS ENUM ('WELCOME', 'PASSWORD_RESET', 'SYSTEM_ANNOUNCEMENT', 'ORDER_CONFIRMATION', 'ORG_INVITATION', 'CONTACT_FORM_NOTIFICATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EmailTemplateEditorMode" AS ENUM ('RAW', 'BLOCKS');

-- AlterTable
ALTER TABLE "email_templates" ADD COLUMN     "blocks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "customVariables" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "editorMode" "EmailTemplateEditorMode" NOT NULL DEFAULT 'BLOCKS',
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purpose" "EmailTemplatePurpose" NOT NULL DEFAULT 'CUSTOM',
ALTER COLUMN "key" DROP NOT NULL,
ALTER COLUMN "bodyHtml" SET DEFAULT '';

-- CreateIndex
CREATE INDEX "email_templates_purpose_isActive_idx" ON "email_templates"("purpose", "isActive");

-- Backfill (ZORUNLU, bkz. ARCHITECTURE.md §10.16.2): mevcut 5 seed şablonunun
-- purpose/editorMode/isSystem/isActive alanlarını doldurur. Bu adım YAPILMAZSA
-- `sendTemplateEmail` hiçbir şablon bulamaz ve kayıt/şifre sıfırlama/sipariş onayı
-- e-postalarının TAMAMI 404 ile düşer (§10.16.2, mimar tarafından kritik işaretlendi).
UPDATE "email_templates"
SET "purpose" = "key"::"EmailTemplatePurpose",
    "editorMode" = 'RAW',
    "isSystem" = true,
    "isActive" = true
WHERE "key" IN ('WELCOME', 'PASSWORD_RESET', 'SYSTEM_ANNOUNCEMENT', 'ORDER_CONFIRMATION', 'ORG_INVITATION');

-- "Amaç başına tek aktif şablon" kuralı — DB katmanı zorlaması (savunma derinliği,
-- bkz. ARCHITECTURE.md §10.16.3). Prisma şemasıyla ifade edilemeyen kısmi unique index
-- olduğu için burada elle eklenir; schema.prisma'da EmailTemplate.isActive alanının
-- yanına açıklama olarak not düşülmüştür. Backfill'den SONRA çalıştırılır ki mevcut 5
-- satır (birbirinden farklı purpose'larda, hepsi isActive=true) index oluşumunu ihlal
-- etmesin.
CREATE UNIQUE INDEX "email_templates_active_purpose_key"
  ON "email_templates" ("purpose")
  WHERE "isActive" = true AND "purpose" <> 'CUSTOM'::"EmailTemplatePurpose";
