-- Paket P (İş 1) — YALNIZCA EKLEME: hastanın saat dilimi (profil tercihi + randevu anındaki dilim). Nullable.

-- AlterTable
ALTER TABLE "appointment_bookings" ADD COLUMN     "patientTimeZone" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "timeZone" TEXT;
