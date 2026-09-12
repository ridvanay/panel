-- [TCT] §9.7.3 KARAR I / §9.7.4 migration planı madde 1 (bağlayıcı) — YALNIZCA bu ALTER TYPE.
-- Postgres kısıtı: ALTER TYPE ... ADD VALUE kendi transaction'ında YALNIZ başına olmalı;
-- bu yüzden bu migration dosyasında başka HİÇBİR DDL yoktur.
-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PENDING_PAYMENT' BEFORE 'SCHEDULED';
