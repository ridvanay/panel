-- [TCT] §9.7.5 KARAR J / §9.7.4 migration planı madde 4 (bağlayıcı).
-- CreateTable
CREATE TABLE "appointment_intakes" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "noteCiphertext" TEXT,
    "healthDataConsentAt" TIMESTAMP(3) NOT NULL,
    "healthDataConsentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_documents" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "bookingId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "appointment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_intakes_bookingId_key" ON "appointment_intakes"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_documents_seq_key" ON "appointment_documents"("seq");

-- CreateIndex
CREATE INDEX "appointment_documents_bookingId_deletedAt_idx" ON "appointment_documents"("bookingId", "deletedAt");

-- AddForeignKey
ALTER TABLE "appointment_intakes" ADD CONSTRAINT "appointment_intakes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_documents" ADD CONSTRAINT "appointment_documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
