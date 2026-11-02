import { toCustomerEmailLocale, type BrandLocale } from "../../../lib/branded-email";
import { formatIstanbulStamp } from "./booking-notification-email";

/**
 * Paket AG (İş 3) — harici toplantı davet e-postasının içeriği (SAF: DB/IO yok; kurumsal kabuğa `audience: "user"`
 * ile verilir). GİZLİLİK: yalnızca toplantı başlığı (zaten misafire görünür), ev sahibinin GÖRÜNEN adı, zaman ve
 * katılım bağlantısı. Not alanı, ev sahibi e-postası, alıcının adresi ve hasta/sağlık bilgisi BU E-POSTADA YOKTUR —
 * girdi tipi bunları zaten taşımaz.
 */
export interface MeetingInviteEmailData {
  locale: string;
  title: string;
  hostName: string;
  startsAt: Date;
  endsAt: Date;
  joinUrl: string;
}

interface Strings {
  subject: (title: string) => string;
  intro: (host: string) => string;
  topic: string;
  when: string;
  cta: string;
  after: string;
}

/** Müşteriye giden e-posta Türkçe olmaz (Paket AH): `tr` -> `en` (`toCustomerEmailLocale`), bu yüzden `tr` metni YOK. */
const STRINGS: Record<Exclude<BrandLocale, "tr">, Strings> = {
  en: {
    subject: (t) => `Video meeting invitation: ${t}`,
    intro: (h) => `${h} has invited you to a video meeting.`,
    topic: "Topic",
    when: "Time",
    cta: "Join the meeting",
    after: "The room opens 15 minutes before the start time. No account is needed; you will be asked for your name. The meeting is not recorded. This link is personal, please do not forward it.",
  },
  de: {
    subject: (t) => `Einladung zum Videomeeting: ${t}`,
    intro: (h) => `${h} hat Sie zu einem Videomeeting eingeladen.`,
    topic: "Thema",
    when: "Zeit",
    cta: "Am Meeting teilnehmen",
    after: "Der Raum öffnet 15 Minuten vor Beginn. Ein Konto ist nicht nötig; beim Beitritt wird nach Ihrem Namen gefragt. Das Meeting wird nicht aufgezeichnet. Dieser Link ist persönlich, bitte nicht weiterleiten.",
  },
  es: {
    subject: (t) => `Invitación a una videoreunión: ${t}`,
    intro: (h) => `${h} le ha invitado a una videoreunión.`,
    topic: "Asunto",
    when: "Hora",
    cta: "Unirse a la reunión",
    after: "La sala se abre 15 minutos antes del inicio. No necesita una cuenta; se le pedirá su nombre. La reunión no se graba. Este enlace es personal, no lo reenvíe.",
  },
  fr: {
    subject: (t) => `Invitation à une visioconférence : ${t}`,
    intro: (h) => `${h} vous invite à une visioconférence.`,
    topic: "Sujet",
    when: "Heure",
    cta: "Rejoindre la réunion",
    after: "La salle ouvre 15 minutes avant le début. Aucun compte n’est nécessaire ; votre nom vous sera demandé. La réunion n’est pas enregistrée. Ce lien est personnel, merci de ne pas le transférer.",
  },
  ar: {
    subject: (t) => `دعوة إلى اجتماع مرئي: ${t}`,
    intro: (h) => `دعاك ${h} إلى اجتماع مرئي.`,
    topic: "الموضوع",
    when: "الوقت",
    cta: "الانضمام إلى الاجتماع",
    after: "تُفتح القاعة قبل موعد البدء بـ 15 دقيقة. لا حاجة إلى حساب؛ سيُطلب منك إدخال اسمك. لا يتم تسجيل الاجتماع. هذا الرابط شخصي، يرجى عدم إعادة توجيهه.",
  },
  ru: {
    subject: (t) => `Приглашение на видеовстречу: ${t}`,
    intro: (h) => `${h} приглашает вас на видеовстречу.`,
    topic: "Тема",
    when: "Время",
    cta: "Присоединиться к встрече",
    after: "Комната открывается за 15 минут до начала. Учётная запись не нужна; при входе вас попросят указать имя. Встреча не записывается. Эта ссылка персональная, пожалуйста, не пересылайте её.",
  },
  ro: {
    subject: (t) => `Invitație la o videoconferință: ${t}`,
    intro: (h) => `${h} v-a invitat la o videoconferință.`,
    topic: "Subiect",
    when: "Ora",
    cta: "Intrați în ședință",
    after: "Camera se deschide cu 15 minute înainte de început. Nu aveți nevoie de cont; vi se va cere numele. Ședința nu este înregistrată. Acest link este personal, vă rugăm să nu îl transmiteți mai departe.",
  },
  "sr-latn": {
    subject: (t) => `Poziv na video sastanak: ${t}`,
    intro: (h) => `${h} vas poziva na video sastanak.`,
    topic: "Tema",
    when: "Vreme",
    cta: "Pridružite se sastanku",
    after: "Soba se otvara 15 minuta pre početka. Nalog nije potreban; biće zatraženo vaše ime. Sastanak se ne snima. Ovaj link je lični, molimo vas da ga ne prosleđujete.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function utcClock(instant: Date): string {
  return instant.toISOString().slice(11, 16);
}

export interface MeetingInviteEmail {
  subject: string;
  bodyHtml: string;
  cta: { label: string; url: string };
  afterCtaHtml: string;
}

export function buildMeetingInviteEmail(data: MeetingInviteEmailData): MeetingInviteEmail {
  const locale = toCustomerEmailLocale(data.locale) as Exclude<BrandLocale, "tr">;
  const s = STRINGS[locale];
  const time = `${formatIstanbulStamp(data.startsAt)} – ${formatIstanbulStamp(data.endsAt).slice(11)} (Europe/Istanbul) · ${utcClock(data.startsAt)} – ${utcClock(data.endsAt)} UTC`;
  const bodyHtml =
    `<p>${escapeHtml(s.intro(data.hostName))}</p>` +
    `<p><strong>${escapeHtml(s.topic)}:</strong> ${escapeHtml(data.title)}<br><strong>${escapeHtml(s.when)}:</strong> ${escapeHtml(time)}</p>`;
  return {
    subject: s.subject(data.title),
    bodyHtml,
    cta: { label: s.cta, url: data.joinUrl },
    afterCtaHtml: `<p>${escapeHtml(s.after)}</p>`,
  };
}
