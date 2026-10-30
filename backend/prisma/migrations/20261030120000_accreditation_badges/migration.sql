-- Paket V (İş 4) — YALNIZCA EKLEME: yetki belgeleri ve akreditasyonlar tablosu. Mevcut tablolara
-- dokunulmaz (Media'daki karşı-ilişki yalnızca Prisma alanıdır, kolon eklemez). Seed yok.

-- CreateTable
CREATE TABLE "accreditation_badges" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "logoMediaId" TEXT,
    "certificateNo" TEXT,
    "verificationUrl" TEXT,
    "validUntil" DATE,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accreditation_badges_pkey" PRIMARY KEY ("id"),
    -- Belge numarası olmayan kayıt aktif edilemez (backend doğrulamasının DB'deki güvencesi).
    CONSTRAINT "accreditation_badges_active_requires_certificate" CHECK (NOT "isActive" OR ("certificateNo" IS NOT NULL AND btrim("certificateNo") <> ''))
);

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_badges_seq_key" ON "accreditation_badges"("seq");

-- CreateIndex
CREATE INDEX "accreditation_badges_isActive_sortOrder_idx" ON "accreditation_badges"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "accreditation_badges_logoMediaId_idx" ON "accreditation_badges"("logoMediaId");

-- AddForeignKey
ALTER TABLE "accreditation_badges" ADD CONSTRAINT "accreditation_badges_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
