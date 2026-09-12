-- [TCT] §9.7.4 migration planı madde 2 / §9.7.8 (bağlayıcı) — YALNIZCA bu ALTER TYPE.
-- Postgres kısıtı: ALTER TYPE ... ADD VALUE kendi transaction'ında YALNIZ başına olmalı;
-- bu yüzden bu migration dosyasında başka HİÇBİR DDL yoktur.
-- AlterEnum
ALTER TYPE "EmailTemplatePurpose" ADD VALUE 'APPOINTMENT_CONFIRMATION';
