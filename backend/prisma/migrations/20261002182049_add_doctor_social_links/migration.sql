-- Doktor profiline sosyal medya linkleri eklenir (platform + url + opsiyonel etiket,
-- en fazla 8 öğe, Zod ile YAZMA ANINDA zorlanır). `cvEntries`/`publications` İLE AYNI
-- desen: ayrı bir ilişkisel tablo/Prisma enum DEĞİL. Yalnızca YENİ ve default'lu bir
-- sütun eklenir; mevcut satırların hiçbir değeri değiştirilmez.

-- AlterTable
ALTER TABLE "doctor_profiles" ADD COLUMN     "socialLinks" JSONB NOT NULL DEFAULT '[]';
