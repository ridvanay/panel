-- [TCT] §9.7.2 KARAR H / §9.7.4 migration planı madde 3 (bağlayıcı).
-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "bookingId" TEXT;

-- CreateTable
CREATE TABLE "appointment_bookings" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientUserId" TEXT,
    "patientName" TEXT NOT NULL,
    "patientEmail" TEXT NOT NULL,
    "slotCount" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "paymentStatus" "BookingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidNote" TEXT,
    "errorSummary" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "meetingRoomName" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_bookings_seq_key" ON "appointment_bookings"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_bookings_bookingNumber_key" ON "appointment_bookings"("bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_bookings_stripeCheckoutSessionId_key" ON "appointment_bookings"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_bookings_meetingRoomName_key" ON "appointment_bookings"("meetingRoomName");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_bookings_accessTokenHash_key" ON "appointment_bookings"("accessTokenHash");

-- CreateIndex
CREATE INDEX "appointment_bookings_doctorId_createdAt_idx" ON "appointment_bookings"("doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "appointment_bookings_patientUserId_idx" ON "appointment_bookings"("patientUserId");

-- CreateIndex
CREATE INDEX "appointment_bookings_paymentStatus_expiresAt_idx" ON "appointment_bookings"("paymentStatus", "expiresAt");

-- CreateIndex
CREATE INDEX "appointment_bookings_stripePaymentIntentId_idx" ON "appointment_bookings"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "appointments_bookingId_idx" ON "appointments"("bookingId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_bookings" ADD CONSTRAINT "appointment_bookings_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_bookings" ADD CONSTRAINT "appointment_bookings_patientUserId_fkey" FOREIGN KEY ("patientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
