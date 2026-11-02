import { escapeHtml } from "../../lib/branded-email";
import { toIntermediaryLocale, type IntermediaryLocale } from "../../lib/intermediary-identity";

/**
 * Paket AH - danisma talebi e-postalari (SAF: DB/IO yok).
 *
 * 1) Yonetici bildirimi (EN, `audience: "staff"`): GIZLILIK - ad, e-posta, telefon ve MESAJ bu e-postada YOKTUR; girdi tipi
 *    bunlari zaten tasimaz. Yalnizca bolum/paket adi, ulke, iletisim dili, tercuman, tarih araligi ve "Open request" baglantisi.
 * 2) Ziyaretciye onay (8 dil; `tr` -> `en`, musteriye Turkce e-posta gitmez): talep no + "koordinator 1 is gunu icinde
 *    donecek". Kurulus kimligi ibaresi + aciklamasi kurumsal kabugun footer'inda (`lib/branded-email.ts`) alicinin dilinde gelir.
 */

/** `REQ-00012` - talep numarasi (seq 5 hane dolgulu). */
export function formatRequestNumber(seq: number): string {
  return `REQ-${String(seq).padStart(5, "0")}`;
}

export interface ConsultationAdminEmailData {
  requestNumber: string;
  serviceName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  contactLanguage: string;
  needsInterpreter: boolean;
  /** `YYYY-MM-DD` ya da null. */
  preferredFrom: string | null;
  preferredTo: string | null;
  leadId: string;
  frontendUrl: string;
}

export interface ConsultationAdminEmail {
  subject: string;
  preheader: string;
  title: string;
  bodyHtml: string;
  cta: { label: string; url: string };
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function countryName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function languageName(code: string): string {
  try {
    const tag = code === "sr-latn" ? "sr-Latn" : code;
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    return name && name !== tag ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function dateRange(from: string | null, to: string | null): string {
  if (from && to) return from === to ? from : `${from} - ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "not specified";
}

export function buildConsultationAdminEmail(data: ConsultationAdminEmailData): ConsultationAdminEmail {
  const base = data.frontendUrl.replace(/\/$/, "");
  const subject = `New consultation request #${data.requestNumber} — ${data.serviceName}`;
  const rows = [
    row("Request", `#${data.requestNumber}`),
    row("Service", data.serviceName),
    row("Country", countryName(data.country)),
    row("Contact language", languageName(data.contactLanguage)),
    row("Interpreter", data.needsInterpreter ? "yes" : "no"),
    row("Preferred dates", dateRange(data.preferredFrom, data.preferredTo)),
  ];
  return {
    subject,
    preheader: subject,
    title: "New consultation request",
    bodyHtml: `<p>A new consultation request has been received.</p>${rows.join("")}<p style="margin:12px 0 0;">Contact details and the message are only visible in the admin panel after signing in.</p>`,
    cta: { label: "Open request", url: `${base}/admin/crm/leads/${data.leadId}` },
  };
}

// --- Ziyaretciye onay (8 dil) ----------------------------------------------------------------------

interface ConfirmationStrings {
  subject: string;
  intro: string;
  contactLine: string;
  safetyLine: string;
}

export const CONSULTATION_CONFIRMATION: Record<IntermediaryLocale, ConfirmationStrings> = {
  en: {
    subject: "We received your request {no}",
    intro: "Thank you. We have received your consultation request {no} for {service}.",
    contactLine: "A patient coordinator will contact you within 1 business day.",
    safetyLine: "Please do not reply to this email with detailed medical information; your coordinator will guide you securely.",
  },
  de: {
    subject: "Wir haben Ihre Anfrage {no} erhalten",
    intro: "Vielen Dank. Wir haben Ihre Beratungsanfrage {no} für {service} erhalten.",
    contactLine: "Unsere Patientenkoordination meldet sich innerhalb von einem Werktag bei Ihnen.",
    safetyLine: "Bitte senden Sie keine detaillierten medizinischen Informationen per Antwort auf diese E-Mail; Ihre Koordinatorin bzw. Ihr Koordinator führt Sie sicher durch den Prozess.",
  },
  ar: {
    subject: "تلقّينا طلبك {no}",
    intro: "شكرًا لك. تلقّينا طلب الاستشارة {no} الخاص بـ {service}.",
    contactLine: "سيتواصل معك منسّق المرضى لدينا خلال يوم عمل واحد.",
    safetyLine: "يُرجى عدم الرد على هذا البريد بمعلومات طبية تفصيلية؛ سيرشدك المنسّق بطريقة آمنة.",
  },
  ru: {
    subject: "Мы получили вашу заявку {no}",
    intro: "Спасибо. Мы получили вашу заявку на консультацию {no}: {service}.",
    contactLine: "Наш координатор пациентов свяжется с вами в течение 1 рабочего дня.",
    safetyLine: "Пожалуйста, не отправляйте подробную медицинскую информацию в ответ на это письмо; координатор подскажет, как сделать это безопасно.",
  },
  fr: {
    subject: "Nous avons bien reçu votre demande {no}",
    intro: "Merci. Nous avons bien reçu votre demande de consultation {no} pour {service}.",
    contactLine: "Notre coordinateur patients vous contactera sous 1 jour ouvré.",
    safetyLine: "Merci de ne pas répondre à cet e-mail avec des informations médicales détaillées ; votre coordinateur vous guidera en toute sécurité.",
  },
  es: {
    subject: "Hemos recibido su solicitud {no}",
    intro: "Gracias. Hemos recibido su solicitud de consulta {no} para {service}.",
    contactLine: "Nuestro coordinador de pacientes se pondrá en contacto con usted en un plazo de 1 día hábil.",
    safetyLine: "Le rogamos que no responda a este correo con información médica detallada; su coordinador le guiará de forma segura.",
  },
  ro: {
    subject: "Am primit solicitarea dumneavoastră {no}",
    intro: "Vă mulțumim. Am primit solicitarea dumneavoastră de consultație {no} pentru {service}.",
    contactLine: "Coordonatorul nostru de pacienți vă va contacta în cel mult 1 zi lucrătoare.",
    safetyLine: "Vă rugăm să nu răspundeți la acest e-mail cu informații medicale detaliate; coordonatorul vă va îndruma în siguranță.",
  },
  "sr-latn": {
    subject: "Primili smo vaš zahtev {no}",
    intro: "Hvala vam. Primili smo vaš zahtev za konsultaciju {no} za {service}.",
    contactLine: "Naš koordinator za pacijente javiće vam se u roku od 1 radnog dana.",
    safetyLine: "Molimo vas da ne odgovarate na ovu poruku detaljnim medicinskim informacijama; koordinator će vas bezbedno voditi kroz proces.",
  },
};

export function buildConsultationConfirmationEmail(input: { locale: string | null | undefined; requestNumber: string; serviceName: string }): {
  locale: IntermediaryLocale;
  subject: string;
  html: string;
} {
  const locale = toIntermediaryLocale(input.locale);
  const t = CONSULTATION_CONFIRMATION[locale];
  // Fonksiyon bicimi: ad icinde `$&` gibi kaliplar yorumlanmasin.
  const fill = (s: string) => s.replaceAll("{no}", () => input.requestNumber).replaceAll("{service}", () => input.serviceName);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const rows = [fill(t.intro), t.contactLine, t.safetyLine].map((line) => `<p>${escapeHtml(line)}</p>`);
  return { locale, subject: fill(t.subject), html: `<div dir="${dir}" lang="${locale}">${rows.join("")}</div>` };
}
