-- Paket AG (Is 2) - admin randevu bildirimi. Yalnizca ekleme.
-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN "bookingNotificationRecipients" TEXT;

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" TEXT,
    "appointmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_notifications_eventKey_key" ON "admin_notifications"("eventKey");

-- CreateIndex
CREATE INDEX "admin_notifications_status_nextAttemptAt_idx" ON "admin_notifications"("status", "nextAttemptAt");
