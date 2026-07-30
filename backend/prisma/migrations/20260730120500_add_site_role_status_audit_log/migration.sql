-- CreateEnum
CREATE TYPE "SiteRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "SiteUserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE', 'FORBIDDEN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "role" "SiteRole" NOT NULL DEFAULT 'EDITOR',
ADD COLUMN     "seq" SERIAL NOT NULL,
ADD COLUMN     "status" "SiteUserStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'SUCCESS',
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_seq_key" ON "audit_logs"("seq");

-- CreateIndex
CREATE INDEX "audit_logs_status_idx" ON "audit_logs"("status");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "users_seq_key" ON "users"("seq");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: sistemde kilitlenme olmasın diye mevcut en eski kullanıcı ADMIN yapılır
-- (yeni kurulan ortamlarda bu tablo boş olacağından etkisizdir; auth.service.ts::register()
-- içindeki "ilk kullanıcı ADMIN" mantığı sıfırdan kurulumları zaten kapsar).
UPDATE "users" SET "role" = 'ADMIN'
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "createdAt" ASC LIMIT 1);
