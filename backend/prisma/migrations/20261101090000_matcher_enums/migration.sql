-- Paket W — YALNIZCA EKLEME. Enum değerleri İZOLE migration'da (ALTER TYPE ... ADD VALUE aynı işlemde
-- kullanılamaz; sonraki migration'daki sistem şablonu satırı MATCHER_NEW_LEAD değerini kullanır).
-- AlterEnum
ALTER TYPE "CrmLeadChannel" ADD VALUE 'MATCHER';

-- AlterEnum
ALTER TYPE "EmailTemplatePurpose" ADD VALUE 'MATCHER_NEW_LEAD';
