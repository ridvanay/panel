import type { FastifyInstance } from "fastify";
import type { EmailTemplatePurpose } from "@prisma/client";
import { renderBrandedPreview } from "../../lib/branded-mail";
import { BRAND_LOCALES, type BrandLocale, type EmailAudience } from "../../lib/branded-email";
import { renderTemplate } from "../../lib/template-render";
import type { EmailCustomVariable } from "../../lib/email-variables";
import { env } from "../../config/env";
import { buildTwoFactorResetNoticeHtml } from "../../lib/security-notice-email";
import { buildNewLeadNotice } from "../crm/crm.leads";
import { buildMatcherConfirmationEmail, buildMatcherLeadFallbackNotice } from "../matcher/matcher-notifications";
import {
  buildInterpreterAccessGrantedEmail,
  buildInterpreterAssignmentEmail,
  buildParticipantInterpreterEmail,
  type InterpreterMailContent,
} from "../telehealth/lib/interpreter-notifications";
import {
  FALLBACK_APPOINTMENT_CONFIRMATION_BODY_HTML,
  FALLBACK_APPOINTMENT_CONFIRMATION_KEYS,
  FALLBACK_APPOINTMENT_CONFIRMATION_SUBJECT,
} from "../telehealth/lib/notifications";
import { TEST_EMAIL_HTML, TEST_EMAIL_SUBJECT } from "../settings/settings.email.routes";
import { buildReviewInviteEmail } from "../reviews/reviews.service";
import { renderTemplatePreviewOrTest } from "./email-templates.service";

/**
 * Paket AC — admin "Sistem e-postaları önizleme" sekmesi. Sistemin gönderdiği HER e-posta türü
 * (şablonlu + koda gömülü) örnek veriyle, seçilen dilde, gerçekte gidecek kurumsal kabukla çizilir.
 * Örnek veriler uydurmadır; gerçek hasta/kullanıcı verisi okunmaz.
 */
export interface SystemEmailEntry {
  id: string;
  label: string;
  audience: EmailAudience;
  source: "template" | "code";
  /** Metnin kaç dilde üretildiği: "9" (alıcının dili), "tr", "en", "tr+en" veya "şablon" (admin'in yazdığı dil). */
  languages: string;
  purpose?: EmailTemplatePurpose;
}

const TEMPLATE_ENTRIES: SystemEmailEntry[] = [
  { id: "template:WELCOME", label: "Hoş geldiniz", purpose: "WELCOME", audience: "user", source: "template", languages: "şablon" },
  { id: "template:PASSWORD_RESET", label: "Şifre sıfırlama", purpose: "PASSWORD_RESET", audience: "user", source: "template", languages: "şablon" },
  { id: "template:EMAIL_VERIFICATION", label: "E-posta doğrulama kodu", purpose: "EMAIL_VERIFICATION", audience: "user", source: "template", languages: "şablon" },
  { id: "template:ACCOUNT_ACTIVATION", label: "Hesap aktivasyonu", purpose: "ACCOUNT_ACTIVATION", audience: "user", source: "template", languages: "şablon" },
  { id: "template:SYSTEM_ANNOUNCEMENT", label: "Sistem duyurusu", purpose: "SYSTEM_ANNOUNCEMENT", audience: "user", source: "template", languages: "şablon" },
  { id: "template:ORG_INVITATION", label: "Organizasyon daveti", purpose: "ORG_INVITATION", audience: "user", source: "template", languages: "şablon" },
  { id: "template:ORDER_CONFIRMATION", label: "Sipariş onayı", purpose: "ORDER_CONFIRMATION", audience: "user", source: "template", languages: "şablon" },
  { id: "template:ORDER_CANCELLATION", label: "Sipariş iptali", purpose: "ORDER_CANCELLATION", audience: "user", source: "template", languages: "şablon" },
  { id: "template:CONTACT_FORM_NOTIFICATION", label: "İletişim formu bildirimi (personel)", purpose: "CONTACT_FORM_NOTIFICATION", audience: "staff", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_CONFIRMATION", label: "Randevu onayı (hasta)", purpose: "APPOINTMENT_CONFIRMATION", audience: "patient", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_RESCHEDULED", label: "Randevu yeniden planlandı (hasta)", purpose: "APPOINTMENT_RESCHEDULED", audience: "patient", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_RESCHEDULED:doctor", label: "Randevu yeniden planlandı (doktor)", purpose: "APPOINTMENT_RESCHEDULED", audience: "staff", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_REMINDER_60M", label: "Randevu hatırlatma 60 dk (hasta)", purpose: "APPOINTMENT_REMINDER_60M", audience: "patient", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_REMINDER_60M:doctor", label: "Randevu hatırlatma 60 dk (doktor)", purpose: "APPOINTMENT_REMINDER_60M", audience: "staff", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_REMINDER_30M", label: "Randevu hatırlatma 30 dk (hasta)", purpose: "APPOINTMENT_REMINDER_30M", audience: "patient", source: "template", languages: "şablon" },
  { id: "template:APPOINTMENT_REMINDER_30M:doctor", label: "Randevu hatırlatma 30 dk (doktor)", purpose: "APPOINTMENT_REMINDER_30M", audience: "staff", source: "template", languages: "şablon" },
  { id: "template:MATCHER_NEW_LEAD", label: "Eşleştirme talebi (koordinatör)", purpose: "MATCHER_NEW_LEAD", audience: "staff", source: "template", languages: "şablon" },
];

const CODE_ENTRIES: SystemEmailEntry[] = [
  { id: "code:appointment-confirmation-fallback", label: "Randevu onayı — yedek metin (şablon yoksa)", audience: "patient", source: "code", languages: "en" },
  { id: "code:matcher-confirmation", label: "Eşleştirme talebi alındı (hasta)", audience: "patient", source: "code", languages: "9" },
  { id: "code:review-request", label: "Deneyiminizi paylaşın (hasta, görüşmeden 24 saat sonra)", audience: "patient", source: "code", languages: "9" },
  { id: "code:matcher-new-lead-fallback", label: "Eşleştirme talebi — yedek metin (koordinatör)", audience: "staff", source: "code", languages: "tr" },
  { id: "code:interpreter-assignment", label: "Tercüman ataması (tercüman)", audience: "staff", source: "code", languages: "9" },
  { id: "code:interpreter-participant-patient", label: "Görüşmeye tercüman katılacak (hasta)", audience: "patient", source: "code", languages: "9" },
  { id: "code:interpreter-participant-doctor", label: "Görüşmeye tercüman katılacak (doktor)", audience: "staff", source: "code", languages: "9" },
  { id: "code:interpreter-access-granted", label: "Tercümanlık yetkisi verildi", audience: "staff", source: "code", languages: "9" },
  { id: "code:crm-new-lead", label: "CRM yeni talep (personel)", audience: "staff", source: "code", languages: "tr" },
  { id: "code:security-2fa-reset", label: "2FA sıfırlandı (güvenlik bildirimi)", audience: "user", source: "code", languages: "tr+en" },
  { id: "code:smtp-test", label: "SMTP yapılandırma testi", audience: "staff", source: "code", languages: "tr" },
];

export const SYSTEM_EMAILS: readonly SystemEmailEntry[] = [...TEMPLATE_ENTRIES, ...CODE_ENTRIES];

export interface SystemEmailSample {
  id: string;
  locale: BrandLocale;
  subject: string;
  html: string;
  text: string;
  /** Şablonlu e-postada aktif şablon satırı yoksa `false` (gerçekte gönderilmez ya da yedek metne düşer). */
  available: boolean;
}

const SAMPLE_DATE = new Date("2026-11-12T10:30:00Z");
// Doktora giden şablonlara gerçekte geçirilen değişkenler (notifications.ts) — hasta adı YOK.
const DOCTOR_SAMPLE_VALUES: Record<string, string> = {
  recipient_name: "Dr. Mehmet Demir",
  doctor_name: "Dr. Mehmet Demir",
  booking_number: "BKG-1024-ABCD",
};

function codeSample(id: string, locale: BrandLocale): { subject: string; bodyHtml: string; cta?: { label: string; url: string }; afterCtaHtml?: string } {
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  const fromInterpreter = (mail: InterpreterMailContent) => ({ subject: mail.subject, bodyHtml: mail.html, ...(mail.cta ? { cta: mail.cta } : {}) });
  switch (id) {
    case "code:appointment-confirmation-fallback":
      return {
        subject: FALLBACK_APPOINTMENT_CONFIRMATION_SUBJECT,
        bodyHtml: renderTemplate(
          FALLBACK_APPOINTMENT_CONFIRMATION_BODY_HTML,
          {
            patient_name: "Ayşe Yılmaz",
            status_message: "Your payment was received and your appointment is confirmed.",
            booking_number: "BKG-1024-ABCD",
            slots_summary: "12.11.2026 13:30 (Europe/Istanbul)",
            total_formatted: "€120.00",
            magic_link: `${base}/en/patient/bookings/sample?t=sample`,
            join_link: `${base}/en/consultation/sample?t=sample`,
          },
          FALLBACK_APPOINTMENT_CONFIRMATION_KEYS
        ),
      };
    case "code:matcher-confirmation": {
      const mail = buildMatcherConfirmationEmail({ locale, number: 1024, contactAllowed: true });
      return { subject: mail.subject, bodyHtml: mail.html };
    }
    case "code:review-request": {
      const mail = buildReviewInviteEmail({ locale, patientName: "Ayşe Yılmaz", doctorName: "Op. Dr. M. Demir", url: `${base}/${locale}/review/sample-token`, optOutUrl: `${base}/${locale}/review/sample-token?optout=1` });
      return { subject: mail.subject, bodyHtml: mail.bodyHtml, cta: mail.cta, afterCtaHtml: mail.afterCtaHtml };
    }
    case "code:matcher-new-lead-fallback":
      return buildMatcherLeadFallbackNotice(1024, `${base}/admin/crm/leads/sample`);
    case "code:interpreter-assignment":
      return fromInterpreter(
        buildInterpreterAssignmentEmail({ locale, startsAt: SAMPLE_DATE, interpreterTimeZone: "Europe/Berlin", language: "ar", panelUrl: `${base}/${locale}/interpreter` })
      );
    case "code:interpreter-participant-patient":
      return fromInterpreter(
        buildParticipantInterpreterEmail({ locale, audience: "patient", startsAt: SAMPLE_DATE, timeZone: "Europe/Istanbul", language: "ar", interpreterDisplayName: "A. Yılmaz" })
      );
    case "code:interpreter-participant-doctor":
      return fromInterpreter(
        buildParticipantInterpreterEmail({ locale, audience: "doctor", startsAt: SAMPLE_DATE, timeZone: "Europe/Istanbul", language: "ar", interpreterDisplayName: "A. Yılmaz" })
      );
    case "code:interpreter-access-granted":
      return fromInterpreter(buildInterpreterAccessGrantedEmail({ locale, panelUrl: `${base}/${locale}/interpreter`, twoFactorRequired: true }));
    case "code:crm-new-lead":
      return buildNewLeadNotice([
        { id: "sample-1", channel: "CONTACT_FORM" },
        { id: "sample-2", channel: "WHATSAPP" },
      ]);
    case "code:security-2fa-reset":
      return { subject: "2FA'nız sıfırlandı / Your 2FA was reset", bodyHtml: buildTwoFactorResetNoticeHtml("Ayşe Yılmaz", SAMPLE_DATE) };
    case "code:smtp-test":
      return { subject: TEST_EMAIL_SUBJECT, bodyHtml: TEST_EMAIL_HTML };
    default:
      throw new Error(`Bilinmeyen sistem e-postası: ${id}`);
  }
}

export function findSystemEmail(id: string): SystemEmailEntry | undefined {
  return SYSTEM_EMAILS.find((entry) => entry.id === id);
}

export function isBrandLocale(code: string): code is BrandLocale {
  return (BRAND_LOCALES as readonly string[]).includes(code);
}

/** Bir sistem e-postasını örnek veriyle ve verilen dilde, gerçekte gidecek kabukla üretir. */
export async function renderSystemEmailSample(app: FastifyInstance, entry: SystemEmailEntry, locale: BrandLocale): Promise<SystemEmailSample> {
  if (entry.source === "template" && entry.purpose) {
    const template = await app.prisma.emailTemplate.findFirst({ where: { purpose: entry.purpose, isActive: true } });
    if (!template) {
      // Randevu onayı şablonu yoksa gerçekte yedek metin gider — önizleme de onu gösterir.
      if (entry.purpose === "APPOINTMENT_CONFIRMATION") {
        const fallback = await renderSystemEmailSample(app, findSystemEmail("code:appointment-confirmation-fallback")!, locale);
        return { ...fallback, id: entry.id, available: false };
      }
      const branded = await renderBrandedPreview(app, {
        locale,
        audience: entry.audience,
        bodyHtml: "<p>Bu amaç için aktif bir şablon yok; bu e-posta şu an gönderilmez.</p>",
      });
      return { id: entry.id, locale, subject: `(${entry.label})`, html: branded.html, text: branded.text, available: false };
    }
    const rendered = await renderTemplatePreviewOrTest(
      app,
      {
        purpose: template.purpose,
        editorMode: template.editorMode,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        blocks: template.blocks as unknown[],
        customVariables: (template.customVariables as unknown as EmailCustomVariable[]) ?? [],
      },
      entry.audience === "staff" && entry.purpose.startsWith("APPOINTMENT_") ? DOCTOR_SAMPLE_VALUES : {},
      locale,
      entry.audience
    );
    return { id: entry.id, locale, subject: rendered.renderedSubject, html: rendered.renderedHtml, text: rendered.renderedText, available: true };
  }

  const sample = codeSample(entry.id, locale);
  const branded = await renderBrandedPreview(app, {
    locale,
    audience: entry.audience,
    preheader: sample.subject,
    bodyHtml: sample.bodyHtml,
    ...(sample.cta ? { cta: sample.cta } : {}),
    ...(sample.afterCtaHtml ? { afterCtaHtml: sample.afterCtaHtml } : {}),
  });
  return { id: entry.id, locale, subject: sample.subject, html: branded.html, text: branded.text, available: true };
}
