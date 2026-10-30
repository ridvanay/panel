-- Paket AA — YALNIZCA EKLEME: SiteRole'e INTERPRETER değeri, yeni enum ve üç yeni tablo (tercüman profili,
-- booking başına tercüman ataması, hasta tercüman talebi). Mevcut tablo/kolonlara dokunulmaz.

-- CreateEnum
CREATE TYPE "InterpreterAssignmentStatus" AS ENUM ('ASSIGNED', 'JOINED', 'LEFT', 'REMOVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "SiteRole" ADD VALUE 'INTERPRETER';

-- CreateTable
CREATE TABLE "interpreter_profiles" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "languages" TEXT[],
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "confidentialityAcceptedAt" TIMESTAMP(3),
    "confidentialityVersion" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interpreter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_interpreters" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "bookingId" TEXT NOT NULL,
    "interpreterId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "InterpreterAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "removedById" TEXT,
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_interpreters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interpreter_requests" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interpreter_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interpreter_profiles_seq_key" ON "interpreter_profiles"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "interpreter_profiles_userId_key" ON "interpreter_profiles"("userId");

-- CreateIndex
CREATE INDEX "interpreter_profiles_isActive_idx" ON "interpreter_profiles"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_interpreters_seq_key" ON "appointment_interpreters"("seq");

-- CreateIndex
CREATE INDEX "appointment_interpreters_bookingId_status_idx" ON "appointment_interpreters"("bookingId", "status");

-- CreateIndex
CREATE INDEX "appointment_interpreters_interpreterId_status_idx" ON "appointment_interpreters"("interpreterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "interpreter_requests_bookingId_key" ON "interpreter_requests"("bookingId");

-- AddForeignKey
ALTER TABLE "interpreter_profiles" ADD CONSTRAINT "interpreter_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_interpreters" ADD CONSTRAINT "appointment_interpreters_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_interpreters" ADD CONSTRAINT "appointment_interpreters_interpreterId_fkey" FOREIGN KEY ("interpreterId") REFERENCES "interpreter_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interpreter_requests" ADD CONSTRAINT "interpreter_requests_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bir booking'e aynı anda en çok 1 aktif tercüman (ASSIGNED / JOINED / LEFT). Prisma şemada ifade edilemez.
CREATE UNIQUE INDEX "appointment_interpreters_one_active_per_booking" ON "appointment_interpreters"("bookingId") WHERE "status" IN ('ASSIGNED', 'JOINED', 'LEFT');
