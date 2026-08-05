-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('PAGES', 'BLOG', 'WORDPRESS', 'USERS', 'MEDIA');

-- CreateEnum
CREATE TYPE "ImportSourceFormat" AS ENUM ('CSV', 'JSON', 'XML', 'ZIP');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportDuplicateStrategy" AS ENUM ('SKIP', 'OVERWRITE', 'CREATE_NEW');

-- CreateEnum
CREATE TYPE "ImportErrorSeverity" AS ENUM ('ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "type" "ImportJobType" NOT NULL,
    "format" "ImportSourceFormat" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "duplicateStrategy" "ImportDuplicateStrategy",
    "filename" TEXT NOT NULL,
    "storagePath" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "preview" JSONB,
    "options" JSONB NOT NULL DEFAULT '{}',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdById" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_errors" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "ImportErrorSeverity" NOT NULL DEFAULT 'ERROR',
    "field" TEXT,
    "sourceRef" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_job_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_seq_key" ON "import_jobs"("seq");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_jobs_type_idx" ON "import_jobs"("type");

-- CreateIndex
CREATE INDEX "import_jobs_createdById_idx" ON "import_jobs"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "import_job_errors_seq_key" ON "import_job_errors"("seq");

-- CreateIndex
CREATE INDEX "import_job_errors_jobId_seq_idx" ON "import_job_errors"("jobId", "seq");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job_errors" ADD CONSTRAINT "import_job_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
