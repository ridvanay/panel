-- Paket P ek (2) — YALNIZCA EKLEME: aynı anda en fazla BİR kurucu doktor (DB düzeyinde garanti).
-- Kısmi benzersiz indeks; isFounder=false satırları kapsam dışıdır. Prisma şeması kısmi indeksi
-- ifade edemez: ileride `migrate dev` bu indeksi DROP etmeyi önerirse o satır migration'dan silinmelidir.
-- Ön koşul: tabloda birden fazla isFounder=true satırı OLMAMALI (uygulama kontrolü bunu zaten sağlıyor).

-- CreateIndex
CREATE UNIQUE INDEX "doctor_profiles_single_founder_key" ON "doctor_profiles" ("isFounder") WHERE "isFounder" = true;
