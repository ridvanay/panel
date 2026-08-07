-- CreateTable
CREATE TABLE "site_modules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_modules_key_key" ON "site_modules"("key");

-- CreateIndex
CREATE INDEX "site_modules_updatedById_idx" ON "site_modules"("updatedById");

-- AddForeignKey
ALTER TABLE "site_modules" ADD CONSTRAINT "site_modules_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
