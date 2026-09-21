/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-09-21 kullanıcı talebi: doktorun
 * seans ücreti tanımlanmamış (`sessionPriceCents: null`, `booking.totalCents === 0`) rezervasyonların
 * onay e-postasında "We have received your payment..." ifadesi YANLIŞ/kafa karıştırıcıdır (hiçbir
 * ödeme ALINMADI). Durum cümlesi artık `{{status_message}}` değişkenine taşındı — bu tetikleyicide
 * (`modules/telehealth/lib/notifications.ts::triggerAppointmentConfirmationEmail`) `total`e göre
 * İKİ farklı metinle DOLDURULUR. `prisma/seed.ts`'teki `upsert.update: {}` (idempotency,
 * `scripts/add-consultation-join-link-to-confirmation-email.ts` İLE AYNI kısıt) ZATEN SEED EDİLMİŞ
 * bir satırı GÜNCELLEMEZ — bu yüzden mevcut ortamlarda (bu şablonu ADMIN panelinden HİÇ
 * özelleştirmemiş kurulumlar için) bu script AYRICA çalıştırılmalıdır. Yeni/sıfırdan kurulan
 * ortamlarda `prisma/seed.ts` zaten `{{status_message}}`li içerikle seed eder, bu script orada
 * NO-OP'tur.
 *
 * ÖN KOŞUL SIRASI: bu script `{{join_link}}` ekleme script'inden (`add-consultation-join-link-to-
 * confirmation-email.ts`) SONRA çalıştırılmaya GEREK YOKTUR — her iki bilinen önceki gövdeyi
 * (join_link'siz VE join_link'li) de tanır, hangisiyle karşılaşırsa DOĞRUDAN nihai (`status_message`
 * + `join_link` İKİSİ birden) içeriğe geçer. Yine de bu iki script'i sırayla çalıştırmak (önce
 * join-link, sonra bu) ZARARSIZDIR — her ikisi de idempotent.
 *
 * GÜVENLİK: `bodyHtml` zaten `{{status_message}}` İÇERİYORSA (bu script daha önce çalıştırıldıysa)
 * DOKUNULMAZ. Gövde bilinen İKİ önceki sürümden (join_link'siz/join_link'li) HİÇBİRİYLE eşleşmiyorsa
 * (bir admin ZATEN elle özelleştirmiş olabilir) körü körüne ÜZERİNE YAZILMAZ, `[atla]` ile
 * raporlanır (manuel gözden geçirme gerektirir).
 *
 * DEĞİŞTİRMEZ: `key`/`purpose`/`editorMode`/`isSystem`/`isActive`/`name`/`subject`. YALNIZCA
 * `bodyHtml` + `availableVariables` (`status_message` eklenir).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/add-status-message-to-confirmation-email.ts --dry-run
 *   npx tsx scripts/add-status-message-to-confirmation-email.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY = "APPOINTMENT_CONFIRMATION";

/** `add-consultation-join-link-to-confirmation-email.ts`'in `OLD_BODY_HTML`'i İLE BİREBİR AYNI. */
const LEGACY_BODY_HTML_NO_JOIN_LINK =
  '<p>Hello {{patient_name}},</p><p>We have received your payment for booking <strong>{{booking_number}}</strong> and your appointment is confirmed.</p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p>You can use the link below to view your booking details and join the consultation:</p><p><a href="{{magic_link}}">View My Booking</a></p>';

/** `add-consultation-join-link-to-confirmation-email.ts`'in `NEW_BODY_HTML`'i İLE BİREBİR AYNI. */
const LEGACY_BODY_HTML_WITH_JOIN_LINK =
  '<p>Hello {{patient_name}},</p><p>We have received your payment for booking <strong>{{booking_number}}</strong> and your appointment is confirmed.</p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p><a href="{{join_link}}">Join Consultation</a></p><p>You can also use the link below to view your booking details:</p><p><a href="{{magic_link}}">View My Booking</a></p>';

/** `prisma/seed.ts::APPOINTMENT_CONFIRMATION` İLE BİREBİR AYNI — nihai/hedef içerik. */
const NEW_BODY_HTML =
  '<p>Hello {{patient_name}},</p><p>{{status_message}}</p><p>Booking Number: <strong>{{booking_number}}</strong></p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p><a href="{{join_link}}">Join Consultation</a></p><p>You can also use the link below to view your booking details:</p><p><a href="{{magic_link}}">View My Booking</a></p>';
const NEW_AVAILABLE_VARIABLES = ["booking_number", "patient_name", "status_message", "slots_summary", "total_formatted", "magic_link", "join_link"];

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[add-status-message-to-confirmation-email] dryRun=${dryRun}`);

  const existing = await prisma.emailTemplate.findUnique({ where: { key: KEY } });
  if (!existing) {
    console.log(`[atla] key="${KEY}" DB'de YOK — muhtemelen henüz seed edilmemiş, \`prisma/seed.ts\` zaten \`status_message\`li içerikle oluşturacak.`);
    return;
  }

  if (existing.bodyHtml.includes("{{status_message}}")) {
    console.log(`[ok] key="${KEY}" gövdesi zaten "{{status_message}}" içeriyor — değişiklik gerekmiyor.`);
    return;
  }

  if (existing.bodyHtml !== LEGACY_BODY_HTML_NO_JOIN_LINK && existing.bodyHtml !== LEGACY_BODY_HTML_WITH_JOIN_LINK) {
    console.log(
      `[atla] key="${KEY}" gövdesi bilinen ÖNCEKİ sürümlerin (join_link'siz/join_link'li) HİÇBİRİYLE eşleşmiyor — bir admin tarafından özelleştirilmiş olabilir, güvenlik için ÜZERİNE YAZILMADI. Ücretsiz randevu durum cümlesini ({{status_message}}) manuel olarak /admin/notifications/templates üzerinden eklemeniz gerekir.`
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
  console.log(`[fix] key="${KEY}" ücretli/ücretsiz durum cümlesiyle ({{status_message}}) güncellendi.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
