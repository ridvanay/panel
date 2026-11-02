-- Paket AG (Is 3) - harici goruntulu toplanti. Yalnizca ekleme: mevcut tablo/kolon degismez, backfill yok.

-- CreateEnum
CREATE TYPE "ExternalMeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "meetingHostGrantedAt" TIMESTAMP(3),
ADD COLUMN     "meetingHostGrantedById" TEXT;

-- CreateTable
CREATE TABLE "external_meetings" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 4,
    "roomName" TEXT NOT NULL,
    "guestTokenHash" TEXT,
    "guestTokenCreatedAt" TIMESTAMP(3),
    "autoAdmitGuests" BOOLEAN NOT NULL DEFAULT false,
    "hostJoinedAt" TIMESTAMP(3),
    "inviteCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ExternalMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_meeting_guests" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "admittedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "external_meeting_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_meetings_seq_key" ON "external_meetings"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "external_meetings_roomName_key" ON "external_meetings"("roomName");

-- CreateIndex
CREATE UNIQUE INDEX "external_meetings_guestTokenHash_key" ON "external_meetings"("guestTokenHash");

-- CreateIndex
CREATE INDEX "external_meetings_hostUserId_startsAt_idx" ON "external_meetings"("hostUserId", "startsAt");

-- CreateIndex
CREATE INDEX "external_meetings_status_endsAt_idx" ON "external_meetings"("status", "endsAt");

-- CreateIndex
CREATE INDEX "external_meetings_closedAt_endsAt_idx" ON "external_meetings"("closedAt", "endsAt");

-- CreateIndex
CREATE INDEX "external_meeting_guests_meetingId_createdAt_idx" ON "external_meeting_guests"("meetingId", "createdAt");

-- AddForeignKey
ALTER TABLE "external_meetings" ADD CONSTRAINT "external_meetings_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_meeting_guests" ADD CONSTRAINT "external_meeting_guests_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "external_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
