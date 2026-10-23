-- 2026-10-23 (Paket N1) — YALNIZCA YENİ TABLOLAR: CRM takip altyapısı (ziyaretçi/oturum/olay/onay/
-- günlük özet/randevu atfı). Mevcut tablolara dokunulmaz; FK'ler yalnızca yeni tablolar arasındadır.
-- CreateEnum
CREATE TYPE "CrmEventType" AS ENUM ('PAGEVIEW', 'HEARTBEAT', 'CLICK', 'SCROLL', 'WHATSAPP_CLICK', 'PHONE_CLICK', 'EMAIL_CLICK', 'FORM_SUBMIT', 'BOOKING_STEP', 'BOOKING_COMPLETED', 'CUSTOM');

-- CreateTable
CREATE TABLE "crm_visitors" (
    "id" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSource" TEXT,
    "firstMedium" TEXT,
    "firstCampaign" TEXT,
    "firstReferrerHost" TEXT,
    "firstLandingPath" TEXT,
    "country" TEXT,
    "language" TEXT,
    "timezone" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "consentVersion" TEXT,
    "refCode" TEXT,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "pageviewCount" INTEGER NOT NULL DEFAULT 0,
    "engagedSeconds" INTEGER NOT NULL DEFAULT 0,
    "contactClicks" INTEGER NOT NULL DEFAULT 0,
    "reachedBooking" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "botFlagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crm_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sessions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "campaign" TEXT,
    "term" TEXT,
    "content" TEXT,
    "referrerHost" TEXT,
    "landingPath" TEXT NOT NULL,
    "exitPath" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT,
    "city" TEXT,
    "ip" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "browser" TEXT,
    "os" TEXT,
    "language" TEXT,
    "timezone" TEXT,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "reachedDoctorPage" BOOLEAN NOT NULL DEFAULT false,
    "bookingStarted" BOOLEAN NOT NULL DEFAULT false,
    "contactClicked" BOOLEAN NOT NULL DEFAULT false,
    "botFlagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crm_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_events" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "type" "CrmEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "selector" TEXT,
    "text" TEXT,
    "target" TEXT,
    "name" TEXT,
    "props" JSONB,
    "xPct" DOUBLE PRECISION,
    "yPct" DOUBLE PRECISION,
    "elXPct" DOUBLE PRECISION,
    "elYPct" DOUBLE PRECISION,
    "viewportW" INTEGER,
    "viewportH" INTEGER,
    "docH" INTEGER,
    "scrollPct" INTEGER,
    "step" INTEGER,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "isRage" BOOLEAN NOT NULL DEFAULT false,
    "isDead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_consents" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "visitorId" TEXT,
    "version" TEXT NOT NULL,
    "analytics" BOOLEAN NOT NULL,
    "marketing" BOOLEAN NOT NULL,
    "action" TEXT NOT NULL,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_daily_rollups" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "engagedSeconds" INTEGER NOT NULL DEFAULT 0,
    "scrollSum" INTEGER NOT NULL DEFAULT 0,
    "scrollCount" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "whatsappClicks" INTEGER NOT NULL DEFAULT 0,
    "phoneClicks" INTEGER NOT NULL DEFAULT 0,
    "emailClicks" INTEGER NOT NULL DEFAULT 0,
    "contacts" INTEGER NOT NULL DEFAULT 0,
    "bookingsStarted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crm_daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_attributions" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSource" TEXT,
    "firstMedium" TEXT,
    "firstCampaign" TEXT,
    "lastSource" TEXT NOT NULL,
    "lastMedium" TEXT NOT NULL,
    "lastCampaign" TEXT,
    "term" TEXT,
    "content" TEXT,
    "landingPath" TEXT,
    "referrerHost" TEXT,
    "country" TEXT,
    "language" TEXT,
    "deviceType" "DeviceType" NOT NULL DEFAULT 'UNKNOWN',
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,

    CONSTRAINT "crm_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_visitors_lastSeenAt_idx" ON "crm_visitors"("lastSeenAt");

-- CreateIndex
CREATE INDEX "crm_visitors_score_idx" ON "crm_visitors"("score");

-- CreateIndex
CREATE INDEX "crm_visitors_refCode_idx" ON "crm_visitors"("refCode");

-- CreateIndex
CREATE INDEX "crm_sessions_startedAt_idx" ON "crm_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "crm_sessions_lastSeenAt_idx" ON "crm_sessions"("lastSeenAt");

-- CreateIndex
CREATE INDEX "crm_sessions_visitorId_startedAt_idx" ON "crm_sessions"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "crm_events_occurredAt_idx" ON "crm_events"("occurredAt");

-- CreateIndex
CREATE INDEX "crm_events_type_occurredAt_idx" ON "crm_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_events_sessionId_occurredAt_idx" ON "crm_events"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_events_visitorId_occurredAt_idx" ON "crm_events"("visitorId", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_events_path_type_occurredAt_idx" ON "crm_events"("path", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "crm_consents_createdAt_idx" ON "crm_consents"("createdAt");

-- CreateIndex
CREATE INDEX "crm_consents_consentId_idx" ON "crm_consents"("consentId");

-- CreateIndex
CREATE INDEX "crm_daily_rollups_dimension_date_idx" ON "crm_daily_rollups"("dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "crm_daily_rollups_date_dimension_key_key" ON "crm_daily_rollups"("date", "dimension", "key");

-- CreateIndex
CREATE UNIQUE INDEX "crm_attributions_bookingId_key" ON "crm_attributions"("bookingId");

-- CreateIndex
CREATE INDEX "crm_attributions_createdAt_idx" ON "crm_attributions"("createdAt");

-- AddForeignKey
ALTER TABLE "crm_sessions" ADD CONSTRAINT "crm_sessions_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "crm_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_events" ADD CONSTRAINT "crm_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "crm_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
