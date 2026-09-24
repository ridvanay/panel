/**
 * İletişim sayfası (`/contact`) — sabit alanlı form + sayfa içeriği. Mevcut `ContactForm`
 * singleton'ı ve `ContactSubmission` tablosu YENİDEN KULLANILIR (aynı admin listesi, saklama süresi,
 * PII redaksiyonu, bildirim e-postası); admin'in dinamik alan tanımları bu sayfayı ETKİLEMEZ
 * (dinamik alanlı `contact-form` sayfa bloğu olduğu gibi çalışmaya devam eder).
 *
 * Güvenlik (security-agent): honeypot (`website`) + route rate limit (5/dk, gerçek ziyaretçi IP'si —
 * gönderim tarayıcıdan doğrudan `/api`ye yapılır) + HMAC imzalı zaman damgası (3 sn'den hızlı
 * gönderim = SPAM, 24 saatten eski damga = yeniden al). Onay metinleri SUNUCUDA tutulur ve dile
 * göre sunucu tarafından kopyalanır — istemci metin göndermez.
 *
 * KVKK (compliance-agent): yalnızca formdaki alanlar saklanır. "İlgilenilen tedavi" özel nitelikli
 * veri sayılabileceği için İSTEĞE BAĞLIDIR; seçilirse ayrı, varsayılan işaretsiz açık rıza
 * ZORUNLUDUR ve açık rıza metninin kopyası + zamanı gönderimle saklanır. "Henüz emin değilim"
 * sağlık verisi değildir, açık rıza gerektirmez.
 */
import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { jwtPrivateKey } from "../../lib/keys";
import { COUNTRY_CODES, dialCodeFor } from "../../lib/country-codes";
import { ApiError, NotFoundError, ValidationError } from "../../lib/errors";
import { CONTACT_FORM_ID } from "./contact.constants";
import { sendNotificationBestEffort } from "./contact.service";

// ---------------------------------------------------------------------------
// Onay metinleri (compliance-agent onaylı) — gösterilen metin = saklanan metin.
// ---------------------------------------------------------------------------

export const CONTACT_PAGE_LOCALES = ["en", "tr"] as const;
export type ContactPageLocale = (typeof CONTACT_PAGE_LOCALES)[number];

export const CONTACT_PAGE_CONSENT_TEXTS: Record<
  ContactPageLocale,
  { notice: string; explicit: string; privacyLinkLabel: string }
> = {
  en: {
    notice: "I have read the Privacy Notice describing how my personal data will be processed to respond to this enquiry.",
    explicit:
      "I explicitly consent to the processing of the treatment area I selected, which may reveal information about my health, solely to direct and respond to my request. I know I can leave this field blank and withdraw my consent at any time (see Privacy Notice).",
    privacyLinkLabel: "Privacy Notice",
  },
  tr: {
    notice: "Talebimi yanıtlamak amacıyla kişisel verilerimin nasıl işleneceğini açıklayan Aydınlatma Metni'ni okudum.",
    explicit:
      "Seçtiğim tedavi alanının sağlığımla ilgili bilgi içerebileceğini bilerek, yalnızca talebimin yönlendirilmesi ve yanıtlanması amacıyla işlenmesine açıkça rıza veriyorum. Bu alanı boş bırakabileceğimi ve rızamı dilediğim zaman geri alabileceğimi biliyorum (bkz. Aydınlatma Metni).",
    privacyLinkLabel: "Aydınlatma Metni",
  },
};

/** "Henüz emin değilim" — sağlık verisi DEĞİL, açık rıza gerektirmez. */
export const TREATMENT_NOT_SURE = "not_sure";

// ---------------------------------------------------------------------------
// Sayfa içeriği (admin) — `contact_forms.pageContent` JSONB.
// ---------------------------------------------------------------------------

/** Güvenlik: yalnızca Google Haritalar bağlantıları (security-agent). */
const MAP_URL_PATTERN = /^https:\/\/(www\.google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl)(\/|\?|$)/;
const DISPLAY_PHONE_PATTERN = /^\+?[0-9 ()-]{4,30}$/;
const WHATSAPP_PATTERN = /^\+?[0-9 ]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTML_MARKUP = /<\s*[a-z!/?]/i;

const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HTML_MARKUP.test(value), "HTML kullanılamaz; düz metin girin.")
    .default("");

const optionalPattern = (pattern: RegExp, message: string, max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value === "" || pattern.test(value), message)
    .default("");

export const ContactPageHoursRowSchema = z.object({
  label: plain(60),
  value: plain(60),
});

export const ContactPageLocaleContentSchema = z.object({
  title: plain(120),
  intro: plain(300),
  phone: optionalPattern(DISPLAY_PHONE_PATTERN, "Geçerli bir telefon numarası girin (ör. +90 212 000 00 00).", 30),
  whatsapp: optionalPattern(WHATSAPP_PATTERN, "WhatsApp numarasını ülke koduyla girin (ör. +90 555 000 00 00).", 20),
  email: optionalPattern(EMAIL_PATTERN, "Geçerli bir e-posta adresi girin.", 254),
  address: plain(300),
  hours: z.array(ContactPageHoursRowSchema).max(10).default([]),
  responseTime: plain(160),
});
export type ContactPageLocaleContent = z.infer<typeof ContactPageLocaleContentSchema>;

export const ContactPageContentSchema = z.object({
  locales: z
    .object({ en: ContactPageLocaleContentSchema.optional(), tr: ContactPageLocaleContentSchema.optional() })
    .strict()
    .default({}),
  mapImageMediaId: z.string().uuid().nullable().default(null),
  mapUrl: optionalPattern(MAP_URL_PATTERN, "Yalnızca Google Haritalar bağlantısı (https://www.google.com/maps/…, https://maps.app.goo.gl/…) kabul edilir.", 500),
});
export type ContactPageContent = z.infer<typeof ContactPageContentSchema>;

const EMPTY_LOCALE_CONTENT: ContactPageLocaleContent = ContactPageLocaleContentSchema.parse({});

/** DB'deki ham JSON'u güvenle okur — bozuk alanlar boş/varsayılana düşer, ASLA hata fırlatmaz. */
export function parseContactPageContent(raw: unknown): ContactPageContent {
  const parsed = ContactPageContentSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const locales: ContactPageContent["locales"] = {};
  const rawLocales = (record.locales ?? {}) as Record<string, unknown>;
  for (const code of CONTACT_PAGE_LOCALES) {
    const one = ContactPageLocaleContentSchema.safeParse(rawLocales[code] ?? {});
    if (one.success) locales[code] = one.data;
  }
  const media = z.string().uuid().safeParse(record.mapImageMediaId);
  const mapUrl = typeof record.mapUrl === "string" && MAP_URL_PATTERN.test(record.mapUrl) ? record.mapUrl : "";
  return { locales, mapImageMediaId: media.success ? media.data : null, mapUrl };
}

export function localeContent(content: ContactPageContent, locale: ContactPageLocale): ContactPageLocaleContent {
  return content.locales[locale] ?? EMPTY_LOCALE_CONTENT;
}

/** `https://wa.me/<yalnızca rakam>` — ham metin asla `href`e basılmaz (security-agent). */
export function toWhatsAppDigits(value: string): string {
  return value.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// İmzalı zaman damgası — HKDF(JWT imza anahtarı, "contact-form-timestamp").
// ---------------------------------------------------------------------------

export const CONTACT_TOKEN_MIN_AGE_MS = 3_000;
export const CONTACT_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONTACT_TOKEN_CLOCK_SKEW_MS = 60_000;
const CONTACT_TOKEN_VERSION = "v1";

let cachedTokenKey: Buffer | null = null;
function tokenKey(): Buffer {
  if (!cachedTokenKey) {
    cachedTokenKey = Buffer.from(
      crypto.hkdfSync("sha256", Buffer.from(jwtPrivateKey ?? "", "utf8"), Buffer.alloc(0), Buffer.from("contact-form-timestamp", "utf8"), 32)
    );
  }
  return cachedTokenKey;
}

function sign(issuedAt: number): string {
  return crypto.createHmac("sha256", tokenKey()).update(`${CONTACT_TOKEN_VERSION}.${issuedAt}`).digest("base64url");
}

export function issueContactFormToken(now: number = Date.now()): string {
  return `${CONTACT_TOKEN_VERSION}.${now}.${sign(now)}`;
}

export type ContactTokenCheck = "ok" | "too_fast" | "expired" | "invalid";

export function checkContactFormToken(token: string | undefined, now: number = Date.now()): ContactTokenCheck {
  if (typeof token !== "string") return "invalid";
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== CONTACT_TOKEN_VERSION || !/^\d{10,16}$/.test(parts[1]!)) return "invalid";
  const issuedAt = Number(parts[1]);
  const expected = Buffer.from(sign(issuedAt));
  const given = Buffer.from(parts[2]!);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return "invalid";
  if (issuedAt - now > CONTACT_TOKEN_CLOCK_SKEW_MS) return "invalid";
  const age = now - issuedAt;
  if (age > CONTACT_TOKEN_MAX_AGE_MS) return "expired";
  if (age < CONTACT_TOKEN_MIN_AGE_MS) return "too_fast";
  return "ok";
}

export class ContactFormTokenError extends ApiError {
  constructor(reason: "invalid" | "expired") {
    super(
      422,
      "CONTACT_FORM_TOKEN_INVALID",
      reason === "expired" ? "Form süresi doldu. Lütfen tekrar gönderin." : "Form doğrulanamadı. Lütfen tekrar gönderin.",
      { token: [reason] }
    );
  }
}

// ---------------------------------------------------------------------------
// Gönderim
// ---------------------------------------------------------------------------

/**
 * Rota gövdesi GEVŞEK doğrulanır (yalnızca tür + üst boyut): honeypot doluysa bota "başarısız
 * oldum" sinyali verilmeden sahte başarı dönülmelidir — sıkı doğrulama handler'da, honeypot ve
 * zaman damgası kontrolünden SONRA yapılır.
 */
export const ContactPageSubmissionBodySchema = z.object({
  token: z.string().max(200).optional(),
  website: z.string().max(2000).optional(),
  locale: z.string().max(10).optional(),
  fullName: z.string().max(500).optional(),
  email: z.string().max(500).optional(),
  phoneCountry: z.string().max(10).optional(),
  phoneNumber: z.string().max(100).optional(),
  country: z.string().max(10).optional(),
  treatment: z.string().max(200).optional(),
  contactMethod: z.string().max(20).optional(),
  message: z.string().max(10_000).optional(),
  noticeAccepted: z.boolean().optional(),
  explicitConsent: z.boolean().optional(),
});
export type ContactPageSubmissionBody = z.infer<typeof ContactPageSubmissionBodySchema>;

const PHONE_NUMBER_PATTERN = /^[0-9 ()-]{4,20}$/;

/** Sıkı şema — hata anahtarları form alan adlarıdır (istemci alanın altında gösterir). */
export const ContactPageSubmissionSchema = z
  .object({
    locale: z.enum(CONTACT_PAGE_LOCALES),
    fullName: z.string().trim().min(2, "required").max(120, "too_long"),
    email: z.string().trim().max(254, "too_long").regex(EMAIL_PATTERN, "invalid_email"),
    phoneCountry: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || COUNTRY_CODES.has(value), "invalid_country"),
    phoneNumber: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || (PHONE_NUMBER_PATTERN.test(value) && value.replace(/\D/g, "").length >= 4), "invalid_phone"),
    country: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || COUNTRY_CODES.has(value), "invalid_country"),
    treatment: z.string().trim().max(200).optional(),
    contactMethod: z.enum(["email", "phone", "whatsapp"]).default("email"),
    message: z.string().trim().min(1, "required").max(3000, "too_long"),
    noticeAccepted: z.literal(true, { errorMap: () => ({ message: "required" }) }),
    explicitConsent: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.contactMethod !== "email" && !body.phoneNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phoneNumber"], message: "phone_required_for_method" });
    }
    if (body.phoneNumber && !body.phoneCountry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["phoneCountry"], message: "required" });
    }
  });

export interface ContactPageSubmissionMeta {
  ipAddress: string | null;
  userAgent: string | null;
  now?: Date;
}

function flattenIssues(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Sıra (security-agent): (1) form kapalı → 404 · (2) honeypot dolu → sahte başarı + SPAM, e-posta
 * yok · (3) damga geçersiz/süresi dolmuş → 422 `CONTACT_FORM_TOKEN_INVALID` (istemci yeni damga
 * alıp veriyi kaybetmeden tekrar dener) · (4) damga 3 sn'den genç → sahte başarı + SPAM · (5) sıkı
 * doğrulama → 422 alan bazlı · (6) tedavi seçildiyse açık rıza ZORUNLU · (7) kayıt · (8) bildirim.
 */
export async function submitContactPage(
  app: FastifyInstance,
  body: ContactPageSubmissionBody,
  meta: ContactPageSubmissionMeta
): Promise<{ id: string }> {
  const form = await app.prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID } });
  if (!form || !form.isEnabled) throw new NotFoundError("İletişim formu bulunamadı.");
  const now = meta.now ?? new Date();

  const honeypot = typeof body.website === "string" && body.website.trim().length > 0;
  const tokenState = honeypot ? "ok" : checkContactFormToken(body.token, now.getTime());
  if (tokenState === "invalid" || tokenState === "expired") throw new ContactFormTokenError(tokenState);

  if (honeypot || tokenState === "too_fast") {
    const spam = await app.prisma.contactSubmission.create({
      data: {
        formId: form.id,
        name: (body.fullName ?? "").slice(0, 120),
        email: (body.email ?? "").slice(0, 254),
        data: {
          source: "contact_page",
          spam_reason: honeypot ? "honeypot" : "too_fast",
          message: (body.message ?? "").slice(0, 3000),
        } as Prisma.InputJsonValue,
        status: "SPAM",
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    return { id: spam.id };
  }

  const parsed = ContactPageSubmissionSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("Form doğrulaması başarısız.", flattenIssues(parsed.error));
  const input = parsed.data;

  // Tedavi: aktif bir uzmanlık slug'ı ya da "not_sure"; başka her değer reddedilir.
  let treatment: { slug: string; name: string } | null = null;
  if (input.treatment && input.treatment !== TREATMENT_NOT_SURE) {
    const specialty = await app.prisma.specialty.findFirst({
      where: { slug: input.treatment, isActive: true },
      select: { slug: true, name: true },
    });
    if (!specialty) throw new ValidationError("Form doğrulaması başarısız.", { treatment: ["invalid_treatment"] });
    if (input.explicitConsent !== true) {
      throw new ValidationError("Form doğrulaması başarısız.", { explicitConsent: ["required"] });
    }
    treatment = specialty;
  }

  const texts = CONTACT_PAGE_CONSENT_TEXTS[input.locale];
  const phone = input.phoneNumber ? `+${dialCodeFor(input.phoneCountry!) ?? ""} ${input.phoneNumber}`.trim() : "";

  // Yalnızca formdaki alanlar (+ dil ve açık rıza kanıtı) saklanır — KVKK veri minimizasyonu.
  const data: Record<string, string> = {
    source: "contact_page",
    locale: input.locale,
    name: input.fullName,
    email: input.email,
    message: input.message,
    contact_method: input.contactMethod,
  };
  if (phone) data.phone = phone;
  if (input.phoneCountry && phone) data.phone_country = input.phoneCountry;
  if (input.country) data.country = input.country;
  if (input.treatment === TREATMENT_NOT_SURE) data.treatment = TREATMENT_NOT_SURE;
  if (treatment) {
    data.treatment = treatment.slug;
    data.treatment_name = treatment.name;
    data.explicit_consent_at = now.toISOString();
    data.explicit_consent_text = texts.explicit;
  }

  const submission = await app.prisma.contactSubmission.create({
    data: {
      formId: form.id,
      name: input.fullName,
      email: input.email,
      data: data as Prisma.InputJsonValue,
      status: "NEW",
      consentAt: now,
      consentTextSnapshot: texts.notice,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });

  await sendNotificationBestEffort(app, form, submission);
  return { id: submission.id };
}
