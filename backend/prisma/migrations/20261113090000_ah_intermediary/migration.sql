-- Paket AH (Faz 1) - saglik turizmi araci kurulus donusumu. YALNIZCA EKLEME; mevcut veri degismez/silinmez.

-- AlterEnum
ALTER TYPE "CrmLeadChannel" ADD VALUE 'CONSULTATION_REQUEST';

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN "healthTourismCertificateNo" TEXT,
ADD COLUMN "blogMedicalReviewRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "consultation_requests" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "leadId" TEXT NOT NULL,
    "specialtyId" TEXT,
    "packageId" TEXT,
    "serviceName" TEXT NOT NULL,
    "preferredFrom" DATE,
    "preferredTo" DATE,
    "country" TEXT NOT NULL,
    "contactLanguage" TEXT NOT NULL,
    "needsInterpreter" BOOLEAN NOT NULL DEFAULT false,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "messageEncrypted" TEXT,
    "contactConsentAt" TIMESTAMP(3) NOT NULL,
    "healthDataConsentAt" TIMESTAMP(3),
    "consentTextVersion" TEXT,
    "locale" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultation_requests_seq_key" ON "consultation_requests"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_requests_leadId_key" ON "consultation_requests"("leadId");

-- CreateIndex
CREATE INDEX "consultation_requests_specialtyId_idx" ON "consultation_requests"("specialtyId");

-- CreateIndex
CREATE INDEX "consultation_requests_packageId_idx" ON "consultation_requests"("packageId");

-- CreateIndex
CREATE INDEX "consultation_requests_createdAt_idx" ON "consultation_requests"("createdAt");

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "health_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
