-- Doktorun BİRİNCİL uzmanlığı (`doctor_profiles.specialtyId`, tek FK) DEĞİŞMİYOR.
-- Bu migration SADECE yeni bir ilişki tablosu ekler: bir doktor birden fazla
-- uzmanlıkta listelenebilsin diye (ör. Obesity & Metabolic Surgery +
-- Surgical Oncology). Composite PK aynı doktor-uzmanlık çiftinin DB seviyesinde
-- yalnızca bir kez eklenebilmesini garanti eder. Mevcut hiçbir tabloya ALTER/DROP yok.

-- CreateTable
CREATE TABLE "doctor_additional_specialties" (
    "doctorId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_additional_specialties_pkey" PRIMARY KEY ("doctorId","specialtyId")
);

-- CreateIndex
CREATE INDEX "doctor_additional_specialties_specialtyId_idx" ON "doctor_additional_specialties"("specialtyId");

-- AddForeignKey
ALTER TABLE "doctor_additional_specialties" ADD CONSTRAINT "doctor_additional_specialties_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_additional_specialties" ADD CONSTRAINT "doctor_additional_specialties_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
