-- Paket AE-ek — otomatik medya dönüştürme (yalnızca EKLEME; mevcut veri değişmez).
ALTER TABLE "media" ADD COLUMN "variants" JSONB;
ALTER TABLE "media" ADD COLUMN "processingStatus" TEXT;

CREATE TABLE "media_transcode_jobs" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sourcePath" TEXT,
    "sourceContainer" TEXT NOT NULL,
    "sourceSizeBytes" INTEGER NOT NULL,
    "sourceCodec" TEXT,
    "sourceDurationSec" DOUBLE PRECISION,
    "outputSizeBytes" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "sourceDeleteAfter" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_transcode_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_transcode_jobs_mediaId_key" ON "media_transcode_jobs"("mediaId");
CREATE INDEX "media_transcode_jobs_status_notBefore_queuedAt_idx" ON "media_transcode_jobs"("status", "notBefore", "queuedAt");
ALTER TABLE "media_transcode_jobs" ADD CONSTRAINT "media_transcode_jobs_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
