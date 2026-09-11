/**
 * [TCT] §7.2 data-fix — "Global TeleHealth & Clinic" demo şablonunun 4 demo doktoru, bu düzeltme
 * ÖNCESİNDE üretilmiş kurulumlarda hepsi `currency: "TRY"` ile içeri alınmıştı (bug — bkz.
 * `templates/telehealth-clinic.ts` §7.2 yorumu). `timeZone` alanı zaten doktor bazında farklıydı
 * ve DOĞRUYDU (IANA saat dilimi, "UTC+3" gibi ofset DEĞİL — §3.4); BU SCRIPT `timeZone`'A
 * DOKUNMAZ, yalnızca `currency`'yi düzeltir.
 *
 * Şablonun `importer.ts` uygulama akışı (§6.7 "yıkıcılık matrisi") mevcut `DoctorProfile`
 * satırlarını ASLA silmez/güncellemez — yalnızca EKLER. Bu yüzden şablonu "force reapply" etmek
 * zaten var olan hatalı 4 satırı DÜZELTMEZ, yeni bir 4'lü DAHA ekler. Doğru düzeltme yolu bu
 * hedefli, idempotent script'tir: `slug` ile eşleştirir, yalnızca `currency` hâlâ hedeften
 * FARKLIYSA günceller — birden çok kez çalıştırmak GÜVENLİDİR.
 *
 * ÇALIŞTIRMA (backend/ dizininden): npx tsx scripts/fix-telehealth-demo-doctor-currency.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// slug -> hedef `currency` (doktorun `timeZone`'una göre yerel para birimi). `templates/
// telehealth-clinic.ts` içindeki `DOCTORS` dizisiyle BİREBİR AYNI kalmalıdır.
const TARGET_CURRENCY_BY_SLUG: Record<string, string> = {
  "elif-aydemir": "TRY", // Europe/Istanbul
  "james-whitfield": "GBP", // Europe/London
  "laura-bennett": "USD", // America/New_York
  "felix-braun": "EUR", // Europe/Berlin
};

async function main() {
  let updated = 0;
  let alreadyCorrect = 0;
  let notFound = 0;

  for (const [slug, targetCurrency] of Object.entries(TARGET_CURRENCY_BY_SLUG)) {
    const doctor = await prisma.doctorProfile.findUnique({
      where: { slug },
      select: { id: true, fullName: true, currency: true, timeZone: true },
    });

    if (!doctor) {
      notFound += 1;
      console.log(`[skip] slug="${slug}" bulunamadı (şablon henüz uygulanmamış olabilir).`);
      continue;
    }

    if (doctor.currency === targetCurrency) {
      alreadyCorrect += 1;
      console.log(`[ok] ${doctor.fullName} (${slug}) zaten currency="${targetCurrency}".`);
      continue;
    }

    await prisma.doctorProfile.update({
      where: { id: doctor.id },
      data: { currency: targetCurrency },
    });
    updated += 1;
    console.log(
      `[fix] ${doctor.fullName} (${slug}) currency: "${doctor.currency}" -> "${targetCurrency}" (timeZone="${doctor.timeZone}", değiştirilmedi).`
    );
  }

  console.log(`\nÖzet: ${updated} güncellendi, ${alreadyCorrect} zaten doğruydu, ${notFound} bulunamadı.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
