import { escapeHtml, toCustomerEmailLocale } from "../../lib/branded-email";
import { TURKEY_TIME_ZONE, cityLabel, formatWall, isValidTimeZone, sameWallClock } from "../../lib/dual-time";
import { toIntermediaryLocale, type IntermediaryLocale } from "../../lib/intermediary-identity";
import { formatIstanbulStamp } from "../telehealth/lib/booking-notification-email";

/**
 * Paket AI (Is 3) - hizmet gorusmesi e-postalari (SAF: DB/IO yok; `consultation-request-email.ts` deseni).
 *
 * 1) Hasta e-postalari (8 dil; `tr` -> `en`, musteriye Turkce e-posta gitmez): onay, saat degisikligi, 24 saat ve 60 dk
 *    hatirlatma, iptal. GIZLILIK: konu satirinda ve govdede HIZMET ADI YOK (yanlis adrese giden e-posta saglik bilgisi
 *    sezdirmemeli). Kurulus kimligi ibaresi kurumsal kabugun footer'inda (`lib/branded-email.ts`) otomatik gelir.
 * 2) Personel e-postalari (EN, `audience: "staff"`): yonetici bildirimi ve koordinator atama. KISISEL VERI YOK - girdi tipi
 *    ad/e-posta/telefon/mesaj tasimaz.
 */

export const SERVICE_CONSULTATION_JOIN_LEAD_MIN = 15;

export type ServiceEmailKind = "confirmed" | "rescheduled" | "reminder24h" | "reminder60m" | "cancelled";

interface Strings {
  confirmedSubject: string;
  confirmedIntro: string;
  rescheduledSubject: string;
  rescheduledIntro: string;
  reminder24Subject: string;
  reminder24Intro: string;
  reminder24Note: string;
  reminder60Subject: string;
  reminder60Intro: string;
  reminder60Note: string;
  cancelledSubject: string;
  cancelledIntro: string;
  bookAgainCta: string;
  numberLabel: string;
  whenLabel: string;
  durationLabel: string;
  durationValue: string;
  deskTime: string;
  yourTime: string;
  joinCta: string;
  joinNote: string;
  manageLead: string;
  manageCta: string;
  notMedical: string;
}

/** Musteriye giden e-posta Turkce olmaz: `tr` metni YOK. {no} = SVC numarasi, {min} = sure (dk). */
export const SERVICE_CONSULTATION_EMAIL: Record<IntermediaryLocale, Strings> = {
  en: {
    confirmedSubject: "Your online consultation is confirmed - {no}",
    confirmedIntro: "Your free online consultation with a WM Health patient coordinator is confirmed.",
    rescheduledSubject: "Your online consultation has a new time - {no}",
    rescheduledIntro: "The time of your online consultation has changed. Your previous join link no longer works; please use the new link below.",
    reminder24Subject: "Reminder: your online consultation is tomorrow - {no}",
    reminder24Intro: "This is a reminder of your online consultation with a WM Health patient coordinator.",
    reminder24Note: "Your personal join link will be sent to you about 1 hour before the start time.",
    reminder60Subject: "Your online consultation starts in about 1 hour - {no}",
    reminder60Intro: "Your online consultation with a WM Health patient coordinator starts soon.",
    reminder60Note: "This link replaces previous links. The room opens 15 minutes before the start time.",
    cancelledSubject: "Your online consultation {no} has been cancelled",
    cancelledIntro: "Your online consultation has been cancelled.",
    bookAgainCta: "Book a new time",
    numberLabel: "Consultation number",
    whenLabel: "Date and time",
    durationLabel: "Duration",
    durationValue: "{min} minutes",
    deskTime: "Istanbul time",
    yourTime: "your time",
    joinCta: "Join the consultation",
    joinNote:
      "The room opens 15 minutes before the start time. No account is needed; you will be asked for your name and your coordinator will admit you. The consultation is not recorded. This link is personal, please do not forward it.",
    manageLead: "Need to cancel or change the time?",
    manageCta: "Manage your booking",
    notMedical: "This is not a medical examination. Medical assessment and treatment decisions are made by physicians at authorized healthcare facilities.",
  },
  de: {
    confirmedSubject: "Ihre Online-Beratung ist bestätigt - {no}",
    confirmedIntro: "Ihre kostenlose Online-Beratung mit einer Patientenkoordination von WM Health ist bestätigt.",
    rescheduledSubject: "Neuer Termin für Ihre Online-Beratung - {no}",
    rescheduledIntro: "Der Termin Ihrer Online-Beratung hat sich geändert. Ihr bisheriger Teilnahmelink funktioniert nicht mehr; bitte nutzen Sie den neuen Link unten.",
    reminder24Subject: "Erinnerung: Ihre Online-Beratung ist morgen - {no}",
    reminder24Intro: "Dies ist eine Erinnerung an Ihre Online-Beratung mit einer Patientenkoordination von WM Health.",
    reminder24Note: "Ihren persönlichen Teilnahmelink erhalten Sie etwa 1 Stunde vor Beginn.",
    reminder60Subject: "Ihre Online-Beratung beginnt in etwa 1 Stunde - {no}",
    reminder60Intro: "Ihre Online-Beratung mit einer Patientenkoordination von WM Health beginnt bald.",
    reminder60Note: "Dieser Link ersetzt frühere Links. Der Raum öffnet 15 Minuten vor Beginn.",
    cancelledSubject: "Ihre Online-Beratung {no} wurde abgesagt",
    cancelledIntro: "Ihre Online-Beratung wurde abgesagt.",
    bookAgainCta: "Neuen Termin buchen",
    numberLabel: "Beratungsnummer",
    whenLabel: "Datum und Uhrzeit",
    durationLabel: "Dauer",
    durationValue: "{min} Minuten",
    deskTime: "Istanbuler Zeit",
    yourTime: "Ihre Zeit",
    joinCta: "An der Beratung teilnehmen",
    joinNote:
      "Der Raum öffnet 15 Minuten vor Beginn. Ein Konto ist nicht nötig; Sie werden nach Ihrem Namen gefragt und Ihre Koordination lässt Sie ein. Die Beratung wird nicht aufgezeichnet. Dieser Link ist persönlich, bitte nicht weiterleiten.",
    manageLead: "Möchten Sie absagen oder den Termin ändern?",
    manageCta: "Buchung verwalten",
    notMedical: "Dies ist keine ärztliche Untersuchung. Medizinische Beurteilungen und Behandlungsentscheidungen treffen Ärztinnen und Ärzte in zugelassenen Gesundheitseinrichtungen.",
  },
  ar: {
    confirmedSubject: "تم تأكيد استشارتك عبر الإنترنت - {no}",
    confirmedIntro: "تم تأكيد استشارتك المجانية عبر الإنترنت مع منسّق المرضى في WM Health.",
    rescheduledSubject: "موعد جديد لاستشارتك عبر الإنترنت - {no}",
    rescheduledIntro: "تغيّر موعد استشارتك عبر الإنترنت. لم يعد رابط الانضمام السابق صالحًا؛ يُرجى استخدام الرابط الجديد أدناه.",
    reminder24Subject: "تذكير: استشارتك عبر الإنترنت غدًا - {no}",
    reminder24Intro: "هذا تذكير باستشارتك عبر الإنترنت مع منسّق المرضى في WM Health.",
    reminder24Note: "سيصلك رابط الانضمام الشخصي قبل موعد البدء بنحو ساعة واحدة.",
    reminder60Subject: "تبدأ استشارتك عبر الإنترنت بعد نحو ساعة - {no}",
    reminder60Intro: "ستبدأ قريبًا استشارتك عبر الإنترنت مع منسّق المرضى في WM Health.",
    reminder60Note: "يحلّ هذا الرابط محل الروابط السابقة. تُفتح الغرفة قبل موعد البدء بـ 15 دقيقة.",
    cancelledSubject: "تم إلغاء استشارتك عبر الإنترنت {no}",
    cancelledIntro: "تم إلغاء استشارتك عبر الإنترنت.",
    bookAgainCta: "احجز موعدًا جديدًا",
    numberLabel: "رقم الاستشارة",
    whenLabel: "التاريخ والوقت",
    durationLabel: "المدة",
    durationValue: "{min} دقيقة",
    deskTime: "بتوقيت إسطنبول",
    yourTime: "بتوقيتك",
    joinCta: "الانضمام إلى الاستشارة",
    joinNote:
      "تُفتح الغرفة قبل موعد البدء بـ 15 دقيقة. لا حاجة إلى حساب؛ سيُطلب منك إدخال اسمك وسيسمح لك المنسّق بالدخول. لا يتم تسجيل الاستشارة. هذا الرابط شخصي، يُرجى عدم تحويله.",
    manageLead: "هل تريد الإلغاء أو تغيير الموعد؟",
    manageCta: "إدارة حجزك",
    notMedical: "هذه ليست فحصًا طبيًا. يتخذ الأطباء في المنشآت الصحية المرخّصة القرارات الطبية وقرارات العلاج.",
  },
  ru: {
    confirmedSubject: "Ваша онлайн-консультация подтверждена - {no}",
    confirmedIntro: "Ваша бесплатная онлайн-консультация с координатором пациентов WM Health подтверждена.",
    rescheduledSubject: "Новое время вашей онлайн-консультации - {no}",
    rescheduledIntro: "Время вашей онлайн-консультации изменилось. Прежняя ссылка для входа больше не действует; воспользуйтесь новой ссылкой ниже.",
    reminder24Subject: "Напоминание: ваша онлайн-консультация завтра - {no}",
    reminder24Intro: "Напоминаем о вашей онлайн-консультации с координатором пациентов WM Health.",
    reminder24Note: "Персональная ссылка для входа придёт примерно за 1 час до начала.",
    reminder60Subject: "Ваша онлайн-консультация начнётся примерно через 1 час - {no}",
    reminder60Intro: "Скоро начнётся ваша онлайн-консультация с координатором пациентов WM Health.",
    reminder60Note: "Эта ссылка заменяет предыдущие. Комната открывается за 15 минут до начала.",
    cancelledSubject: "Ваша онлайн-консультация {no} отменена",
    cancelledIntro: "Ваша онлайн-консультация отменена.",
    bookAgainCta: "Выбрать новое время",
    numberLabel: "Номер консультации",
    whenLabel: "Дата и время",
    durationLabel: "Длительность",
    durationValue: "{min} мин.",
    deskTime: "время Стамбула",
    yourTime: "ваше время",
    joinCta: "Присоединиться к консультации",
    joinNote:
      "Комната открывается за 15 минут до начала. Аккаунт не нужен; вас попросят указать имя, а координатор допустит вас в комнату. Консультация не записывается. Ссылка персональная, пожалуйста, не пересылайте её.",
    manageLead: "Нужно отменить или перенести консультацию?",
    manageCta: "Управление записью",
    notMedical: "Это не медицинский осмотр. Медицинские заключения и решения о лечении принимают врачи в авторизованных медицинских учреждениях.",
  },
  fr: {
    confirmedSubject: "Votre consultation en ligne est confirmée - {no}",
    confirmedIntro: "Votre consultation en ligne gratuite avec un coordinateur patients de WM Health est confirmée.",
    rescheduledSubject: "Nouvel horaire pour votre consultation en ligne - {no}",
    rescheduledIntro: "L’horaire de votre consultation en ligne a changé. Votre ancien lien de connexion ne fonctionne plus ; veuillez utiliser le nouveau lien ci-dessous.",
    reminder24Subject: "Rappel : votre consultation en ligne a lieu demain - {no}",
    reminder24Intro: "Ceci est un rappel de votre consultation en ligne avec un coordinateur patients de WM Health.",
    reminder24Note: "Votre lien de connexion personnel vous sera envoyé environ 1 heure avant le début.",
    reminder60Subject: "Votre consultation en ligne commence dans environ 1 heure - {no}",
    reminder60Intro: "Votre consultation en ligne avec un coordinateur patients de WM Health commence bientôt.",
    reminder60Note: "Ce lien remplace les liens précédents. La salle ouvre 15 minutes avant le début.",
    cancelledSubject: "Votre consultation en ligne {no} a été annulée",
    cancelledIntro: "Votre consultation en ligne a été annulée.",
    bookAgainCta: "Réserver un nouvel horaire",
    numberLabel: "Numéro de consultation",
    whenLabel: "Date et heure",
    durationLabel: "Durée",
    durationValue: "{min} minutes",
    deskTime: "heure d’Istanbul",
    yourTime: "votre heure",
    joinCta: "Rejoindre la consultation",
    joinNote:
      "La salle ouvre 15 minutes avant le début. Aucun compte n’est nécessaire ; votre nom vous sera demandé et votre coordinateur vous admettra. La consultation n’est pas enregistrée. Ce lien est personnel, merci de ne pas le transférer.",
    manageLead: "Besoin d’annuler ou de modifier l’horaire ?",
    manageCta: "Gérer votre réservation",
    notMedical: "Il ne s’agit pas d’un examen médical. Les évaluations médicales et les décisions de traitement relèvent de médecins exerçant dans des établissements de santé autorisés.",
  },
  es: {
    confirmedSubject: "Su consulta en línea está confirmada - {no}",
    confirmedIntro: "Su consulta en línea gratuita con un coordinador de pacientes de WM Health está confirmada.",
    rescheduledSubject: "Nuevo horario para su consulta en línea - {no}",
    rescheduledIntro: "El horario de su consulta en línea ha cambiado. Su enlace de acceso anterior ya no funciona; utilice el nuevo enlace de abajo.",
    reminder24Subject: "Recordatorio: su consulta en línea es mañana - {no}",
    reminder24Intro: "Este es un recordatorio de su consulta en línea con un coordinador de pacientes de WM Health.",
    reminder24Note: "Recibirá su enlace de acceso personal aproximadamente 1 hora antes del inicio.",
    reminder60Subject: "Su consulta en línea comienza en aproximadamente 1 hora - {no}",
    reminder60Intro: "Su consulta en línea con un coordinador de pacientes de WM Health comienza pronto.",
    reminder60Note: "Este enlace sustituye a los anteriores. La sala se abre 15 minutos antes del inicio.",
    cancelledSubject: "Su consulta en línea {no} ha sido cancelada",
    cancelledIntro: "Su consulta en línea ha sido cancelada.",
    bookAgainCta: "Reservar un nuevo horario",
    numberLabel: "Número de consulta",
    whenLabel: "Fecha y hora",
    durationLabel: "Duración",
    durationValue: "{min} minutos",
    deskTime: "hora de Estambul",
    yourTime: "su hora",
    joinCta: "Unirse a la consulta",
    joinNote:
      "La sala se abre 15 minutos antes del inicio. No necesita una cuenta; se le pedirá su nombre y su coordinador le dará acceso. La consulta no se graba. Este enlace es personal, por favor no lo reenvíe.",
    manageLead: "¿Necesita cancelar o cambiar el horario?",
    manageCta: "Gestionar su reserva",
    notMedical: "Esto no es un examen médico. La evaluación médica y las decisiones de tratamiento corresponden a médicos de centros sanitarios autorizados.",
  },
  ro: {
    confirmedSubject: "Consultația dumneavoastră online este confirmată - {no}",
    confirmedIntro: "Consultația dumneavoastră online gratuită cu un coordonator de pacienți WM Health este confirmată.",
    rescheduledSubject: "Oră nouă pentru consultația dumneavoastră online - {no}",
    rescheduledIntro: "Ora consultației dumneavoastră online s-a schimbat. Linkul de acces anterior nu mai funcționează; folosiți noul link de mai jos.",
    reminder24Subject: "Memento: consultația dumneavoastră online este mâine - {no}",
    reminder24Intro: "Acesta este un memento pentru consultația dumneavoastră online cu un coordonator de pacienți WM Health.",
    reminder24Note: "Linkul personal de acces vă va fi trimis cu aproximativ 1 oră înainte de început.",
    reminder60Subject: "Consultația dumneavoastră online începe în aproximativ 1 oră - {no}",
    reminder60Intro: "Consultația dumneavoastră online cu un coordonator de pacienți WM Health începe în curând.",
    reminder60Note: "Acest link îl înlocuiește pe cele anterioare. Camera se deschide cu 15 minute înainte de început.",
    cancelledSubject: "Consultația dumneavoastră online {no} a fost anulată",
    cancelledIntro: "Consultația dumneavoastră online a fost anulată.",
    bookAgainCta: "Rezervați o oră nouă",
    numberLabel: "Număr consultație",
    whenLabel: "Data și ora",
    durationLabel: "Durată",
    durationValue: "{min} minute",
    deskTime: "ora Istanbulului",
    yourTime: "ora dumneavoastră",
    joinCta: "Intrați în consultație",
    joinNote:
      "Camera se deschide cu 15 minute înainte de început. Nu aveți nevoie de cont; vi se va cere numele, iar coordonatorul vă va admite. Consultația nu este înregistrată. Acest link este personal, vă rugăm să nu îl redirecționați.",
    manageLead: "Doriți să anulați sau să schimbați ora?",
    manageCta: "Gestionați rezervarea",
    notMedical: "Aceasta nu este un consult medical. Evaluarea medicală și deciziile de tratament sunt luate de medici din unități sanitare autorizate.",
  },
  "sr-latn": {
    confirmedSubject: "Vaša onlajn konsultacija je potvrđena - {no}",
    confirmedIntro: "Vaša besplatna onlajn konsultacija sa koordinatorom za pacijente WM Health je potvrđena.",
    rescheduledSubject: "Novi termin vaše onlajn konsultacije - {no}",
    rescheduledIntro: "Termin vaše onlajn konsultacije je promenjen. Prethodni link za pristup više ne radi; koristite novi link ispod.",
    reminder24Subject: "Podsetnik: vaša onlajn konsultacija je sutra - {no}",
    reminder24Intro: "Ovo je podsetnik za vašu onlajn konsultaciju sa koordinatorom za pacijente WM Health.",
    reminder24Note: "Lični link za pristup dobićete otprilike 1 sat pre početka.",
    reminder60Subject: "Vaša onlajn konsultacija počinje za otprilike 1 sat - {no}",
    reminder60Intro: "Vaša onlajn konsultacija sa koordinatorom za pacijente WM Health uskoro počinje.",
    reminder60Note: "Ovaj link zamenjuje prethodne. Soba se otvara 15 minuta pre početka.",
    cancelledSubject: "Vaša onlajn konsultacija {no} je otkazana",
    cancelledIntro: "Vaša onlajn konsultacija je otkazana.",
    bookAgainCta: "Zakažite novi termin",
    numberLabel: "Broj konsultacije",
    whenLabel: "Datum i vreme",
    durationLabel: "Trajanje",
    durationValue: "{min} minuta",
    deskTime: "istanbulsko vreme",
    yourTime: "vaše vreme",
    joinCta: "Pridružite se konsultaciji",
    joinNote:
      "Soba se otvara 15 minuta pre početka. Nalog nije potreban; biće vam zatraženo ime, a koordinator će vas primiti. Konsultacija se ne snima. Ovaj link je lični, molimo vas da ga ne prosleđujete.",
    manageLead: "Želite da otkažete ili promenite termin?",
    manageCta: "Upravljajte rezervacijom",
    notMedical: "Ovo nije medicinski pregled. Medicinske procene i odluke o lečenju donose lekari u ovlašćenim zdravstvenim ustanovama.",
  },
};

const INTL_TAG: Record<IntermediaryLocale, string> = {
  en: "en-GB",
  de: "de-DE",
  ar: "ar-u-nu-latn",
  ru: "ru-RU",
  fr: "fr-FR",
  es: "es-ES",
  ro: "ro-RO",
  "sr-latn": "sr-Latn-RS",
};

function fmt(instant: Date, timeZone: string, locale: IntermediaryLocale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone, dateStyle: "full", timeStyle: "short" }).format(instant);
}

/** Hasta dilimi + masa (Istanbul) saati; ayni duvar saatiyse tek satir. Dil: alicinin dili. */
export function formatConsultationTime(instant: Date, patientTimeZone: string | null | undefined, locale: IntermediaryLocale): string {
  const s = SERVICE_CONSULTATION_EMAIL[locale];
  const desk = `${fmt(instant, TURKEY_TIME_ZONE, locale)} (${s.deskTime})`;
  const tz = patientTimeZone && isValidTimeZone(patientTimeZone) ? patientTimeZone : null;
  if (!tz || sameWallClock(instant, tz, TURKEY_TIME_ZONE)) return desk;
  return `${fmt(instant, tz, locale)} (${s.yourTime}, ${cityLabel(tz)}) / ${desk}`;
}

export interface PatientServiceEmailInput {
  kind: ServiceEmailKind;
  locale: string | null | undefined;
  consultationNumber: string;
  startsAt: Date;
  durationMin: number;
  patientTimeZone: string | null | undefined;
  /** Katilim baglantisi (confirmed / rescheduled / reminder60m). */
  joinUrl?: string | null;
  /** Yonetim baglantisi (confirmed / rescheduled). */
  manageUrl?: string | null;
  /** Yeni rezervasyon baglantisi (cancelled). */
  bookAgainUrl?: string | null;
}

export interface PatientServiceEmail {
  locale: IntermediaryLocale;
  subject: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  afterCtaHtml?: string;
}

const fill = (s: string, no: string, min?: number) => s.replaceAll("{no}", () => no).replaceAll("{min}", () => String(min ?? ""));

export function buildPatientServiceEmail(input: PatientServiceEmailInput): PatientServiceEmail {
  const locale = toIntermediaryLocale(toCustomerEmailLocale(input.locale));
  const s = SERVICE_CONSULTATION_EMAIL[locale];
  const no = input.consultationNumber;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const p = (text: string) => `<p>${escapeHtml(text)}</p>`;
  const row = (label: string, value: string) => `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
  const details = [
    row(s.numberLabel, no),
    row(s.whenLabel, formatConsultationTime(input.startsAt, input.patientTimeZone, locale)),
    row(s.durationLabel, fill(s.durationValue, no, input.durationMin)),
  ].join("");

  let subject: string;
  let intro: string;
  let note: string | null = null;
  switch (input.kind) {
    case "confirmed":
      subject = s.confirmedSubject;
      intro = s.confirmedIntro;
      note = s.joinNote;
      break;
    case "rescheduled":
      subject = s.rescheduledSubject;
      intro = s.rescheduledIntro;
      note = s.joinNote;
      break;
    case "reminder24h":
      subject = s.reminder24Subject;
      intro = s.reminder24Intro;
      note = s.reminder24Note;
      break;
    case "reminder60m":
      subject = s.reminder60Subject;
      intro = s.reminder60Intro;
      note = s.reminder60Note;
      break;
    case "cancelled":
      subject = s.cancelledSubject;
      intro = s.cancelledIntro;
      break;
  }

  const parts = [p(intro), details];
  if (note) parts.push(p(note));
  if (input.kind !== "cancelled") parts.push(p(s.notMedical));
  const bodyHtml = `<div dir="${dir}" lang="${locale}">${parts.join("")}</div>`;

  let cta: PatientServiceEmail["cta"];
  let afterCtaHtml: string | undefined;
  if (input.kind === "cancelled") {
    if (input.bookAgainUrl) cta = { label: s.bookAgainCta, url: input.bookAgainUrl };
  } else if (input.joinUrl) {
    cta = { label: s.joinCta, url: input.joinUrl };
  }
  if (input.manageUrl && (input.kind === "confirmed" || input.kind === "rescheduled")) {
    afterCtaHtml = `<div dir="${dir}" lang="${locale}"><p>${escapeHtml(s.manageLead)} <a href="${escapeHtml(input.manageUrl)}">${escapeHtml(s.manageCta)}</a></p></div>`;
  }
  return { locale, subject: fill(subject, no), bodyHtml, ...(cta ? { cta } : {}), ...(afterCtaHtml ? { afterCtaHtml } : {}) };
}

// --- Personel e-postalari (EN; kisisel veri YOK) ---------------------------------------------------------------

export interface StaffServiceEmailInput {
  event: "booked" | "cancelled" | "rescheduled";
  /** Yonetici bildirimi mi, atanan koordinatore mi. */
  audience: "admin" | "coordinator";
  consultationNumber: string;
  serviceName: string;
  startsAt: Date;
  durationMin: number;
  coordinatorName: string;
  contactLanguage: string | null;
  needsInterpreter: boolean;
  interpreterLanguage: string | null;
  /** Koordinatorun dili interpreterLanguage ile uyusuyor mu. */
  coordinatorSpeaksInterpreterLanguage?: boolean;
  /** `rescheduled` icin eski baslangic. */
  previousStartsAt?: Date | null;
  consultationId: string;
  frontendUrl: string;
}

export interface StaffServiceEmail {
  subject: string;
  preheader: string;
  title: string;
  bodyHtml: string;
  cta: { label: string; url: string };
}

function staffRow(label: string, value: string): string {
  return `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
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

export function buildStaffServiceEmail(data: StaffServiceEmailInput): StaffServiceEmail {
  const base = data.frontendUrl.replace(/\/$/, "");
  const stamp = `${formatIstanbulStamp(data.startsAt)} (Europe/Istanbul)`;
  const eventTitle =
    data.audience === "coordinator"
      ? data.event === "booked"
        ? "New online consultation assigned to you"
        : data.event === "cancelled"
          ? "Online consultation cancelled"
          : "Online consultation time changed"
      : data.event === "booked"
        ? "New online consultation"
        : data.event === "cancelled"
          ? "Online consultation cancelled"
          : "Online consultation rescheduled";
  const subject = `${eventTitle} ${data.consultationNumber} - ${stamp}`;
  const interpreter = data.needsInterpreter
    ? `yes${data.interpreterLanguage ? ` (${data.interpreterLanguage})` : ""}${data.coordinatorSpeaksInterpreterLanguage ? " - coordinator speaks this language" : data.interpreterLanguage ? " - interpreter needed" : ""}`
    : "no";
  const rows = [
    staffRow("Consultation", data.consultationNumber),
    staffRow("Service", data.serviceName),
    staffRow("Time", stamp),
    staffRow("Duration", `${data.durationMin} min`),
    staffRow("Coordinator", data.coordinatorName),
    staffRow("Contact language", data.contactLanguage ? languageName(data.contactLanguage) : "not specified"),
    staffRow("Interpreter", interpreter),
  ];
  if (data.event === "rescheduled" && data.previousStartsAt) rows.push(staffRow("Previous time", `${formatIstanbulStamp(data.previousStartsAt)} (Europe/Istanbul)`));
  const cta =
    data.audience === "coordinator"
      ? { label: "Open my consultations", url: `${base}/admin/my-consultations` }
      : { label: "Open consultation", url: `${base}/admin/service-desk/consultations/${data.consultationId}` };
  return {
    subject,
    preheader: subject,
    title: eventTitle,
    bodyHtml: `<p>${escapeHtml(eventTitle)}.</p>${rows.join("")}<p style="margin:12px 0 0;">Contact details and the message are only visible in the admin panel after signing in.</p>`,
    cta,
  };
}

/** Yardimci: testlerin ve admin ekraninin kullanabilmesi icin masa saatini yazdirir. */
export function describeSlot(startsAt: Date): string {
  return `${formatWall(startsAt, TURKEY_TIME_ZONE)} (${TURKEY_TIME_ZONE})`;
}
