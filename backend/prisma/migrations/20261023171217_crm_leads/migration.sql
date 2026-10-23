-- 2026-10-23 (Paket N2) — YALNIZCA YENİ TABLOLAR: CRM talepleri ve şifreli notları. Mevcut tablolara
-- dokunulmaz; kaynak kayıtlara (form/sohbet/randevu) yalnızca düz kimlikle (FK'siz) referans verilir.
-- CreateEnum
CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'CALLED', 'UNREACHABLE', 'APPOINTMENT_GIVEN', 'CONSULTED', 'TREATMENT_PLANNED', 'TREATED', 'NEGATIVE', 'SPAM');

-- CreateEnum
CREATE TYPE "CrmLeadChannel" AS ENUM ('CONTACT_FORM', 'LIVE_CHAT', 'WHATSAPP', 'PHONE', 'EMAIL', 'BOOKING_ABANDONED', 'MANUAL', 'ADS_IMPORT');

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "channel" "CrmLeadChannel" NOT NULL,
    "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
    "candidate" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "country" TEXT,
    "language" TEXT,
    "specialtyId" TEXT,
    "specialtyName" TEXT,
    "doctorId" TEXT,
    "doctorName" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "landingPath" TEXT,
    "gclid" TEXT,
    "refCode" TEXT,
    "sourceRefId" TEXT,
    "assignedToId" TEXT,
    "firstResponseAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT,
    "visitorId" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_notes" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "authorId" TEXT,
    "authorName" TEXT,
    "bodyCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_seq_key" ON "crm_leads"("seq");

-- CreateIndex
CREATE INDEX "crm_leads_status_createdAt_idx" ON "crm_leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "crm_leads_createdAt_idx" ON "crm_leads"("createdAt");

-- CreateIndex
CREATE INDEX "crm_leads_nextActionAt_idx" ON "crm_leads"("nextActionAt");

-- CreateIndex
CREATE INDEX "crm_leads_email_idx" ON "crm_leads"("email");

-- CreateIndex
CREATE INDEX "crm_leads_phone_idx" ON "crm_leads"("phone");

-- CreateIndex
CREATE INDEX "crm_leads_refCode_idx" ON "crm_leads"("refCode");

-- CreateIndex
CREATE INDEX "crm_leads_assignedToId_idx" ON "crm_leads"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_channel_sourceRefId_key" ON "crm_leads"("channel", "sourceRefId");

-- CreateIndex
CREATE INDEX "crm_lead_notes_leadId_createdAt_idx" ON "crm_lead_notes"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "crm_lead_notes" ADD CONSTRAINT "crm_lead_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
