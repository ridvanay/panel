/**
 * Paket AC — bütün e-postalar için ORTAK kurumsal kabuk (SAF: DB/IO yok; marka bağlamı dışarıdan).
 *
 * - Başlık: site logosu (mutlak https, alt metinli) ya da metin olarak site adı; marka renginde ince üst şerit.
 * - Gövde: tablo tabanlı, en fazla 600 px, satır içi CSS (Gmail/Outlook/Apple Mail); `dir="rtl"` (Arapça).
 * - Gizli önizleme metni (preheader), bulletproof birincil düğme.
 * - Footer (9 dil): kurum adı + adres/telefon (varsa), iletişim (e-posta + iletişim sayfası), "kendi dilinizde
 *   ücretsiz destek" (ayar açıksa), KVKK aydınlatma + gizlilik bağlantıları (alıcının dilinde; TR/EN dışı → EN),
 *   "otomatik gönderilmiştir" notu; hasta e-postalarında ayrıca "Acil durumda 112".
 *   Personel (admin/doktor/tercüman) e-postalarında sade footer.
 * - İşlem e-postası olduğundan abonelik iptali bağlantısı YOKTUR (pazarlama değil — rapora yazıldı).
 * - Her e-postanın `text/plain` sürümü de üretilir.
 */
export const BRAND_LOCALES = ["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const;
export type BrandLocale = (typeof BRAND_LOCALES)[number];

/** patient: hasta/ziyaretçi (112 notu); user: hesap e-postaları (şifre vb.); staff: admin/doktor/tercüman (sade). */
export type EmailAudience = "patient" | "user" | "staff";

export function toBrandLocale(code: string | null | undefined): BrandLocale {
  const normalized = (code ?? "").toLowerCase();
  return (BRAND_LOCALES as readonly string[]).includes(normalized) ? (normalized as BrandLocale) : "en";
}

export interface EmailBrandContext {
  siteName: string;
  siteUrl: string;
  /** Mutlak https logo adresi; yoksa metin başlık. */
  logoUrl: string | null;
  primaryColor: string;
  address: string | null;
  phone: string | null;
  infoEmail: string | null;
  contactUrl: string;
  /** Paket V destek dilleri (yerel adlarıyla); ayar kapalıysa `null`. */
  supportLanguages: string[] | null;
  kvkk: { title: string; url: string } | null;
  privacy: { title: string; url: string } | null;
}

export interface BrandedEmailInput {
  locale: string;
  audience: EmailAudience;
  /** Gelen kutusunda konu yanında görünen gizli metin. */
  preheader?: string;
  title?: string;
  /** Güvenli (escape'lenmiş / sunucuda üretilmiş) gövde HTML'i. */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /**
   * Gövde metninin dili (yön/hizalama için). Admin şablonları tek dilde yazılır (site varsayılanı);
   * footer alıcının dilinde olsa bile Türkçe gövde RTL'ye çevrilmez. Verilmezse `locale`.
   */
  bodyLocale?: string;
}

interface FooterStrings {
  contact: string;
  support: string;
  automated: string;
  emergency: string;
  staffNote: string;
  kvkk: string;
  privacy: string;
}

const FOOTER: Record<BrandLocale, FooterStrings> = {
  en: {
    contact: "Contact us",
    support: "Free support in your language: {languages}",
    automated: "This email was sent automatically.",
    emergency: "In an emergency, call 112 (or your local emergency number).",
    staffNote: "Internal notification — for authorised staff only.",
    kvkk: "Privacy notice",
    privacy: "Privacy policy",
  },
  tr: {
    contact: "Bize ulaşın",
    support: "Kendi dilinizde ücretsiz destek: {languages}",
    automated: "Bu e-posta otomatik olarak gönderilmiştir.",
    emergency: "Acil durumda 112'yi (ya da bulunduğunuz ülkenin acil numarasını) arayın.",
    staffNote: "Kurum içi bildirim — yalnızca yetkili personel içindir.",
    kvkk: "KVKK aydınlatma metni",
    privacy: "Gizlilik politikası",
  },
  de: {
    contact: "Kontakt",
    support: "Kostenloser Support in Ihrer Sprache: {languages}",
    automated: "Diese E-Mail wurde automatisch versendet.",
    emergency: "Im Notfall wählen Sie 112 (oder die Notrufnummer Ihres Landes).",
    staffNote: "Interne Benachrichtigung – nur für befugtes Personal.",
    kvkk: "Datenschutzhinweise",
    privacy: "Datenschutzerklärung",
  },
  es: {
    contact: "Contacto",
    support: "Atención gratuita en su idioma: {languages}",
    automated: "Este correo se ha enviado automáticamente.",
    emergency: "En caso de emergencia, llame al 112 (o al número de emergencias de su país).",
    staffNote: "Notificación interna: solo para personal autorizado.",
    kvkk: "Aviso de privacidad",
    privacy: "Política de privacidad",
  },
  fr: {
    contact: "Nous contacter",
    support: "Assistance gratuite dans votre langue : {languages}",
    automated: "Cet e-mail a été envoyé automatiquement.",
    emergency: "En cas d’urgence, appelez le 112 (ou le numéro d’urgence de votre pays).",
    staffNote: "Notification interne — réservée au personnel autorisé.",
    kvkk: "Notice d’information",
    privacy: "Politique de confidentialité",
  },
  ar: {
    contact: "تواصل معنا",
    support: "دعم مجاني بلغتك: {languages}",
    automated: "تم إرسال هذا البريد تلقائيا.",
    emergency: "في حالة الطوارئ اتصل بالرقم 112 (أو رقم الطوارئ في بلدك).",
    staffNote: "إشعار داخلي — مخصص للموظفين المصرح لهم فقط.",
    kvkk: "إشعار الخصوصية",
    privacy: "سياسة الخصوصية",
  },
  ru: {
    contact: "Связаться с нами",
    support: "Бесплатная поддержка на вашем языке: {languages}",
    automated: "Это письмо отправлено автоматически.",
    emergency: "В экстренной ситуации звоните 112 (или по номеру экстренной службы вашей страны).",
    staffNote: "Внутреннее уведомление — только для уполномоченных сотрудников.",
    kvkk: "Уведомление о конфиденциальности",
    privacy: "Политика конфиденциальности",
  },
  ro: {
    contact: "Contactați-ne",
    support: "Asistență gratuită în limba dumneavoastră: {languages}",
    automated: "Acest e-mail a fost trimis automat.",
    emergency: "În caz de urgență, sunați la 112 (sau la numărul de urgență din țara dumneavoastră).",
    staffNote: "Notificare internă — doar pentru personalul autorizat.",
    kvkk: "Notă de informare",
    privacy: "Politica de confidențialitate",
  },
  "sr-latn": {
    contact: "Kontaktirajte nas",
    support: "Besplatna podrška na vašem jeziku: {languages}",
    automated: "Ova poruka je poslata automatski.",
    emergency: "U hitnom slučaju pozovite 112 (ili broj hitne službe u svojoj zemlji).",
    staffNote: "Interno obaveštenje — samo za ovlašćeno osoblje.",
    kvkk: "Obaveštenje o privatnosti",
    privacy: "Politika privatnosti",
  },
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = "Arial,Helvetica,sans-serif";

function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Bulletproof düğme: tablo hücresi arka planı + bağlantı dolgusu (Outlook dahil). */
export function renderEmailButton(label: string, url: string, color: string): string {
  const href = safeUrl(url);
  if (!href) return "";
  if (!HEX.test(color)) color = "#0f766e";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center" bgcolor="${color}" style="padding:12px 24px;border-radius:6px;background-color:${color};"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;font-family:${FONT};font-size:15px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`;
}

function renderFooter(ctx: EmailBrandContext, locale: BrandLocale, audience: EmailAudience): string {
  const t = FOOTER[locale];
  const line = (html: string) => `<p style="margin:0 0 6px;">${html}</p>`;
  const link = (title: string, url: string) => `<a href="${escapeHtml(url)}" style="color:#6b7280;text-decoration:underline;">${escapeHtml(title)}</a>`;
  const parts: string[] = [line(`<strong style="color:#374151;">${escapeHtml(ctx.siteName)}</strong>`)];
  if (audience === "staff") {
    parts.push(line(escapeHtml(t.staffNote)), line(escapeHtml(t.automated)));
  } else {
    if (ctx.address) parts.push(line(escapeHtml(ctx.address)));
    const contact = [ctx.phone ? escapeHtml(ctx.phone) : null, ctx.infoEmail ? link(ctx.infoEmail, `mailto:${ctx.infoEmail}`) : null, link(t.contact, ctx.contactUrl)].filter(Boolean);
    parts.push(line(contact.join(" &middot; ")));
    if (ctx.supportLanguages && ctx.supportLanguages.length > 0) parts.push(line(escapeHtml(t.support.replace("{languages}", ctx.supportLanguages.join(", ")))));
    // Sayfa TR/EN yayımlanır: TR ve EN alıcıda sayfanın kendi başlığı, diğer dillerde alıcının dilinde etiket (bağlantı EN sayfaya).
    const pageTitle = (title: string, fallback: string) => ((locale === "tr" || locale === "en") && title ? title : fallback);
    const legal = [
      ctx.kvkk ? link(pageTitle(ctx.kvkk.title, t.kvkk), ctx.kvkk.url) : null,
      ctx.privacy ? link(pageTitle(ctx.privacy.title, t.privacy), ctx.privacy.url) : null,
    ].filter(Boolean);
    if (legal.length > 0) parts.push(line(legal.join(" &middot; ")));
    if (audience === "patient") parts.push(line(`<strong style="color:#b91c1c;">${escapeHtml(t.emergency)}</strong>`));
    parts.push(line(escapeHtml(t.automated)));
  }
  return parts.join("");
}

/** HTML → okunur düz metin (spam puanı ve metin istemcileri için). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<div[^>]*display:none[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      const url = href.replace(/^mailto:/, "");
      return label && label !== url ? `${label} (${url})` : url;
    })
    .replace(/<(br|\/p|\/tr|\/h[1-6]|\/li|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderBrandedEmail(ctx: EmailBrandContext, input: BrandedEmailInput): { html: string; text: string } {
  const locale = toBrandLocale(input.locale);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const align = dir === "rtl" ? "right" : "left";
  const bodyDir = input.bodyLocale ? (toBrandLocale(input.bodyLocale) === "ar" ? "rtl" : "ltr") : dir;
  const bodyAlign = bodyDir === "rtl" ? "right" : "left";
  const color = HEX.test(ctx.primaryColor) ? ctx.primaryColor : "#0f766e";
  const logo = safeUrl(ctx.logoUrl);
  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(ctx.siteName)}" height="40" style="display:block;height:40px;width:auto;max-width:220px;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-family:${FONT};font-size:20px;font-weight:bold;color:#111827;">${escapeHtml(ctx.siteName)}</span>`;
  const title = input.title ? `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;color:#111827;">${escapeHtml(input.title)}</h1>` : "";
  const cta = input.cta ? renderEmailButton(input.cta.label, input.cta.url, color) : "";
  const preheader = input.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</div>`
    : "";

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /><title>${escapeHtml(input.title ?? ctx.siteName)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="height:4px;line-height:4px;font-size:0;background-color:${color};" bgcolor="${color}">&nbsp;</td></tr>
      <tr><td align="${align}" style="padding:24px 32px 8px;">${header}</td></tr>
      <tr><td dir="${bodyDir}" align="${bodyAlign}" style="padding:16px 32px 24px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1f2937;text-align:${bodyAlign};">${title}${input.bodyHtml}${cta}</td></tr>
      <tr><td dir="${dir}" align="${align}" style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b7280;text-align:${align};">${renderFooter(ctx, locale, input.audience)}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = htmlToText(
    [input.title ? `<p>${escapeHtml(input.title)}</p>` : "", input.bodyHtml, input.cta && safeUrl(input.cta.url) ? `<p><a href="${escapeHtml(input.cta.url)}">${escapeHtml(input.cta.label)}</a></p>` : "", `<p>----</p>`, renderFooter(ctx, locale, input.audience)].join("")
  );
  return { html, text };
}
