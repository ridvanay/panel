-- Paket Q — YALNIZCA EKLEME: toplu çalışma saati/izin işlemlerinin geri alma kaydı (yeni tablo).

-- CreateTable
CREATE TABLE "doctor_availability_bulk_operations" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "doctorCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "doctor_availability_bulk_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_availability_bulk_operations_createdAt_idx" ON "doctor_availability_bulk_operations"("createdAt");
