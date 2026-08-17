-- CreateEnum
CREATE TYPE "ContactFieldType" AS ENUM ('TEXT', 'EMAIL', 'PHONE', 'TEXTAREA', 'SELECT', 'CHECKBOX');

-- CreateEnum
CREATE TYPE "ContactSubmissionStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED', 'SPAM');

-- CreateTable
CREATE TABLE "contact_forms" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "title" TEXT NOT NULL DEFAULT 'İletişim',
    "description" TEXT,
    "submitLabel" TEXT NOT NULL DEFAULT 'Gönder',
    "successMessage" TEXT NOT NULL DEFAULT 'Mesajınız alındı. En kısa sürede dönüş yapacağız.',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" TEXT,
    "notificationTemplateId" TEXT,
    "consentRequired" BOOLEAN NOT NULL DEFAULT true,
    "consentText" TEXT NOT NULL DEFAULT '',
    "consentLegalPageId" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 180,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_form_fields" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "formId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ContactFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "helpText" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "maxLength" INTEGER,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "formId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" "ContactSubmissionStatus" NOT NULL DEFAULT 'NEW',
    "consentAt" TIMESTAMP(3),
    "consentTextSnapshot" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "piiRedactedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notificationError" TEXT,
    "readAt" TIMESTAMP(3),
    "readById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_form_fields_seq_key" ON "contact_form_fields"("seq");

-- CreateIndex
CREATE INDEX "contact_form_fields_formId_order_idx" ON "contact_form_fields"("formId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "contact_form_fields_formId_key_key" ON "contact_form_fields"("formId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "contact_submissions_seq_key" ON "contact_submissions"("seq");

-- CreateIndex
CREATE INDEX "contact_submissions_formId_status_seq_idx" ON "contact_submissions"("formId", "status", "seq");

-- CreateIndex
CREATE INDEX "contact_submissions_createdAt_idx" ON "contact_submissions"("createdAt");

-- AddForeignKey
ALTER TABLE "contact_forms" ADD CONSTRAINT "contact_forms_notificationTemplateId_fkey" FOREIGN KEY ("notificationTemplateId") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_forms" ADD CONSTRAINT "contact_forms_consentLegalPageId_fkey" FOREIGN KEY ("consentLegalPageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_forms" ADD CONSTRAINT "contact_forms_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_form_fields" ADD CONSTRAINT "contact_form_fields_formId_fkey" FOREIGN KEY ("formId") REFERENCES "contact_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_formId_fkey" FOREIGN KEY ("formId") REFERENCES "contact_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_readById_fkey" FOREIGN KEY ("readById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
