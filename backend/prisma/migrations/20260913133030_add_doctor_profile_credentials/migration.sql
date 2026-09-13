-- [DPI] Karar A / §1.1 / §5 — DoctorProfile kurumsal özgeçmiş alanları.
-- NOT: db-agent bu migration'ı `prisma migrate diff` çıktısından ELLE değil, Prisma'nın
-- ürettiği SQL'den (schema-datasource -> schema-datamodel diff) DOKUNULMADAN aldı; ancak diff
-- çıktısında bu projeye özgü, DPI kapsamı DIŞINDA, önceden var olan bir şema sürüklenmesi
-- (tax_rates tablosu ve ilişkili kolonların DROP edilmesi, EmailTemplatePurpose enum yeniden
-- yazımı) da yer alıyordu. O kısım BİLİNÇLİ OLARAK bu migration'a DAHİL EDİLMEDİ (kapsam dışı,
-- yıkıcı ve bu turun konusu değil) — yalnızca DoctorProfile'a ait ALTER TABLE alınmıştır.
-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "aboutHtml" TEXT,
ADD COLUMN     "cvEntries" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "practiceStartYear" INTEGER,
ADD COLUMN     "publications" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "subSpecialty" TEXT;
