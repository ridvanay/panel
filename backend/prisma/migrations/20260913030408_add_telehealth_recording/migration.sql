-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING_CONSENT', 'RECORDING', 'PROCESSING', 'COMPLETED', 'CONSENT_DENIED', 'FAILED');

-- CreateTable
CREATE TABLE "consultation_recordings" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "egressId" TEXT,
    "doctorConsentAt" TIMESTAMP(3),
    "doctorConsentVersion" TEXT,
    "consentRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patientConsentAt" TIMESTAMP(3),
    "patientConsentVersion" TEXT,
    "patientConsentDeniedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "fileSizeBytes" INTEGER,
    "storagePath" TEXT,
    "failureReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultation_recordings_seq_key" ON "consultation_recordings"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_recordings_appointmentId_key" ON "consultation_recordings"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_recordings_egressId_key" ON "consultation_recordings"("egressId");

-- CreateIndex
CREATE INDEX "consultation_recordings_status_deletedAt_idx" ON "consultation_recordings"("status", "deletedAt");

-- AddForeignKey
ALTER TABLE "consultation_recordings" ADD CONSTRAINT "consultation_recordings_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
