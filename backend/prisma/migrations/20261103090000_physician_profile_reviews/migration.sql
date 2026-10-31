-- Paket Y — zengin hekim profili (hastane, SSS, işlemler, foto/video), hasta yorumları ve hastanın dili.
-- YALNIZCA EKLEME: yeni tablolar ve NULL olabilen/varsayılanlı kolonlar; mevcut veri değişmez.
-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "faq" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "hospitalName" TEXT;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reviewRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointment_bookings" ADD COLUMN     "locale" TEXT;

-- CreateTable
CREATE TABLE "doctor_procedures" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "relatedCareTopicIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_media" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mediaId" TEXT,
    "videoProvider" TEXT,
    "videoId" TEXT,
    "category" TEXT NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "showsPatient" BOOLEAN NOT NULL DEFAULT false,
    "patientConsentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "consentNote" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT,
    "specialtyId" TEXT,
    "bookingId" TEXT,
    "authorUserId" TEXT,
    "authorDisplay" TEXT NOT NULL,
    "displayMode" TEXT NOT NULL DEFAULT 'initials',
    "country" TEXT,
    "language" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentEvidenceNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "redactionCount" INTEGER NOT NULL DEFAULT 0,
    "featuredOnHome" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "doctorReply" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonial_invites" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonial_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_procedures_doctorId_isPublished_sortOrder_idx" ON "doctor_procedures"("doctorId", "isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "doctor_media_doctorId_isPublished_sortOrder_idx" ON "doctor_media"("doctorId", "isPublished", "sortOrder");

-- CreateIndex
CREATE INDEX "doctor_media_mediaId_idx" ON "doctor_media"("mediaId");

-- CreateIndex
CREATE INDEX "testimonials_doctorId_status_publishedAt_idx" ON "testimonials"("doctorId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "testimonials_status_featuredOnHome_idx" ON "testimonials"("status", "featuredOnHome");

-- CreateIndex
CREATE INDEX "testimonials_bookingId_idx" ON "testimonials"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "testimonial_invites_bookingId_key" ON "testimonial_invites"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "testimonial_invites_tokenHash_key" ON "testimonial_invites"("tokenHash");

-- AddForeignKey
ALTER TABLE "doctor_procedures" ADD CONSTRAINT "doctor_procedures_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_media" ADD CONSTRAINT "doctor_media_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_media" ADD CONSTRAINT "doctor_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonial_invites" ADD CONSTRAINT "testimonial_invites_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "appointment_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

