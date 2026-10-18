-- 2026-10-18 (Paket B2/B4) — YALNIZCA EKLEME: nullable kolonlar, default yok, mevcut kolonlara dokunulmaz.
-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointment_bookings" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedReason" TEXT;
