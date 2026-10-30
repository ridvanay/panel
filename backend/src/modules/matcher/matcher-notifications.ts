import type { FastifyInstance } from "fastify";
import { sendBrandedMail } from "../../lib/branded-mail";
import { env } from "../../config/env";
import { sendTemplateEmail } from "../email-templates/email-templates.service";
import { readCrmSettings } from "../crm/crm.settings";

/**
 * Paket W — bildirimler. VERİ SINIRI: hiçbir e-postada şikayet/serbest metin, konu, önerilen uzmanlık
 * ya da hekim YER ALMAZ (sağlık verisi). Admin/koordinatöre yalnızca "Yeni eşleştirme talebi #123" +
 * admin bağlantısı; kullanıcıya yalnızca talep numarası ve süreç bilgisi (kendi dilinde).
 */
export const MATCHER_EMAIL_LOCALES = ["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;
export type MatcherEmailLocale = (typeof MATCHER_EMAIL_LOCALES)[number];

export function toMatcherEmailLocale(code: string | null | undefined): MatcherEmailLocale {
  const normalized = (code ?? "").toLowerCase();
  return (MATCHER_EMAIL_LOCALES as readonly string[]).includes(normalized) ? (normalized as MatcherEmailLocale) : "en";
}

interface ConfirmationStrings {
  subject: string;
  intro: string;
  contactLine: string;
  noContactLine: string;
  disclaimer: string;
}

const CONFIRMATION: Record<MatcherEmailLocale, ConfirmationStrings> = {
  en: {
    subject: "We have received your request #{number}",
    intro: "Thank you. We have received your physician matching request #{number}.",
    contactLine: "Our patient coordinator will contact you within 1 business day.",
    noContactLine: "You did not give permission to be contacted, so we will not call or write to you about this request.",
    disclaimer: "This tool does not provide a diagnosis or medical advice.",
  },
  tr: {
    subject: "Talebinizi aldık #{number}",
    intro: "Teşekkür ederiz. #{number} numaralı hekim eşleştirme talebinizi aldık.",
    contactLine: "Hasta koordinatörümüz 1 iş günü içinde sizinle iletişime geçecek.",
    noContactLine: "İletişime geçilmesine izin vermediğiniz için bu talep hakkında sizi aramayacak ve size yazmayacağız.",
    disclaimer: "Bu araç tanı koymaz ve tıbbi tavsiye vermez.",
  },
  de: {
    subject: "Wir haben Ihre Anfrage #{number} erhalten",
    intro: "Vielen Dank. Wir haben Ihre Anfrage zur Arztsuche #{number} erhalten.",
    contactLine: "Unsere Patientenkoordination meldet sich innerhalb von einem Werktag bei Ihnen.",
    noContactLine: "Sie haben einer Kontaktaufnahme nicht zugestimmt; wir werden Sie zu dieser Anfrage daher weder anrufen noch anschreiben.",
    disclaimer: "Dieses Tool stellt keine Diagnose und ersetzt keine ärztliche Beratung.",
  },
  es: {
    subject: "Hemos recibido su solicitud n.º {number}",
    intro: "Gracias. Hemos recibido su solicitud de búsqueda de médico n.º {number}.",
    contactLine: "Nuestro coordinador de pacientes se pondrá en contacto con usted en un plazo de 1 día hábil.",
    noContactLine: "No ha autorizado que le contactemos, por lo que no le llamaremos ni le escribiremos sobre esta solicitud.",
    disclaimer: "Esta herramienta no ofrece diagnósticos ni consejo médico.",
  },
  fr: {
    subject: "Nous avons bien reçu votre demande n° {number}",
    intro: "Merci. Nous avons bien reçu votre demande d’orientation vers un médecin n° {number}.",
    contactLine: "Notre coordinateur patients vous contactera sous 1 jour ouvré.",
    noContactLine: "Vous n’avez pas autorisé de prise de contact : nous ne vous appellerons pas et ne vous écrirons pas au sujet de cette demande.",
    disclaimer: "Cet outil ne pose pas de diagnostic et ne fournit pas d’avis médical.",
  },
  ar: {
    subject: "تلقّينا طلبك رقم {number}",
    intro: "شكرًا لك. تلقّينا طلبك لاختيار الطبيب المناسب رقم {number}.",
    contactLine: "سيتواصل معك منسّق المرضى لدينا خلال يوم عمل واحد.",
    noContactLine: "لم تمنحنا الإذن بالتواصل معك، لذلك لن نتصل بك أو نراسلك بشأن هذا الطلب.",
    disclaimer: "هذه الأداة لا تقدّم تشخيصًا ولا نصيحة طبية.",
  },
  ru: {
    subject: "Мы получили вашу заявку № {number}",
    intro: "Спасибо. Мы получили вашу заявку на подбор врача № {number}.",
    contactLine: "Наш координатор пациентов свяжется с вами в течение 1 рабочего дня.",
    noContactLine: "Вы не дали согласия на связь, поэтому мы не будем звонить или писать вам по этой заявке.",
    disclaimer: "Этот сервис не ставит диагноз и не даёт медицинских рекомендаций.",
  },
  ro: {
    subject: "Am primit solicitarea dumneavoastră nr. {number}",
    intro: "Vă mulțumim. Am primit solicitarea dumneavoastră de alegere a medicului nr. {number}.",
    contactLine: "Coordonatorul nostru de pacienți vă va contacta în cel mult 1 zi lucrătoare.",
    noContactLine: "Nu ați acordat permisiunea de a fi contactat, așa că nu vă vom suna și nu vă vom scrie despre această solicitare.",
    disclaimer: "Acest instrument nu pune diagnostice și nu oferă sfaturi medicale.",
  },
  "sr-latn": {
    subject: "Primili smo vaš zahtev br. {number}",
    intro: "Hvala vam. Primili smo vaš zahtev za izbor lekara br. {number}.",
    contactLine: "Naš koordinator za pacijente javiće vam se u roku od 1 radnog dana.",
    noContactLine: "Niste dali dozvolu da vas kontaktiramo, pa vas povodom ovog zahteva nećemo zvati niti vam pisati.",
    disclaimer: "Ovaj alat ne postavlja dijagnozu i ne daje medicinske savete.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildMatcherConfirmationEmail(input: { locale: MatcherEmailLocale; number: number; contactAllowed: boolean }): { subject: string; html: string } {
  const t = CONFIRMATION[input.locale];
  const fill = (s: string) => s.replace("{number}", String(input.number));
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const rows = [fill(t.intro), input.contactAllowed ? t.contactLine : t.noContactLine, t.disclaimer].map((line) => `<p>${escapeHtml(line)}</p>`);
  return {
    subject: fill(t.subject),
    // Paket AC — yalnızca gövde; logo/footer/düz metin kurumsal kabuktan.
    html: `<div dir="${dir}" lang="${input.locale}">${rows.join("")}</div>`,
  };
}

/** Şablon yoksa koordinatöre giden yedek metin — yalnızca talep numarası + panel bağlantısı. */
export function buildMatcherLeadFallbackNotice(number: number, adminUrl: string): { subject: string; bodyHtml: string } {
  return {
    subject: `Yeni eşleştirme talebi #${number}`,
    bodyHtml: `<p>Hekim eşleştirme sihirbazından yeni bir talep geldi: <strong>#${number}</strong>.</p><p><a href="${escapeHtml(adminUrl)}">Talebi panelde aç</a></p>`,
  };
}

/** Admin/koordinatör: `matcher.new_lead` şablonu; şablon yoksa (seed edilmemiş ortam) aynı içerikte yedek. */
export async function notifyMatcherLead(app: FastifyInstance, input: { number: number; leadId: string }): Promise<void> {
  const settings = await readCrmSettings(app.prisma);
  const to = settings.notificationEmail;
  if (!to) return;
  const adminUrl = `${env.FRONTEND_URL}/admin/crm/leads/${input.leadId}`;
  try {
    await sendTemplateEmail(app, "MATCHER_NEW_LEAD", to, { submission_number: String(input.number), admin_url: adminUrl }, { locale: "tr", audience: "staff" });
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "matcher.new_lead şablonu kullanılamadı; yedek metinle gönderiliyor.");
    try {
      const notice = buildMatcherLeadFallbackNotice(input.number, adminUrl);
      await sendBrandedMail(app, { to, subject: notice.subject, preheader: notice.subject, bodyHtml: notice.bodyHtml, locale: "tr", audience: "staff" });
    } catch (fallbackErr) {
      app.log.warn({ err: (fallbackErr as Error).message }, "Eşleştirme bildirimi gönderilemedi (best-effort).");
    }
  }
}

export async function sendMatcherConfirmation(app: FastifyInstance, input: { to: string; locale: string; number: number; contactAllowed: boolean }): Promise<void> {
  const mail = buildMatcherConfirmationEmail({ locale: toMatcherEmailLocale(input.locale), number: input.number, contactAllowed: input.contactAllowed });
  try {
    await sendBrandedMail(app, { to: input.to, subject: mail.subject, preheader: mail.subject, bodyHtml: mail.html, locale: toMatcherEmailLocale(input.locale), audience: "patient" });
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "Eşleştirme onay e-postası gönderilemedi (best-effort).");
  }
}
