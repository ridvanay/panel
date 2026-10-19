-- 2026-10-19 (güvenlik backlog) — YALNIZCA EKLEME: nullable kolonlar, default yok.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionsValidAfter" TIMESTAMP(3),
ADD COLUMN     "twoFactorLastUsedStep" INTEGER;

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "staffTwoFactorRequiredAt" TIMESTAMP(3);
