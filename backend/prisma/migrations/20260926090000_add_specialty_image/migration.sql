-- Uzmanlık kartı görseli: yalnızca boş geçilebilir bir kolon + FK + indeks. Veri değiştirmez,
-- varsayılan dilden bağımsızdır. Medya silinirse kolon NULL'a düşer (görsel olmayan kart).
ALTER TABLE "specialties" ADD COLUMN "imageMediaId" TEXT;

CREATE INDEX "specialties_imageMediaId_idx" ON "specialties"("imageMediaId");

ALTER TABLE "specialties" ADD CONSTRAINT "specialties_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
