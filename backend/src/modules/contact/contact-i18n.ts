/**
 * Paket U (B1, 2026-10-28) — iletişim formu ve `/contact` sayfası onay metinleri ile formun
 * varsayılan görünen metinleri, 9 site dilinde. Onay metinleri SUNUCUDA tutulur: gösterilen metin =
 * gönderimle saklanan metin (`consentTextSnapshot`, `explicit_consent_text`) — istemci metin göndermez.
 *
 * ÖNEMLİ: `privacyLinkLabel` her cümlede AYNEN geçmelidir (istemci o parçayı yasal sayfa bağlantısına
 * çevirir). Yeni dillerin onay metinleri canlıya almadan önce hukuk/insan kontrolünden geçmelidir
 * (rapordaki liste). Kanonik/onaylı metinler: `en` ve `tr` (değişmedi).
 */
import { z } from "zod";

export const CONTACT_LOCALES = ["en", "tr", "es", "de", "ar", "ru", "ro", "fr", "sr-latn"] as const;
export type ContactLocale = (typeof CONTACT_LOCALES)[number];

/** Bilinmeyen/boş dil → `en` (sitede sözlüğü olmayan dil de EN'e düşer). */
export function resolveContactLocale(value: unknown): ContactLocale {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (CONTACT_LOCALES as readonly string[]).includes(code) ? (code as ContactLocale) : "en";
}

export interface ContactConsentTexts {
  /** `/contact` sayfası — aydınlatma onayı. */
  notice: string;
  /** `/contact` sayfası — tedavi alanı seçilirse açık rıza. */
  explicit: string;
  /** Sayfa-oluşturucu iletişim formu bloğu — aydınlatma onayı. */
  formConsent: string;
  privacyLinkLabel: string;
}

export const CONTACT_CONSENT_TEXTS: Record<ContactLocale, ContactConsentTexts> = {
  en: {
    notice: "I have read the Privacy Notice describing how my personal data will be processed to respond to this enquiry.",
    explicit:
      "I explicitly consent to the processing of the treatment area I selected, which may reveal information about my health, solely to direct and respond to my request. I know I can leave this field blank and withdraw my consent at any time (see Privacy Notice).",
    formConsent: "I have read and accept the Privacy Notice.",
    privacyLinkLabel: "Privacy Notice",
  },
  tr: {
    notice: "Talebimi yanıtlamak amacıyla kişisel verilerimin nasıl işleneceğini açıklayan Aydınlatma Metni'ni okudum.",
    explicit:
      "Seçtiğim tedavi alanının sağlığımla ilgili bilgi içerebileceğini bilerek, yalnızca talebimin yönlendirilmesi ve yanıtlanması amacıyla işlenmesine açıkça rıza veriyorum. Bu alanı boş bırakabileceğimi ve rızamı dilediğim zaman geri alabileceğimi biliyorum (bkz. Aydınlatma Metni).",
    formConsent: "Aydınlatma Metni'ni okudum, onaylıyorum.",
    privacyLinkLabel: "Aydınlatma Metni",
  },
  es: {
    notice: "He leído el Aviso de Privacidad, que explica cómo se tratarán mis datos personales para responder a esta consulta.",
    explicit:
      "Consiento expresamente el tratamiento del área de tratamiento que he seleccionado, que puede revelar información sobre mi salud, únicamente para dirigir y responder a mi solicitud. Sé que puedo dejar este campo en blanco y retirar mi consentimiento en cualquier momento (véase el Aviso de Privacidad).",
    formConsent: "He leído y acepto el Aviso de Privacidad.",
    privacyLinkLabel: "Aviso de Privacidad",
  },
  de: {
    notice: "Ich habe den Datenschutzhinweis gelesen, der erläutert, wie meine personenbezogenen Daten zur Beantwortung dieser Anfrage verarbeitet werden.",
    explicit:
      "Ich willige ausdrücklich in die Verarbeitung des von mir gewählten Behandlungsbereichs ein, der Rückschlüsse auf meine Gesundheit zulassen kann – ausschließlich zur Weiterleitung und Beantwortung meiner Anfrage. Mir ist bekannt, dass ich dieses Feld leer lassen und meine Einwilligung jederzeit widerrufen kann (siehe Datenschutzhinweis).",
    formConsent: "Ich habe den Datenschutzhinweis gelesen und akzeptiere ihn.",
    privacyLinkLabel: "Datenschutzhinweis",
  },
  ar: {
    notice: "لقد قرأت إشعار الخصوصية الذي يوضح كيفية معالجة بياناتي الشخصية للرد على هذا الاستفسار.",
    explicit:
      "أوافق صراحةً على معالجة مجال العلاج الذي اخترته، والذي قد يكشف معلومات عن صحتي، لغرض توجيه طلبي والرد عليه فقط. وأعلم أنه يمكنني ترك هذا الحقل فارغًا وسحب موافقتي في أي وقت (راجع إشعار الخصوصية).",
    formConsent: "لقد قرأت إشعار الخصوصية وأوافق عليه.",
    privacyLinkLabel: "إشعار الخصوصية",
  },
  ru: {
    notice:
      "Я ознакомился(-ась) с документом «Уведомление о конфиденциальности», в котором описано, как будут обрабатываться мои персональные данные для ответа на этот запрос.",
    explicit:
      "Я даю явное согласие на обработку выбранной мной области лечения, которая может раскрывать сведения о моём здоровье, исключительно для направления моего запроса и ответа на него. Мне известно, что я могу оставить это поле пустым и в любой момент отозвать своё согласие (см. «Уведомление о конфиденциальности»).",
    formConsent: "Я ознакомился(-ась) с документом «Уведомление о конфиденциальности» и принимаю его.",
    privacyLinkLabel: "Уведомление о конфиденциальности",
  },
  ro: {
    notice:
      "Am citit Nota de informare privind confidențialitatea, care descrie modul în care vor fi prelucrate datele mele cu caracter personal pentru a răspunde acestei solicitări.",
    explicit:
      "Îmi exprim consimțământul explicit pentru prelucrarea domeniului de tratament pe care l-am selectat, care poate dezvălui informații despre sănătatea mea, exclusiv în scopul direcționării și soluționării solicitării mele. Știu că pot lăsa acest câmp necompletat și că îmi pot retrage consimțământul în orice moment (a se vedea Nota de informare privind confidențialitatea).",
    formConsent: "Am citit și accept Nota de informare privind confidențialitatea.",
    privacyLinkLabel: "Nota de informare privind confidențialitatea",
  },
  fr: {
    notice:
      "J’ai lu la Notice d’information sur la protection des données, qui explique comment mes données personnelles seront traitées pour répondre à cette demande.",
    explicit:
      "Je consens expressément au traitement du domaine de soins que j’ai sélectionné, qui peut révéler des informations sur ma santé, uniquement afin d’orienter ma demande et d’y répondre. Je sais que je peux laisser ce champ vide et retirer mon consentement à tout moment (voir la Notice d’information sur la protection des données).",
    formConsent: "J’ai lu et j’accepte la Notice d’information sur la protection des données.",
    privacyLinkLabel: "Notice d’information sur la protection des données",
  },
  "sr-latn": {
    notice: "Pročitao/la sam Obaveštenje o privatnosti u kojem je opisano kako će se moji podaci o ličnosti obrađivati radi odgovora na ovaj upit.",
    explicit:
      "Izričito pristajem na obradu oblasti lečenja koju sam izabrao/la, a koja može otkriti podatke o mom zdravlju, isključivo radi usmeravanja mog zahteva i odgovora na njega. Znam da ovo polje mogu ostaviti prazno i da svoj pristanak mogu povući u bilo kom trenutku (videti Obaveštenje o privatnosti).",
    formConsent: "Pročitao/la sam Obaveštenje o privatnosti i prihvatam ga.",
    privacyLinkLabel: "Obaveštenje o privatnosti",
  },
};

/** Form bloğunun varsayılan metinleri — çevirisi girilmemiş dilde admin'in (EN) metni yerine bunlar görünür. */
export interface ContactFormDefaults {
  title: string;
  submitLabel: string;
  successMessage: string;
  /** Sistem alanları (`name`, `email`, `message`) — `isSystem` alanların varsayılan etiketi. */
  fieldLabels: Record<"name" | "email" | "message", string>;
}

export const CONTACT_FORM_DEFAULTS: Record<ContactLocale, ContactFormDefaults> = {
  en: { title: "Contact Us", submitLabel: "Submit", successMessage: "Your message has been received. We will get back to you as soon as possible.", fieldLabels: { name: "Full Name", email: "E-mail", message: "Message" } },
  tr: { title: "İletişim", submitLabel: "Gönder", successMessage: "Mesajınız alındı. En kısa sürede dönüş yapacağız.", fieldLabels: { name: "Ad Soyad", email: "E-posta", message: "Mesaj" } },
  es: { title: "Contacto", submitLabel: "Enviar", successMessage: "Hemos recibido su mensaje. Le responderemos lo antes posible.", fieldLabels: { name: "Nombre completo", email: "Correo electrónico", message: "Mensaje" } },
  de: { title: "Kontakt", submitLabel: "Senden", successMessage: "Ihre Nachricht ist eingegangen. Wir melden uns so bald wie möglich.", fieldLabels: { name: "Vollständiger Name", email: "E-Mail", message: "Nachricht" } },
  ar: { title: "اتصل بنا", submitLabel: "إرسال", successMessage: "تم استلام رسالتك. سنتواصل معك في أقرب وقت ممكن.", fieldLabels: { name: "الاسم الكامل", email: "البريد الإلكتروني", message: "الرسالة" } },
  ru: { title: "Связаться с нами", submitLabel: "Отправить", successMessage: "Ваше сообщение получено. Мы свяжемся с вами в ближайшее время.", fieldLabels: { name: "Полное имя", email: "Эл. почта", message: "Сообщение" } },
  ro: { title: "Contactați-ne", submitLabel: "Trimiteți", successMessage: "Mesajul dumneavoastră a fost primit. Vă vom răspunde cât mai curând posibil.", fieldLabels: { name: "Nume complet", email: "E-mail", message: "Mesaj" } },
  fr: { title: "Contactez-nous", submitLabel: "Envoyer", successMessage: "Votre message a bien été reçu. Nous vous répondrons dans les meilleurs délais.", fieldLabels: { name: "Nom complet", email: "E-mail", message: "Message" } },
  "sr-latn": { title: "Kontaktirajte nas", submitLabel: "Pošalji", successMessage: "Vaša poruka je primljena. Odgovorićemo Vam u najkraćem mogućem roku.", fieldLabels: { name: "Ime i prezime", email: "E-pošta", message: "Poruka" } },
};

/* ------------------------------------------------------------------ */
/* Form çevirileri — `contact_forms.pageContent.formTranslations.<dil>` */
/* (migration yok; admin `/contact` sayfa içeriği PUT'u bu anahtarı korur) */
/* ------------------------------------------------------------------ */

const HTML_MARKUP = /<\s*[a-z!/?]/i;
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !HTML_MARKUP.test(value), "HTML kullanılamaz.");

export const ContactFormFieldTranslationSchema = z
  .object({
    label: text(100).optional(),
    placeholder: text(200).optional(),
    helpText: text(300).optional(),
    /** SELECT seçenekleri: değer → çevrilmiş etiket. Değerler (gönderilen veri) değişmez. */
    options: z.record(z.string().max(100), text(100)).optional(),
  })
  .strict();

export const ContactFormTranslationSchema = z
  .object({
    title: text(200).optional(),
    description: text(1000).optional(),
    submitLabel: text(60).optional(),
    successMessage: text(500).optional(),
    /** Onay cümlesinden ÖNCE gösterilen admin ön metni (`ContactForm.consentText`) çevirisi. */
    consentText: text(2000).optional(),
    fields: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), ContactFormFieldTranslationSchema).optional(),
  })
  .strict();
export type ContactFormTranslation = z.infer<typeof ContactFormTranslationSchema>;

export const FORM_TRANSLATIONS_KEY = "formTranslations";

/** `pageContent` ham JSON'undan form çevirileri — bozuk dil kaydı yok sayılır, ASLA hata fırlatmaz. */
export function readFormTranslations(pageContent: unknown): Partial<Record<ContactLocale, ContactFormTranslation>> {
  const raw = pageContent && typeof pageContent === "object" && !Array.isArray(pageContent) ? (pageContent as Record<string, unknown>)[FORM_TRANSLATIONS_KEY] : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<ContactLocale, ContactFormTranslation>> = {};
  for (const locale of CONTACT_LOCALES) {
    if (locale === "en") continue; // EN kanoniktir; çevirisi tutulmaz.
    const parsed = ContactFormTranslationSchema.safeParse((raw as Record<string, unknown>)[locale]);
    if (parsed.success) out[locale] = parsed.data;
  }
  return out;
}

interface FormFieldLike {
  key: string;
  label: string;
  placeholder: string | null;
  helpText: string | null;
  isSystem: boolean;
  options: unknown;
}

interface FormLike {
  title: string;
  description: string | null;
  submitLabel: string;
  successMessage: string;
  consentText: string;
  pageContent: unknown;
}

export interface LocalizedContactForm<F> {
  locale: ContactLocale;
  title: string;
  description: string | null;
  submitLabel: string;
  successMessage: string;
  /** Admin ön metni (çevirisi; EN'de kanonik). Boş olabilir. */
  consentText: string;
  consentSentence: string;
  privacyLinkLabel: string;
  fields: F[];
}

function optionLabels(options: unknown, translated: Record<string, string> | undefined): { value: string; label: string }[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((o): o is { value: string; label: string } => !!o && typeof o === "object" && typeof (o as { value?: unknown }).value === "string")
    .map((o) => ({ value: o.value, label: translated?.[o.value] ?? o.label }));
}

/**
 * Görünen metinler: çeviri → (EN ise admin'in kanonik metni) → dilin varsayılanı (başlık, düğme,
 * başarı mesajı, sistem alanı etiketleri) → kanonik. Çevirisi olmayan açıklama/ön metin/ipucu yeni
 * dillerde GÖSTERİLMEZ (EN kalıntısı olmasın).
 */
export function localizeContactForm<F extends FormFieldLike>(form: FormLike, fields: F[], rawLocale: unknown): LocalizedContactForm<F> {
  const locale = resolveContactLocale(rawLocale);
  const consent = CONTACT_CONSENT_TEXTS[locale];
  if (locale === "en") {
    return {
      locale,
      title: form.title,
      description: form.description,
      submitLabel: form.submitLabel,
      successMessage: form.successMessage,
      consentText: form.consentText,
      consentSentence: consent.formConsent,
      privacyLinkLabel: consent.privacyLinkLabel,
      fields: fields.map((f) => ({ ...f, options: optionLabels(f.options, undefined) })),
    };
  }
  const t = readFormTranslations(form.pageContent)[locale] ?? {};
  const defaults = CONTACT_FORM_DEFAULTS[locale];
  return {
    locale,
    title: t.title ?? defaults.title,
    description: t.description ?? null,
    submitLabel: t.submitLabel ?? defaults.submitLabel,
    successMessage: t.successMessage ?? defaults.successMessage,
    consentText: t.consentText ?? "",
    consentSentence: consent.formConsent,
    privacyLinkLabel: consent.privacyLinkLabel,
    fields: fields.map((f) => {
      const ft = t.fields?.[f.key];
      const systemLabel = f.isSystem ? defaults.fieldLabels[f.key as keyof ContactFormDefaults["fieldLabels"]] : undefined;
      return {
        ...f,
        label: ft?.label ?? systemLabel ?? f.label,
        placeholder: ft?.placeholder ?? null,
        helpText: ft?.helpText ?? null,
        options: optionLabels(f.options, ft?.options),
      };
    }),
  };
}

/** Gönderimle saklanan onay kanıtı = ziyaretçinin gördüğü metin (ön metin + onay cümlesi). */
export function consentSnapshotFor(localized: Pick<LocalizedContactForm<unknown>, "consentText" | "consentSentence">): string {
  return [localized.consentText.trim(), localized.consentSentence].filter(Boolean).join(" ");
}
