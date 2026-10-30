import type { FastifyInstance } from "fastify";
import { sendMail } from "../../../lib/mail";
import { nativeLanguageName } from "./interpreters";

/**
 * Paket AA — tercüman atama bildirimleri (alıcının dilinde, 9 dil). E-posta şablon sisteminde dil
 * alanı olmadığı için metinler burada üretilir ve mevcut `sendMail` ile gönderilir (best-effort; hata
 * atamayı geri almaz).
 *
 * VERİ SINIRI: tercümana giden e-postada hastanın adı, şikayeti/intake notu ve belgeleri YER ALMAZ —
 * yalnızca tarih/saat, görüşme dili ve panel bağlantısı. Hastaya ve doktora tercümanın yalnızca
 * görünen adı yazılır (e-posta/telefon yok).
 */
export const NOTIFICATION_LOCALES = ["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

interface Strings {
  interpreterSubject: string;
  interpreterIntro: string;
  dateLabel: string;
  istanbulTimeLabel: string;
  languageLabel: string;
  panelCta: string;
  participantSubject: string;
  patientIntro: string;
  doctorIntro: string;
  interpreterLabel: string;
}

const STRINGS: Record<NotificationLocale, Strings> = {
  en: {
    interpreterSubject: "New interpreting assignment",
    interpreterIntro: "You have been assigned to interpret an online consultation.",
    dateLabel: "Date and time (your time zone)",
    istanbulTimeLabel: "Istanbul time",
    languageLabel: "Consultation language",
    panelCta: "Open your interpreter panel",
    participantSubject: "An interpreter will join your consultation",
    patientIntro: "An interpreter who has signed a confidentiality undertaking will join your consultation.",
    doctorIntro: "An interpreter will join your consultation.",
    interpreterLabel: "Interpreter",
  },
  tr: {
    interpreterSubject: "Yeni tercümanlık görevi",
    interpreterIntro: "Bir online görüşmede tercümanlık yapmak üzere atandınız.",
    dateLabel: "Tarih ve saat (sizin saat diliminiz)",
    istanbulTimeLabel: "TR saati",
    languageLabel: "Görüşme dili",
    panelCta: "Tercüman panelini aç",
    participantSubject: "Görüşmenize tercüman katılacak",
    patientIntro: "Görüşmenize gizlilik taahhüdü vermiş bir tercüman katılacaktır.",
    doctorIntro: "Görüşmenize tercüman katılacak.",
    interpreterLabel: "Tercüman",
  },
  de: {
    interpreterSubject: "Neuer Dolmetscheinsatz",
    interpreterIntro: "Sie wurden als Dolmetscher(in) für eine Online-Sprechstunde eingeteilt.",
    dateLabel: "Datum und Uhrzeit (Ihre Zeitzone)",
    istanbulTimeLabel: "Istanbuler Zeit",
    languageLabel: "Sprache der Sprechstunde",
    panelCta: "Dolmetscherbereich öffnen",
    participantSubject: "Zu Ihrer Sprechstunde kommt ein(e) Dolmetscher(in) hinzu",
    patientIntro: "Zu Ihrer Sprechstunde kommt ein(e) Dolmetscher(in) hinzu, der/die eine Verschwiegenheitserklärung unterzeichnet hat.",
    doctorIntro: "Zu Ihrer Sprechstunde kommt ein(e) Dolmetscher(in) hinzu.",
    interpreterLabel: "Dolmetscher(in)",
  },
  es: {
    interpreterSubject: "Nueva asignación de interpretación",
    interpreterIntro: "Se le ha asignado para interpretar en una consulta en línea.",
    dateLabel: "Fecha y hora (su zona horaria)",
    istanbulTimeLabel: "Hora de Estambul",
    languageLabel: "Idioma de la consulta",
    panelCta: "Abrir su panel de intérprete",
    participantSubject: "Un intérprete participará en su consulta",
    patientIntro: "Un intérprete que ha firmado un compromiso de confidencialidad participará en su consulta.",
    doctorIntro: "Un intérprete participará en su consulta.",
    interpreterLabel: "Intérprete",
  },
  fr: {
    interpreterSubject: "Nouvelle mission d’interprétariat",
    interpreterIntro: "Vous avez été désigné(e) pour interpréter une téléconsultation.",
    dateLabel: "Date et heure (votre fuseau horaire)",
    istanbulTimeLabel: "Heure d’Istanbul",
    languageLabel: "Langue de la consultation",
    panelCta: "Ouvrir votre espace interprète",
    participantSubject: "Un interprète participera à votre consultation",
    patientIntro: "Un interprète ayant signé un engagement de confidentialité participera à votre consultation.",
    doctorIntro: "Un interprète participera à votre consultation.",
    interpreterLabel: "Interprète",
  },
  ar: {
    interpreterSubject: "مهمة ترجمة جديدة",
    interpreterIntro: "تم تعيينك للترجمة في استشارة عبر الإنترنت.",
    dateLabel: "التاريخ والوقت (منطقتك الزمنية)",
    istanbulTimeLabel: "توقيت إسطنبول",
    languageLabel: "لغة الاستشارة",
    panelCta: "افتح لوحة المترجم",
    participantSubject: "سينضم مترجم إلى استشارتك",
    patientIntro: "سينضم إلى استشارتك مترجم وقّع تعهدًا بالسرية.",
    doctorIntro: "سينضم مترجم إلى استشارتك.",
    interpreterLabel: "المترجم",
  },
  ru: {
    interpreterSubject: "Новое назначение переводчика",
    interpreterIntro: "Вы назначены переводчиком на онлайн-консультацию.",
    dateLabel: "Дата и время (ваш часовой пояс)",
    istanbulTimeLabel: "Время Стамбула",
    languageLabel: "Язык консультации",
    panelCta: "Открыть панель переводчика",
    participantSubject: "К вашей консультации подключится переводчик",
    patientIntro: "К вашей консультации подключится переводчик, подписавший обязательство о конфиденциальности.",
    doctorIntro: "К вашей консультации подключится переводчик.",
    interpreterLabel: "Переводчик",
  },
  ro: {
    interpreterSubject: "Nouă sarcină de interpretare",
    interpreterIntro: "Ați fost desemnat(ă) să interpretați într-o consultație online.",
    dateLabel: "Data și ora (fusul dumneavoastră orar)",
    istanbulTimeLabel: "Ora Istanbulului",
    languageLabel: "Limba consultației",
    panelCta: "Deschideți panoul de interpret",
    participantSubject: "Un interpret va participa la consultația dumneavoastră",
    patientIntro: "La consultația dumneavoastră va participa un interpret care a semnat un angajament de confidențialitate.",
    doctorIntro: "Un interpret va participa la consultația dumneavoastră.",
    interpreterLabel: "Interpret",
  },
  "sr-latn": {
    interpreterSubject: "Novi prevodilački zadatak",
    interpreterIntro: "Dodeljeni ste kao prevodilac na onlajn konsultaciji.",
    dateLabel: "Datum i vreme (vaša vremenska zona)",
    istanbulTimeLabel: "Vreme u Istanbulu",
    languageLabel: "Jezik konsultacije",
    panelCta: "Otvorite panel prevodioca",
    participantSubject: "Prevodilac će se pridružiti vašoj konsultaciji",
    patientIntro: "Vašoj konsultaciji pridružiće se prevodilac koji je potpisao izjavu o poverljivosti.",
    doctorIntro: "Prevodilac će se pridružiti vašoj konsultaciji.",
    interpreterLabel: "Prevodilac",
  },
};

const INTL_LOCALE: Record<NotificationLocale, string> = {
  en: "en-GB",
  tr: "tr-TR",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  ar: "ar",
  ru: "ru-RU",
  ro: "ro-RO",
  "sr-latn": "sr-Latn-RS",
};

export function toNotificationLocale(code: string | null | undefined, fallback: NotificationLocale = "en"): NotificationLocale {
  const normalized = (code ?? "").toLowerCase();
  return (NOTIFICATION_LOCALES as readonly string[]).includes(normalized) ? (normalized as NotificationLocale) : fallback;
}

/** Tercümanın e-posta dili: Türkçe konuşuyorsa TR, değilse EN, değilse desteklenen ilk dili. */
export function interpreterEmailLocale(languages: readonly string[]): NotificationLocale {
  const lower = languages.map((l) => l.toLowerCase());
  if (lower.includes("tr")) return "tr";
  if (lower.includes("en")) return "en";
  return toNotificationLocale(lower.find((l) => (NOTIFICATION_LOCALES as readonly string[]).includes(l)));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function formatInZone(date: Date, locale: NotificationLocale, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "full", timeStyle: "short", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(date);
  }
}

function wrap(locale: NotificationLocale, rows: string[]): string {
  const dir = locale === "ar" ? "rtl" : "ltr";
  return `<div dir="${dir}" lang="${locale}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111827;">${rows.join("")}</div>`;
}

export interface InterpreterEmailInput {
  locale: NotificationLocale;
  startsAt: Date;
  interpreterTimeZone: string;
  language: string;
  panelUrl: string;
}

/** Tercümana: tarih/saat (kendi diliminde + TR saati), dil, panel bağlantısı. Hasta bilgisi YOK. */
export function buildInterpreterAssignmentEmail(input: InterpreterEmailInput): { subject: string; html: string } {
  const t = STRINGS[input.locale];
  const rows = [
    `<p>${escapeHtml(t.interpreterIntro)}</p>`,
    `<p><strong>${escapeHtml(t.dateLabel)}:</strong> ${escapeHtml(formatInZone(input.startsAt, input.locale, input.interpreterTimeZone))}<br/>`,
    `<strong>${escapeHtml(t.istanbulTimeLabel)}:</strong> ${escapeHtml(formatInZone(input.startsAt, input.locale, "Europe/Istanbul"))}<br/>`,
    `<strong>${escapeHtml(t.languageLabel)}:</strong> ${escapeHtml(nativeLanguageName(input.language))}</p>`,
    `<p><a href="${escapeHtml(input.panelUrl)}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;">${escapeHtml(t.panelCta)}</a></p>`,
  ];
  return { subject: t.interpreterSubject, html: wrap(input.locale, rows) };
}

export interface ParticipantEmailInput {
  locale: NotificationLocale;
  audience: "patient" | "doctor";
  startsAt: Date;
  timeZone: string;
  language: string;
  interpreterDisplayName: string;
}

/** Hastaya/doktora: "Görüşmenize tercüman katılacak (dil)" + tercümanın yalnızca görünen adı. */
export function buildParticipantInterpreterEmail(input: ParticipantEmailInput): { subject: string; html: string } {
  const t = STRINGS[input.locale];
  const rows = [
    `<p>${escapeHtml(input.audience === "patient" ? t.patientIntro : t.doctorIntro)} (${escapeHtml(nativeLanguageName(input.language))})</p>`,
    `<p><strong>${escapeHtml(t.interpreterLabel)}:</strong> ${escapeHtml(input.interpreterDisplayName)}<br/>`,
    `<strong>${escapeHtml(t.dateLabel)}:</strong> ${escapeHtml(formatInZone(input.startsAt, input.locale, input.timeZone))}</p>`,
  ];
  return { subject: t.participantSubject, html: wrap(input.locale, rows) };
}

/** Best-effort gönderim — hata loglanır, atamayı etkilemez. */
export async function sendInterpreterEmails(app: FastifyInstance, messages: { to: string | null | undefined; subject: string; html: string }[]): Promise<void> {
  for (const message of messages) {
    if (!message.to) continue;
    try {
      await sendMail(app, { to: message.to, subject: message.subject, html: message.html });
    } catch (err) {
      app.log.warn({ err }, "Tercüman atama e-postası gönderilemedi (best-effort).");
    }
  }
}
