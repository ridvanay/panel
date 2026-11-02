-- Paket AI (Is 3, hizli surum) - hizmet bazli online on gorusme (hasta koordinatoru). YALNIZCA EKLEME:
-- mevcut tablo/kolon/tip degismez, backfill yok. On kosul: 20261115090000_external_meetings (FK hedefi).

-- CreateEnum
CREATE TYPE "ServiceConsultationStatus" AS ENUM ('PENDING_PAYMENT', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "serviceBookingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "service_desks" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL DEFAULT 'Patient coordinator desk',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "minNoticeMin" INTEGER NOT NULL DEFAULT 120,
    "horizonDays" INTEGER NOT NULL DEFAULT 30,
    "maxParticipants" INTEGER NOT NULL DEFAULT 3,
    "paidEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_desks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_hours" (
    "id" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "service_desk_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_desk_closures" (
    "id" TEXT NOT NULL,
    "deskId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_desk_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coordinator_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "languages" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastAssignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coordinator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_consultations" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "deskId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "requestId" TEXT,
    "specialtyId" TEXT,
    "packageId" TEXT,
    "serviceName" TEXT NOT NULL,
    "patientUserId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ServiceConsultationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "patientTimeZone" TEXT,
    "locale" TEXT,
    "needsInterpreter" BOOLEAN NOT NULL DEFAULT false,
    "interpreterLanguage" TEXT,
    "manageTokenHash" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "reminded24hAt" TIMESTAMP(3),
    "reminded60mAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "rescheduledCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_consultations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_hours_deskId_dayOfWeek_startMinute_key" ON "service_desk_hours"("deskId", "dayOfWeek", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "service_desk_closures_deskId_date_key" ON "service_desk_closures"("deskId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "coordinator_profiles_userId_key" ON "coordinator_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "service_consultations_seq_key" ON "service_consultations"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "service_consultations_meetingId_key" ON "service_consultations"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "service_consultations_requestId_key" ON "service_consultations"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "service_consultations_manageTokenHash_key" ON "service_consultations"("manageTokenHash");

-- CreateIndex
CREATE INDEX "service_consultations_coordinatorId_startsAt_idx" ON "service_consultations"("coordinatorId", "startsAt");

-- CreateIndex
CREATE INDEX "service_consultations_deskId_startsAt_idx" ON "service_consultations"("deskId", "startsAt");

-- CreateIndex
CREATE INDEX "service_consultations_status_startsAt_idx" ON "service_consultations"("status", "startsAt");

-- AddForeignKey
ALTER TABLE "service_desk_hours" ADD CONSTRAINT "service_desk_hours_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "service_desks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_desk_closures" ADD CONSTRAINT "service_desk_closures_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "service_desks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coordinator_profiles" ADD CONSTRAINT "coordinator_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_deskId_fkey" FOREIGN KEY ("deskId") REFERENCES "service_desks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "coordinator_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "external_meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "consultation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "health_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_patientUserId_fkey" FOREIGN KEY ("patientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Elle SQL (Prisma ifade edemez) --------------------------------------------------------------------

-- Ayni koordinatore ayni baslangicta iki etkin gorusme olamaz (cakismanin ikinci savunma hatti).
CREATE UNIQUE INDEX "service_consultations_coordinator_active_start"
  ON "service_consultations"("coordinatorId", "startsAt")
  WHERE "status" IN ('SCHEDULED', 'PENDING_PAYMENT');

-- Aralik denetimleri.
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_time_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "service_desk_hours" ADD CONSTRAINT "service_desk_hours_range_check"
  CHECK ("dayOfWeek" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
