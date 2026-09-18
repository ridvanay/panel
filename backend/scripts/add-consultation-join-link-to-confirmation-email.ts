/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-09-18 kullanıcı talebi: onay
 * e-postasına ("APPOINTMENT_CONFIRMATION") doğrudan görüşme odası bağlantısı ("Join Consultation",
 * `{{join_link}}`) eklendi. `prisma/seed.ts`'teki `upsert.update: {}` (idempotency,
 * `scripts/translate-appointment-email-templates-en.ts` İLE AYNI kısıt) ZATEN SEED EDİLMİŞ bir
 * satırı GÜNCELLEMEZ — bu yüzden mevcut ortamlarda (bu şablonu ADMIN panelinden HİÇ
 * özelleştirmemiş kurulumlar için) bu script AYRICA çalıştırılmalıdır. Yeni/sıfırdan kurulan
 * ortamlarda `prisma/seed.ts` zaten `join_link`li içerikle seed eder, bu script orada NO-OP'tur.
 *
 * GÜVENLİK: `bodyHtml` zaten `{{join_link}}` İÇERİYORSA (bu script daha önce çalıştırıldıysa VEYA
 * bir admin ZATEN elle benzer bir düzenleme yaptıysa) DOKUNULMAZ — bir admin'in şablonu manuel
 * özelleştirmiş olma ihtimaline karşı körü körüne ÜZERİNE YAZILMAZ, bunun yerine `[atla]` ile
 * raporlanır (manuel gözden geçirme gerektirir).
 *
 * DEĞİŞTİRMEZ: `key`/`purpose`/`editorMode`/`isSystem`/`isActive`/`name`/`subject`. YALNIZCA
 * `bodyHtml` + `availableVariables` (`join_link` eklenir).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/add-consultation-join-link-to-confirmation-email.ts --dry-run
 *   npx tsx scripts/add-consultation-join-link-to-confirmation-email.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY = "APPOINTMENT_CONFIRMATION";
const OLD_BODY_HTML =
  "<p>Hello {{patient_name}},</p><p>We have received your payment for booking <strong>{{booking_number}}</strong> and your appointment is confirmed.</p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p>You can use the link below to view your booking details and join the consultation:</p><p><a href=\"{{magic_link}}\">View My Booking</a></p>";
const NEW_BODY_HTML =
  "<p>Hello {{patient_name}},</p><p>We have received your payment for booking <strong>{{booking_number}}</strong> and your appointment is confirmed.</p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p><a href=\"{{join_link}}\">Join Consultation</a></p><p>You can also use the link below to view your booking details:</p><p><a href=\"{{magic_link}}\">View My Booking</a></p>";
const NEW_AVAILABLE_VARIABLES = ["booking_number", "patient_name", "slots_summary", "total_formatted", "magic_link", "join_link"];

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[add-consultation-join-link-to-confirmation-email] dryRun=${dryRun}`);

  const existing = await prisma.emailTemplate.findUnique({ where: { key: KEY } });
  if (!existing) {
    console.log(`[atla] key="${KEY}" DB'de YOK — muhtemelen henüz seed edilmemiş, \`prisma/seed.ts\` zaten \`join_link\`li içerikle oluşturacak.`);
    return;
  }

  if (existing.bodyHtml.includes("{{join_link}}")) {
    console.log(`[ok] key="${KEY}" gövdesi zaten "{{join_link}}" içeriyor — değişiklik gerekmiyor.`);
    return;
  }

  if (existing.bodyHtml !== OLD_BODY_HTML) {
    console.log(
      `[atla] key="${KEY}" gövdesi bilinen varsayılan (seed) içerikle EŞLEŞMİYOR — bir admin tarafından özelleştirilmiş olabilir, güvenlik için ÜZERİNE YAZILMADI. "Görüşmeye Katıl" bağlantısını (${"{{join_link}}"}) manuel olarak /admin/notifications/templates üzerinden eklemeniz gerekir.`
    );
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] key="${KEY}" bodyHtml + availableVariables güncellenecekti (hiçbir şey YAZILMADI).`);
    return;
  }

  await prisma.emailTemplate.update({
    where: { key: KEY },
    data: { bodyHtml: NEW_BODY_HTML, availableVariables: NEW_AVAILABLE_VARIABLES },
  });
  console.log(`[fix] key="${KEY}" "Join Consultation" bağlantısıyla güncellendi.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
