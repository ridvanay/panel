-- Paket P (İş 2) — YALNIZCA YENİ TABLO: doktor izin/istisna aralıkları (mevcut tablolara dokunulmaz).

-- CreateTable
CREATE TABLE "doctor_time_off" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_time_off_doctorId_startsAt_idx" ON "doctor_time_off"("doctorId", "startsAt");

-- AddForeignKey
ALTER TABLE "doctor_time_off" ADD CONSTRAINT "doctor_time_off_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
