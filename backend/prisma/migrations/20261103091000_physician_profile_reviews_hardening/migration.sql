-- Paket Y (db-agent incelemesi) — YALNIZCA EKLEME: değer sınırları, booking başına tek yorum ve davet
-- süpürücüsü için kısmi indeks. Prisma CHECK/kısmi indeksi ifade edemez; schema.prisma'da yorumla
-- belgelendi (`migrate dev` bunları silmeyi önerirse o satırlar üretilen migration'dan çıkarılmalı).
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'hidden'));
CREATE UNIQUE INDEX "testimonials_bookingId_unique_not_null" ON "testimonials"("bookingId") WHERE "bookingId" IS NOT NULL;
CREATE INDEX "appointments_review_sweep_idx" ON "appointments"("endsAt") WHERE "status" = 'COMPLETED' AND "reviewRequestedAt" IS NULL;
