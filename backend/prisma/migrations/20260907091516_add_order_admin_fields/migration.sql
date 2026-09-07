-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "cancellationReason" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");
