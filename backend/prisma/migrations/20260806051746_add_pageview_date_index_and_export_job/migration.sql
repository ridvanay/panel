-- CreateEnum
CREATE TYPE "ExportJobType" AS ENUM ('VIEWS', 'BREAKDOWN', 'SUMMARY', 'TOP_CONTENT', 'USERS', 'REVENUE');

-- CreateEnum
CREATE TYPE "ExportFileFormat" AS ENUM ('CSV', 'PDF');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "type" "ExportJobType" NOT NULL,
    "format" "ExportFileFormat" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "storagePath" TEXT,
    "containsPii" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "errorSummary" TEXT,
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_seq_key" ON "export_jobs"("seq");

-- CreateIndex
CREATE INDEX "export_jobs_status_idx" ON "export_jobs"("status");

-- CreateIndex
CREATE INDEX "export_jobs_type_idx" ON "export_jobs"("type");

-- CreateIndex
CREATE INDEX "export_jobs_createdById_idx" ON "export_jobs"("createdById");

-- CreateIndex
CREATE INDEX "page_views_date_idx" ON "page_views"("date");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
