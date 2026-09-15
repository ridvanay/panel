-- AlterTable
-- [DPT] Demo ödeme admin toggle. Bu kolon YALNIZCA KISITLAYICI bir katmandır: nihai bayrak
-- backend/src/config/env.ts::isDemoPaymentsEnabled (env) && site_settings.demoPaymentsEnabled (DB)
-- şeklinde AND'lenir; bu kolon tek başına demo ödemeyi ASLA açamaz (env de true olmalı).
-- Varsayılan true olmasının güvenlik etkisi yoktur çünkü prod'da env tarafı her zaman false'tur
-- (bkz. .claude/security-review-demo-payment-toggle.md, .claude/architect-scope-demo-payment-doctor-counters.md
-- "EK KARAR — 2026-09-15").
ALTER TABLE "site_settings" ADD COLUMN     "demoPaymentsEnabled" BOOLEAN NOT NULL DEFAULT true;
