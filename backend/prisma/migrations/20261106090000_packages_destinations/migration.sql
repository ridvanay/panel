-- Paket X — sağlık paketleri, paket talepleri, destinasyonlar (yalnızca EKLEME; mevcut veri değişmez).
-- AlterEnum
ALTER TYPE "CrmLeadChannel" ADD VALUE 'PACKAGE';

-- CreateTable
CREATE TABLE "health_packages" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "coverMediaId" TEXT,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "priceFrom" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "showPrice" BOOLEAN NOT NULL DEFAULT false,
    "relatedSpecialtyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedDoctorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_inquiries" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "leadId" TEXT NOT NULL,
    "packageId" TEXT,
    "packageSlug" TEXT NOT NULL,
    "packageTitle" TEXT NOT NULL,
    "preferredDates" TEXT,
    "travellers" INTEGER,
    "note" TEXT,
    "consentContactAt" TIMESTAMP(3) NOT NULL,
    "consentHealthAt" TIMESTAMP(3),
    "consentTextVersion" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destination_highlights" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "coverMediaId" TEXT,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "topTreatments" JSONB NOT NULL DEFAULT '[]',
    "patientCountLastYear" INTEGER,
    "dataPeriodLabel" TEXT,
    "showPrices" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "destination_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_packages_seq_key" ON "health_packages"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "health_packages_slug_key" ON "health_packages"("slug");

-- CreateIndex
CREATE INDEX "health_packages_isActive_isFeatured_sortOrder_idx" ON "health_packages"("isActive", "isFeatured", "sortOrder");

-- CreateIndex
CREATE INDEX "health_packages_coverMediaId_idx" ON "health_packages"("coverMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "package_inquiries_seq_key" ON "package_inquiries"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "package_inquiries_leadId_key" ON "package_inquiries"("leadId");

-- CreateIndex
CREATE INDEX "package_inquiries_packageId_idx" ON "package_inquiries"("packageId");

-- CreateIndex
CREATE INDEX "package_inquiries_createdAt_idx" ON "package_inquiries"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "destination_highlights_slug_key" ON "destination_highlights"("slug");

-- CreateIndex
CREATE INDEX "destination_highlights_isActive_sortOrder_idx" ON "destination_highlights"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "destination_highlights_coverMediaId_idx" ON "destination_highlights"("coverMediaId");

-- AddForeignKey
ALTER TABLE "health_packages" ADD CONSTRAINT "health_packages_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_inquiries" ADD CONSTRAINT "package_inquiries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_inquiries" ADD CONSTRAINT "package_inquiries_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "health_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_highlights" ADD CONSTRAINT "destination_highlights_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

