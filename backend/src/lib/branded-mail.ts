import type { FastifyInstance } from "fastify";
import { env, isProd } from "../config/env";
import { sendMail, type SendMailResult } from "./mail";
import { getLocaleSet } from "./localization";
import { renderBrandedEmail, toBrandLocale, type BrandedEmailInput, type EmailBrandContext } from "./branded-email";
import { parseContactPageContent, localeContent } from "../modules/contact/contact-page";
import { CONTACT_FORM_ID } from "../modules/contact/contact.constants";
import { parseLanguageSupport } from "../modules/telehealth/lib/language-support";

/**
 * Paket AC — kurumsal e-postanın TEK gönderim noktası. Bütün modüller `sendBrandedMail` kullanır;
 * `sendMail` (ham SMTP) yalnızca burada ve `lib/mail.ts` içinde çağrılır (statik tarama testi).
 * Marka bağlamı: site ayarları (ad, logo), görünüm (marka rengi), iletişim sayfası (adres, telefon,
 * e-posta — alıcının dilinde; TR dışı → EN), Paket V destek dilleri ve hukuki sayfalar.
 */
const SETTINGS_ID = "singleton";
const APPEARANCE_ID = "singleton";
const DEFAULT_SITE_NAME = "WM Health Istanbul";
const KVKK_NOTICE = /kvkk|aydınlatma|aydinlatma|privacy notice|data protection/i;
const PRIVACY = /gizlilik|privacy policy|privacy/i;
// Reply-To ve mailto için tek, sade adres (virgül/köşeli parantez/sorgu yok — çoklu alıcı ve `?bcc=` engellenir).
const SINGLE_EMAIL = /^[^\s@,<>"';?]+@[^\s@,<>"';?]+\.[^\s@,<>"';?]+$/;

function absoluteHttpsLogo(url: string | null | undefined): string | null {
  if (!url) return null;
  const absolute = /^https?:\/\//i.test(url) ? url : `${env.PUBLIC_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  // Üretimde yalnızca https (karışık içerik/engelleme yok); geliştirmede http de kabul.
  // SVG/WebP Gmail ve Outlook'ta görünmez → metin başlığa düş.
  if (/\.(svg|webp)(\?|#|$)/i.test(absolute)) return null;
  if (/^https:\/\//i.test(absolute)) return absolute;
  return isProd ? null : absolute;
}

function nativeName(code: string): string {
  try {
    const tag = code === "sr-latn" ? "sr-Latn" : code;
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** Marka bağlamı okunamazsa (DB hatası) e-posta yine gider: logosuz, yalnızca site adı ve otomatik notu. */
function minimalBrandContext(localeCode: string): EmailBrandContext {
  return {
    siteName: DEFAULT_SITE_NAME,
    siteUrl: env.FRONTEND_URL,
    logoUrl: null,
    primaryColor: "#0f766e",
    address: null,
    phone: null,
    infoEmail: null,
    contactUrl: `${env.FRONTEND_URL}/${toBrandLocale(localeCode)}/contact`,
    supportLanguages: null,
    kvkk: null,
    privacy: null,
  };
}

async function safeBrandContext(app: FastifyInstance, localeCode: string): Promise<EmailBrandContext> {
  try {
    return await loadEmailBrandContext(app, localeCode);
  } catch (err) {
    app.log.error({ err }, "E-posta marka bağlamı yüklenemedi — en sade kabukla gönderiliyor.");
    return minimalBrandContext(localeCode);
  }
}

export async function loadEmailBrandContext(app: FastifyInstance, localeCode: string): Promise<EmailBrandContext> {
  const locale = toBrandLocale(localeCode);
  const legalLocale = locale === "tr" ? "tr" : "en";
  const [settings, appearance, contactRow, telehealth, localeSet, legalPages] = await Promise.all([
    app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { siteName: true, logoUrl: true } }),
    app.prisma.siteAppearance.findUnique({ where: { id: APPEARANCE_ID }, select: { primaryColor: true } }).catch(() => null),
    app.prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID }, select: { pageContent: true } }).catch(() => null),
    app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true, enabled: true } }).catch(() => null),
    getLocaleSet(app),
    app.prisma.page.findMany({
      where: { isLegalDocument: true, status: "PUBLISHED", deletedAt: null },
      select: { id: true, title: true, slug: true, translations: true },
      orderBy: { seq: "asc" },
    }),
  ]);
  const defaultCode = localeSet.default.code;
  const content = parseContactPageContent(contactRow?.pageContent);
  const localized = localeContent(content, legalLocale);
  const fallback = localeContent(content, legalLocale === "tr" ? "en" : "tr");
  const support = telehealth?.enabled ? parseLanguageSupport(telehealth.settings) : null;

  // Hukuki sayfa: alıcının dilinde (TR; diğer dillerde EN) başlık ve slug.
  const slugs = legalPages.length
    ? await app.prisma.contentSlug.findMany({ where: { entityType: "PAGE", entityId: { in: legalPages.map((p) => p.id) }, locale: legalLocale }, select: { entityId: true, slug: true } })
    : [];
  const pageLink = (pattern: RegExp, exclude?: string) => {
    const page = legalPages.find((p) => p.id !== exclude && (pattern.test(p.title) || pattern.test(p.slug)));
    if (!page) return null;
    const tr = (page.translations as Record<string, { title?: string }> | null)?.[legalLocale]?.title;
    const slug = legalLocale === defaultCode ? page.slug : (slugs.find((s) => s.entityId === page.id)?.slug ?? page.slug);
    // Çevirisi olmayan başlık boş bırakılır → footer alıcının dilindeki genel etikete düşer.
    return { id: page.id, title: legalLocale === defaultCode ? page.title : (tr ?? ""), url: `${env.FRONTEND_URL}/${legalLocale}/${slug}` };
  };
  // Başlık/slug eşleşmezse ilk yayımlanmış hukuki belgeye düş (hasta e-postası bağlantısız kalmasın).
  const kvkk = pageLink(KVKK_NOTICE) ?? (legalPages[0] ? pageLink(/[\s\S]*/) : null);
  const privacy = pageLink(PRIVACY, kvkk?.id);

  return {
    siteName: settings?.siteName?.trim() || DEFAULT_SITE_NAME,
    siteUrl: env.FRONTEND_URL,
    logoUrl: absoluteHttpsLogo(settings?.logoUrl),
    primaryColor: appearance?.primaryColor ?? "#0f766e",
    address: localized.address || fallback.address || null,
    phone: localized.phone || fallback.phone || null,
    infoEmail: [localized.email, fallback.email].find((e) => !!e && SINGLE_EMAIL.test(e)) ?? null,
    contactUrl: `${env.FRONTEND_URL}/${locale}/contact`,
    supportLanguages: support && support.supportLanguages.length > 0 ? support.supportLanguages.map(nativeName) : null,
    kvkk: kvkk ? { title: kvkk.title, url: kvkk.url } : null,
    privacy: privacy ? { title: privacy.title, url: privacy.url } : null,
  };
}

export interface SendBrandedMailInput extends BrandedEmailInput {
  to: string;
  subject: string;
}

/** Kurumsal kabukla gönderir (HTML + düz metin); Reply-To = iletişim sayfasındaki destek adresi. */
export async function sendBrandedMail(app: FastifyInstance, input: SendBrandedMailInput): Promise<SendMailResult> {
  const ctx = await safeBrandContext(app, input.locale);
  if (input.audience === "patient" && !ctx.kvkk) {
    app.log.warn("Hasta e-postasında KVKK aydınlatma bağlantısı yok — yayımlanmış hukuki sayfa (isLegalDocument) bulunamadı.");
  }
  const { html, text } = renderBrandedEmail(ctx, input);
  return sendMail(app, { to: input.to, subject: input.subject, html, text, ...(ctx.infoEmail ? { replyTo: ctx.infoEmail } : {}) });
}

/** Önizleme/test için: gönderim yapmadan kurumsal HTML + metin. */
export async function renderBrandedPreview(app: FastifyInstance, input: BrandedEmailInput): Promise<{ html: string; text: string }> {
  return renderBrandedEmail(await safeBrandContext(app, input.locale), input);
}

/**
 * Önceden `renderBrandedPreview`/`renderBrandedEmail` ile kurumsal kabukta üretilmiş içeriği gönderir
 * (admin "test gönder" / "kendime test gönder"). Ham HTML için KULLANILMAZ.
 */
export async function sendRenderedTestMail(app: FastifyInstance, input: { to: string; subject: string; html: string; text: string }): Promise<SendMailResult> {
  return sendMail(app, { to: input.to, subject: input.subject, html: input.html, text: input.text });
}
