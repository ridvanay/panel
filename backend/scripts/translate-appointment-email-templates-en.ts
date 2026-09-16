/**
 * Tek seferlik veri operasyonu (KOD DEĞİŞİKLİĞİ DEĞİL) — "varsayılan dili İngilizce yap" görevinin
 * bir parçası. `EmailTemplate` modelinde locale/translations alanı YOKTUR (tek dilli içerik,
 * bkz. `.claude/architect-scope-i18n.md`); `email-templates.service.ts::buildEmailRenderContext`'in
 * okuduğu `localeSet.default.code` yalnızca KVKK footer linklerinin (`/{locale}/{slug}`) dilini
 * belirler, gövde/konu metnini DEĞİL. Bu script dört sistem telehealth şablonunun (randevu onayı,
 * yeniden planlama, 1sa/30dk hatırlatma) Türkçe konu/gövde/blok metnini İngilizceye çevirip
 * DOĞRUDAN DB satırlarını günceller — `prisma/seed.ts`'teki `upsert.update: {}` (idempotency)
 * ZATEN SEED EDİLMİŞ bir satırı GÜNCELLEMEZ, bu yüzden mevcut ortamlarda bu script AYRICA
 * çalıştırılmalıdır (yeni/sıfırdan kurulan ortamlarda `prisma/seed.ts` zaten İngilizce içerikle
 * seed eder, bu script orada NO-OP'tur — `update: {}` İLE AYNI "zaten doğruysa dokunma" felsefesi).
 *
 * DEĞİŞTİRMEZ: `key`/`purpose`/`editorMode`/`isSystem`/`isActive`/`availableVariables` — YALNIZCA
 * `name`/`subject`/`bodyHtml`/`blocks` metni. Değişken placeholder'ları (`{{doctor_name}}` vb.)
 * BİREBİR KORUNUR.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/translate-appointment-email-templates-en.ts --dry-run
 *   npx tsx scripts/translate-appointment-email-templates-en.ts
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

interface TemplateUpdate {
  key: string;
  name: string;
  subject: string;
  bodyHtml?: string;
  blocks?: Prisma.InputJsonValue;
}

const UPDATES: TemplateUpdate[] = [
  {
    key: "APPOINTMENT_CONFIRMATION",
    name: "Appointment Confirmation Email",
    subject: "Your appointment is confirmed",
    bodyHtml:
      "<p>Hello {{patient_name}},</p><p>We have received your payment for booking <strong>{{booking_number}}</strong> and your appointment is confirmed.</p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p>You can use the link below to view your booking details and join the consultation:</p><p><a href=\"{{magic_link}}\">View My Booking</a></p>",
  },
  {
    key: "APPOINTMENT_RESCHEDULED",
    name: "Appointment Rescheduled",
    subject: "Your Appointment Has Been Rescheduled",
    bodyHtml:
      "<p>Dear {{recipient_name}},</p><p>Your appointment <strong>{{booking_number}}</strong> has been rescheduled.</p><p><strong>Previous Date/Time:</strong> {{old_slot_summary}}</p><p><strong>New Date/Time:</strong> {{new_slot_summary}}</p><p>{{reason}}</p><p>If you have any questions, please feel free to contact us.</p>",
  },
  {
    key: "APPOINTMENT_REMINDER_60M",
    name: "Appointment Reminder Email (1 Hour Before)",
    subject: "Your Appointment Is in 1 Hour",
    blocks: [
      {
        id: "block-logo-header",
        type: "logo-header",
        style: { align: "center", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
        data: { useSiteLogo: true, logoUrl: null, height: 48 },
      },
      {
        id: "block-heading",
        type: "heading",
        style: { align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
        data: { text: "Your Appointment Is in 1 Hour", level: 2 },
      },
      {
        id: "block-text",
        type: "text",
        style: { align: "left", backgroundColor: null, textColor: null, paddingY: "sm", paddingX: "md" },
        data: {
          html:
            "<p>Dear {{recipient_name}},</p><p>Your appointment <strong>{{booking_number}}</strong> is starting in about 1 hour.</p><p><strong>Participant:</strong> {{doctor_name}}</p><p><strong>Appointment Time:</strong> {{slot_summary}}</p><p>Please be ready shortly before your appointment time. If you would like to join early, you can use the link from your confirmation email.</p>",
        },
      },
    ],
  },
  {
    key: "APPOINTMENT_REMINDER_30M",
    name: "Appointment Reminder Email (30 Minutes Before)",
    subject: "Your Appointment Is in 30 Minutes",
    blocks: [
      {
        id: "block-logo-header",
        type: "logo-header",
        style: { align: "center", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
        data: { useSiteLogo: true, logoUrl: null, height: 48 },
      },
      {
        id: "block-heading",
        type: "heading",
        style: { align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
        data: { text: "Your Appointment Is in 30 Minutes", level: 2 },
      },
      {
        id: "block-text",
        type: "text",
        style: { align: "left", backgroundColor: null, textColor: null, paddingY: "sm", paddingX: "md" },
        data: {
          html:
            "<p>Dear {{recipient_name}},</p><p>Your appointment <strong>{{booking_number}}</strong> is starting in about 30 minutes.</p><p><strong>Participant:</strong> {{doctor_name}}</p><p><strong>Appointment Time:</strong> {{slot_summary}}</p><p>You can join the room directly using the link below.</p>",
        },
      },
      {
        id: "block-button",
        type: "button",
        style: { align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
        data: { label: "Join Room", href: "{{join_link}}", backgroundColor: null, textColor: null, radius: "sm" },
      },
    ],
  },
];

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[translate-appointment-email-templates-en] dryRun=${dryRun}`);

  for (const update of UPDATES) {
    const existing = await prisma.emailTemplate.findUnique({ where: { key: update.key } });
    if (!existing) {
      console.log(`[atla] key="${update.key}" DB'de YOK — muhtemelen henüz seed edilmemiş, \`prisma/seed.ts\` zaten İngilizce içerikle oluşturacak.`);
      continue;
    }

    if (existing.subject === update.subject && existing.name === update.name) {
      console.log(`[ok] key="${update.key}" zaten İngilizce içerikle güncel — değişiklik gerekmiyor.`);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] key="${update.key}" subject="${existing.subject}" -> "${update.subject}" güncellenecekti (hiçbir şey YAZILMADI).`);
      continue;
    }

    await prisma.emailTemplate.update({
      where: { key: update.key },
      data: {
        name: update.name,
        subject: update.subject,
        ...(update.bodyHtml !== undefined ? { bodyHtml: update.bodyHtml } : {}),
        ...(update.blocks !== undefined ? { blocks: update.blocks } : {}),
      },
    });
    console.log(`[fix] key="${update.key}" İngilizce içerikle güncellendi.`);
  }

  if (!dryRun) {
    const rows = await prisma.emailTemplate.findMany({
      where: { key: { in: UPDATES.map((u) => u.key) } },
      select: { key: true, subject: true },
      orderBy: { key: "asc" },
    });
    console.log("[durum]");
    for (const row of rows) console.log(`  ${row.key}\t${row.subject}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
