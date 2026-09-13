-- [DPI] Karar B / §2.2 / §5 — AppointmentBooking hasta kimlik bilgisi kolonları + CitizenshipType.
-- NOT: db-agent bu migration'ı `prisma migrate diff` çıktısından ELLE değil, Prisma'nın
-- ürettiği SQL'den (schema-datasource -> schema-datamodel diff) DOKUNULMADAN aldı; ancak diff
-- çıktısında bu projeye özgü, DPI kapsamı DIŞINDA, önceden var olan bir şema sürüklenmesi
-- (tax_rates tablosu ve ilişkili kolonların DROP edilmesi, EmailTemplatePurpose enum yeniden
-- yazımı) da yer alıyordu. O kısım BİLİNÇLİ OLARAK bu migration'a DAHİL EDİLMEDİ (kapsam dışı,
-- yıkıcı ve bu turun konusu değil) — yalnızca CitizenshipType enum'u ve AppointmentBooking'e
-- ait ALTER TABLE/CreateIndex alınmıştır. Hiçbir kolon NOT NULL değildir, backfill YOKTUR.
-- CreateEnum
CREATE TYPE "CitizenshipType" AS ENUM ('TR', 'FOREIGN', 'FOREIGN_RESIDENT');

-- AlterTable
ALTER TABLE "appointment_bookings" ADD COLUMN     "citizenshipType" "CitizenshipType",
ADD COLUMN     "identityCapturedAt" TIMESTAMP(3),
ADD COLUMN     "identityCountryCode" TEXT,
ADD COLUMN     "identityNumberCiphertext" TEXT,
ADD COLUMN     "identityNumberHash" TEXT,
ADD COLUMN     "identityNumberMasked" TEXT,
ADD COLUMN     "patientBirthDate" DATE;

-- CreateIndex
CREATE INDEX "appointment_bookings_identityNumberHash_idx" ON "appointment_bookings"("identityNumberHash");
