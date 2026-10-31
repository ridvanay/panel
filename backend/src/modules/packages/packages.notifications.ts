import type { FastifyInstance } from "fastify";
import { sendBrandedMail } from "../../lib/branded-mail";
import { env } from "../../config/env";
import { readCrmSettings } from "../crm/crm.settings";
import { parseContactChannels } from "./packages.shared";

/**
 * Paket X — "Plan my package" e-postaları (Paket AC kurumsal kabuğu).
 * - `package.new_inquiry` (koordinatöre): YALNIZCA talep numarası, paket adı ve panel bağlantısı. Hasta adı, notu ve
 *   sağlık bilgisi YOK (koordinatör ayrıntıyı yetkili panelde görür).
 * - Hastaya onay: alıcının dilinde; notu ya da sağlık bilgisini geri yansıtmaz.
 */
export const PACKAGE_EMAIL_LOCALES = ["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;
export type PackageEmailLocale = (typeof PACKAGE_EMAIL_LOCALES)[number];

export function toPackageEmailLocale(code: string | null | undefined): PackageEmailLocale {
  const normalized = (code ?? "").toLowerCase();
  return (PACKAGE_EMAIL_LOCALES as readonly string[]).includes(normalized) ? (normalized as PackageEmailLocale) : "en";
}

interface ConfirmationStrings {
  subject: string;
  intro: string;
  next: string;
  price: string;
  /** KVKK m.11 / rıza geri çekme: yanıtlayarak silme ya da onayı geri çekme. */
  rights: string;
}

const CONFIRMATION: Record<PackageEmailLocale, ConfirmationStrings> = {
  en: {
    subject: "We have received your package request #{number}",
    intro: "Thank you. We have received your planning request #{number} for “{package}”.",
    next: "Our patient coordinator will contact you within 1 business day to plan the next steps.",
    price: "Any price shown on our website is an indicative starting price; the final price is confirmed after a medical evaluation.",
    rights: "If you would like us to delete your request or to withdraw your consent, simply reply to this email.",
  },
  tr: {
    subject: "Paket talebinizi aldık #{number}",
    intro: "Teşekkür ederiz. “{package}” için #{number} numaralı planlama talebinizi aldık.",
    next: "Hasta koordinatörümüz sonraki adımları planlamak için 1 iş günü içinde sizinle iletişime geçecek.",
    price: "Sitemizde gösterilen fiyatlar yalnızca başlangıç fiyatıdır; kesin fiyat tıbbi değerlendirmeden sonra belirlenir.",
    rights: "Talebinizin silinmesini ya da onayınızı geri çekmek isterseniz bu e-postayı yanıtlamanız yeterli.",
  },
  de: {
    subject: "Wir haben Ihre Paketanfrage #{number} erhalten",
    intro: "Vielen Dank. Wir haben Ihre Planungsanfrage #{number} für „{package}“ erhalten.",
    next: "Unser Patientenkoordinator meldet sich innerhalb eines Werktags bei Ihnen, um die nächsten Schritte zu planen.",
    price: "Auf unserer Website angezeigte Preise sind unverbindliche Ab-Preise; der endgültige Preis wird nach einer ärztlichen Beurteilung bestätigt.",
    rights: "Wenn wir Ihre Anfrage löschen sollen oder Sie Ihre Einwilligung widerrufen möchten, antworten Sie einfach auf diese E-Mail.",
  },
  es: {
    subject: "Hemos recibido su solicitud de paquete #{number}",
    intro: "Gracias. Hemos recibido su solicitud de planificación #{number} para «{package}».",
    next: "Nuestro coordinador de pacientes se pondrá en contacto con usted en 1 día hábil para planificar los siguientes pasos.",
    price: "Los precios mostrados en nuestro sitio son precios orientativos «desde»; el precio final se confirma tras una evaluación médica.",
    rights: "Si desea que eliminemos su solicitud o retirar su consentimiento, basta con responder a este correo.",
  },
  fr: {
    subject: "Nous avons reçu votre demande de forfait n° {number}",
    intro: "Merci. Nous avons reçu votre demande de planification n° {number} pour « {package} ».",
    next: "Notre coordinateur patients vous contactera sous 1 jour ouvré pour planifier les prochaines étapes.",
    price: "Les prix affichés sur notre site sont des prix indicatifs « à partir de » ; le prix final est confirmé après une évaluation médicale.",
    rights: "Si vous souhaitez que nous supprimions votre demande ou retirer votre consentement, répondez simplement à cet e-mail.",
  },
  ar: {
    subject: "تلقّينا طلب الباقة رقم {number}",
    intro: "شكرًا لك. تلقّينا طلب التخطيط رقم {number} الخاص بـ «{package}».",
    next: "سيتواصل معك منسق المرضى خلال يوم عمل واحد لتخطيط الخطوات التالية.",
    price: "الأسعار المعروضة على موقعنا أسعار بداية إرشادية؛ ويُؤكَّد السعر النهائي بعد التقييم الطبي.",
    rights: "إذا رغبت في حذف طلبك أو سحب موافقتك، فما عليك سوى الرد على هذه الرسالة.",
  },
  ru: {
    subject: "Мы получили ваш запрос на пакет № {number}",
    intro: "Спасибо. Мы получили ваш запрос на планирование № {number} по пакету «{package}».",
    next: "Наш координатор пациентов свяжется с вами в течение 1 рабочего дня, чтобы спланировать дальнейшие шаги.",
    price: "Цены на нашем сайте являются ориентировочными «от»; окончательная цена подтверждается после медицинской оценки.",
    rights: "Если вы хотите, чтобы мы удалили ваш запрос, или хотите отозвать согласие, просто ответьте на это письмо.",
  },
  ro: {
    subject: "Am primit solicitarea dumneavoastră de pachet nr. {number}",
    intro: "Vă mulțumim. Am primit solicitarea de planificare nr. {number} pentru „{package}”.",
    next: "Coordonatorul nostru de pacienți vă va contacta în cel mult 1 zi lucrătoare pentru a planifica pașii următori.",
    price: "Prețurile afișate pe site sunt prețuri orientative „de la”; prețul final se confirmă după o evaluare medicală.",
    rights: "Dacă doriți să vă ștergem solicitarea sau să vă retrageți consimțământul, răspundeți pur și simplu la acest e-mail.",
  },
  "sr-latn": {
    subject: "Primili smo vaš zahtev za paket br. {number}",
    intro: "Hvala vam. Primili smo vaš zahtev za planiranje br. {number} za „{package}”.",
    next: "Naš koordinator pacijenata javiće vam se u roku od 1 radnog dana kako bi isplanirao sledeće korake.",
    price: "Cene prikazane na našem sajtu su okvirne početne cene; konačna cena se potvrđuje nakon medicinske procene.",
    rights: "Ako želite da obrišemo vaš zahtev ili da povučete saglasnost, samo odgovorite na ovaj e-mail.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildPackageConfirmationEmail(input: { locale: PackageEmailLocale; number: number; packageTitle: string }): { subject: string; html: string } {
  const t = CONFIRMATION[input.locale];
  // Fonksiyon biçimi: paket adında `$&` gibi kalıplar yorumlanmasın.
  const fill = (s: string) => s.replaceAll("{number}", () => String(input.number)).replaceAll("{package}", () => input.packageTitle);
  const dir = input.locale === "ar" ? "rtl" : "ltr";
  const rows = [fill(t.intro), t.next, t.price, t.rights].map((line) => `<p>${escapeHtml(line)}</p>`);
  return { subject: fill(t.subject), html: `<div dir="${dir}" lang="${input.locale}">${rows.join("")}</div>` };
}

/** `package.new_inquiry` — koordinatöre: talep numarası, paket adı, panel bağlantısı. Not/sağlık bilgisi/hasta adı YOK. */
export function buildPackageInquiryNotice(input: { number: number; packageTitle: string; adminUrl: string }): { subject: string; bodyHtml: string } {
  return {
    subject: `Yeni paket talebi #${input.number}`,
    bodyHtml:
      `<p>“${escapeHtml(input.packageTitle)}” paketi için yeni bir planlama talebi geldi: <strong>#${input.number}</strong>.</p>` +
      `<p>Ayrıntılar yalnızca yetkili panelde görüntülenir.</p>` +
      `<p><a href="${escapeHtml(input.adminUrl)}">Talebi panelde aç</a></p>`,
  };
}

export async function notifyPackageInquiry(app: FastifyInstance, input: { number: number; leadId: string; packageTitle: string }): Promise<void> {
  try {
    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
    const to = parseContactChannels(row?.settings).coordinatorEmail ?? (await readCrmSettings(app.prisma)).notificationEmail;
    if (!to) return;
    const notice = buildPackageInquiryNotice({ number: input.number, packageTitle: input.packageTitle, adminUrl: `${env.FRONTEND_URL}/admin/crm/leads/${input.leadId}` });
    // Koordinatör/yönetim e-postaları panel dilinde (Türkçe), eşleştirme bildirimiyle aynı.
    await sendBrandedMail(app, { to, subject: notice.subject, preheader: notice.subject, bodyHtml: notice.bodyHtml, locale: "tr", audience: "staff" });
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "package.new_inquiry e-postası gönderilemedi (best-effort).");
  }
}

export async function sendPackageConfirmation(app: FastifyInstance, input: { to: string; locale: string; number: number; packageTitle: string }): Promise<void> {
  const locale = toPackageEmailLocale(input.locale);
  const mail = buildPackageConfirmationEmail({ locale, number: input.number, packageTitle: input.packageTitle });
  try {
    await sendBrandedMail(app, { to: input.to, subject: mail.subject, preheader: mail.subject, bodyHtml: mail.html, locale, audience: "patient" });
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "Paket onay e-postası gönderilemedi (best-effort).");
  }
}
