import type { DestinationHighlight, HealthPackage, Media, Prisma } from "@prisma/client";
import { z } from "zod";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { absolutizeMediaUrl } from "../../mappers";
import { parseVariants } from "../../lib/image-pipeline";

/**
 * Paket X — sağlık paketleri, "Top destinations" ve iletişim kanalları (WhatsApp/koordinatör).
 *
 * KURALLAR: paketler satın alınmaz/sepete eklenmez (checkout/Stripe yok); fiyatlar yalnızca bilgi amaçlıdır ve
 * `showPrice`/`showPrices` (varsayılan kapalı) açıkken gösterilir. Uydurma veri yok: rakamları yönetici girer.
 */
export const PACKAGE_CATEGORIES = ["check-up", "aesthetic", "wellness", "longevity", "dental", "women", "men", "other"] as const;
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

const localeKey = z.string().regex(LOCALE_CODE_PATTERN);
const noHtml = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/<[a-z!/]/i.test(v), "HTML kullanılamaz.");
const SLUG = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Yalnızca küçük harf, rakam ve tire.");
const CURRENCY = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

// --- paket ---------------------------------------------------------------------------------------
export const PackageTextSchema = z
  .object({
    title: noHtml(160).pipe(z.string().min(1)),
    summary: noHtml(600).default(""),
    includes: z.array(noHtml(200)).max(30).default([]),
    notIncluded: z.array(noHtml(200)).max(30).default([]),
    duration: noHtml(120).default(""),
    idealFor: noHtml(300).default(""),
    faq: z.array(z.object({ question: noHtml(200).pipe(z.string().min(1)), answer: noHtml(2000).pipe(z.string().min(1)) }).strict()).max(20).default([]),
  })
  .strict();
export type PackageText = z.infer<typeof PackageTextSchema>;

export const PackageBodySchema = z
  .object({
    slug: SLUG,
    category: z.enum(PACKAGE_CATEGORIES),
    coverMediaId: z.string().uuid().nullish(),
    translations: z
      .record(localeKey, PackageTextSchema)
      .refine((t) => Object.keys(t).length >= 1, "En az bir dilde başlık gerekli.")
      .refine((t) => Object.keys(t).length <= 20, "En çok 20 dil."),
    priceFrom: z.number().min(0).max(10_000_000).nullish(),
    currency: CURRENCY.default("EUR"),
    showPrice: z.boolean().default(false),
    relatedSpecialtyIds: z.array(z.string().uuid()).max(10).default([]),
    relatedDoctorIds: z.array(z.string().uuid()).max(12).default([]),
    isActive: z.boolean().default(false),
    isFeatured: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.showPrice && (b.priceFrom === null || b.priceFrom === undefined)) {
      ctx.addIssue({ code: "custom", path: ["priceFrom"], message: "Fiyat gösterilecekse başlangıç fiyatı girilmeli." });
    }
  });
export type PackageBody = z.infer<typeof PackageBodySchema>;

// --- destinasyon ---------------------------------------------------------------------------------
export const DestinationTextSchema = z
  .object({
    title: noHtml(160).pipe(z.string().min(1)),
    summary: noHtml(600).default(""),
    highlights: z.array(noHtml(120)).max(10).default([]),
  })
  .strict();

export const TopTreatmentSchema = z
  .object({
    label: z.record(localeKey, noHtml(120).pipe(z.string().min(1))).refine((l) => Object.keys(l).length >= 1, "En az bir dilde ad."),
    priceFrom: z.number().min(0).max(10_000_000).nullable(),
    currency: CURRENCY.default("EUR"),
  })
  .strict();

export const DestinationBodySchema = z
  .object({
    slug: SLUG,
    city: noHtml(80).pipe(z.string().min(1)),
    coverMediaId: z.string().uuid().nullish(),
    translations: z
      .record(localeKey, DestinationTextSchema)
      .refine((t) => Object.keys(t).length >= 1, "En az bir dilde başlık gerekli.")
      .refine((t) => Object.keys(t).length <= 20, "En çok 20 dil."),
    topTreatments: z.array(TopTreatmentSchema).max(3).default([]),
    patientCountLastYear: z.number().int().min(0).max(10_000_000).nullish(),
    dataPeriodLabel: noHtml(60).nullish(),
    showPrices: z.boolean().default(false),
    isActive: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export type DestinationBody = z.infer<typeof DestinationBodySchema>;

// --- iletişim kanalları (telehealth ayarı `contactChannels`) -------------------------------------
const E164 = z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/, "Numarayı uluslararası biçimde girin (ör. +905550000000).");
export const ContactChannelsSettingsSchema = z
  .object({
    /** WhatsApp numarası henüz yok: varsayılan kapalı; numara girilip açılmadan düğmeler HİÇ görünmez. */
    whatsappEnabled: z.boolean(),
    whatsappNumber: E164.nullable(),
    /** Paket taleplerinin bildirileceği koordinatör adresi (boşsa CRM bildirim adresi). */
    coordinatorEmail: z.string().trim().toLowerCase().email().max(320).nullable(),
    /** Dil başına hazır WhatsApp mesajı; `{package}` yerine paket ya da sayfa adı gelir. Kişisel/sağlık verisi yok. */
    whatsappMessages: z.record(localeKey, noHtml(300)),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.whatsappEnabled && !s.whatsappNumber) ctx.addIssue({ code: "custom", path: ["whatsappNumber"], message: "WhatsApp'ı açmak için numara girin." });
    for (const [code, text] of Object.entries(s.whatsappMessages)) {
      if (/\{(?!package\})[^}]*\}/.test(text)) ctx.addIssue({ code: "custom", path: ["whatsappMessages", code], message: "Yalnızca {package} yer tutucusu kullanılabilir." });
    }
  });
export type ContactChannelsSettings = z.infer<typeof ContactChannelsSettingsSchema>;

export const DEFAULT_WHATSAPP_MESSAGES: Record<string, string> = {
  en: "Hello, I'm interested in {package}.",
  tr: "Merhaba, {package} hakkında bilgi almak istiyorum.",
  de: "Hallo, ich interessiere mich für {package}.",
  es: "Hola, estoy interesado/a en {package}.",
  fr: "Bonjour, je suis intéressé(e) par {package}.",
  ar: "مرحبًا، أنا مهتم بـ {package}.",
  ru: "Здравствуйте, меня интересует {package}.",
  ro: "Bună ziua, sunt interesat(ă) de {package}.",
  "sr-latn": "Zdravo, zanima me {package}.",
};

export function parseContactChannels(rawSettings: unknown): ContactChannelsSettings {
  const raw = rawSettings && typeof rawSettings === "object" ? (rawSettings as Record<string, unknown>).contactChannels : undefined;
  const parsed = ContactChannelsSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { whatsappEnabled: false, whatsappNumber: null, coordinatorEmail: null, whatsappMessages: {} };
}

/** Herkese açık: yalnızca açık VE numara girilmişse WhatsApp bilgisi döner; aksi halde null (düğme hiç çizilmez). */
export function publicWhatsapp(settings: ContactChannelsSettings, locale: string | undefined): { number: string; message: string } | null {
  if (!settings.whatsappEnabled || !settings.whatsappNumber) return null;
  const message = (locale && settings.whatsappMessages[locale]) || settings.whatsappMessages.en || (locale && DEFAULT_WHATSAPP_MESSAGES[locale]) || DEFAULT_WHATSAPP_MESSAGES.en!;
  return { number: settings.whatsappNumber.replace(/[^0-9]/g, ""), message };
}

// --- yerelleştirme ve DTO -------------------------------------------------------------------------
export function pickLocale<T>(translations: unknown, locale: string | undefined): { value: T; locale: string } | null {
  const all = translations && typeof translations === "object" ? (translations as Record<string, T>) : {};
  for (const code of [locale, "en", "tr"]) if (code && all[code]) return { value: all[code]!, locale: code };
  const first = Object.entries(all)[0];
  return first ? { value: first[1], locale: first[0] } : null;
}

function coverDto(media: Media | null | undefined) {
  if (!media || !media.url || !media.mimeType.startsWith("image/")) return null;
  const variants = parseVariants(media.variants);
  const jpeg = variants.find((v) => v.format === "jpeg");
  return {
    url: absolutizeMediaUrl(media.url),
    /** Open Graph/e-posta için uyumluluk kopyası (WebP her yerde görünmüyor). */
    compatUrl: jpeg ? absolutizeMediaUrl(jpeg.url) : null,
    width: media.width,
    height: media.height,
    alt: media.altText ?? "",
  };
}

type PackageRow = HealthPackage & { coverMedia?: Media | null };

/** Herkese açık özet kart (fiyat yalnızca `showPrice` açıkken). */
export function toPublicPackageCard(row: PackageRow, locale: string | undefined) {
  const t = pickLocale<PackageText>(row.translations, locale);
  if (!t?.value.title) return null;
  return {
    id: row.id,
    slug: row.slug,
    category: row.category as PackageCategory,
    title: t.value.title,
    summary: t.value.summary ?? "",
    duration: t.value.duration ?? "",
    contentLocale: t.locale,
    isFeatured: row.isFeatured,
    cover: coverDto(row.coverMedia),
    price: row.showPrice && row.priceFrom !== null ? { from: Number(row.priceFrom), currency: row.currency } : null,
  };
}

export function toPublicPackageDetail(row: PackageRow, locale: string | undefined) {
  const card = toPublicPackageCard(row, locale);
  if (!card) return null;
  const t = pickLocale<PackageText>(row.translations, locale)!.value;
  return {
    ...card,
    includes: t.includes ?? [],
    notIncluded: t.notIncluded ?? [],
    idealFor: t.idealFor ?? "",
    faq: t.faq ?? [],
    availableLocales: Object.keys((row.translations as Record<string, unknown>) ?? {}),
  };
}

export function toAdminPackageDto(row: PackageRow & { _count?: { inquiries: number } }) {
  return {
    ...row,
    priceFrom: row.priceFrom === null ? null : Number(row.priceFrom),
    coverMedia: undefined,
    cover: coverDto(row.coverMedia),
    inquiryCount: row._count?.inquiries ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type DestinationRow = DestinationHighlight & { coverMedia?: Media | null };
type TopTreatment = z.infer<typeof TopTreatmentSchema>;

export function toPublicDestination(row: DestinationRow, locale: string | undefined) {
  const t = pickLocale<z.infer<typeof DestinationTextSchema>>(row.translations, locale);
  if (!t?.value.title) return null;
  const treatments = (Array.isArray(row.topTreatments) ? (row.topTreatments as TopTreatment[]) : []).slice(0, 3);
  return {
    id: row.id,
    slug: row.slug,
    city: row.city,
    title: t.value.title,
    summary: t.value.summary ?? "",
    highlights: t.value.highlights ?? [],
    cover: coverDto(row.coverMedia),
    /** Yalnızca yönetici girdiyse (boşsa hiç gösterilmez). */
    patientCountLastYear: row.patientCountLastYear,
    dataPeriodLabel: row.dataPeriodLabel,
    treatments: treatments
      .map((tr) => {
        const label = pickLocale<string>(tr.label, locale)?.value;
        if (!label) return null;
        // Fiyat yalnızca `showPrices` açıkken ve girilmişse.
        return { label, price: row.showPrices && tr.priceFrom !== null ? { from: tr.priceFrom, currency: tr.currency } : null };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  };
}

export function toAdminDestinationDto(row: DestinationRow) {
  return { ...row, coverMedia: undefined, cover: coverDto(row.coverMedia), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export function packageData(body: PackageBody): Omit<Prisma.HealthPackageUncheckedCreateInput, "id"> {
  return {
    slug: body.slug,
    category: body.category,
    coverMediaId: body.coverMediaId ?? null,
    translations: body.translations as Prisma.InputJsonValue,
    priceFrom: body.priceFrom ?? null,
    currency: body.currency,
    showPrice: body.showPrice,
    relatedSpecialtyIds: body.relatedSpecialtyIds,
    relatedDoctorIds: body.relatedDoctorIds,
    isActive: body.isActive,
    isFeatured: body.isFeatured,
    sortOrder: body.sortOrder,
  };
}

export function destinationData(body: DestinationBody): Omit<Prisma.DestinationHighlightUncheckedCreateInput, "id"> {
  return {
    slug: body.slug,
    city: body.city,
    coverMediaId: body.coverMediaId ?? null,
    translations: body.translations as Prisma.InputJsonValue,
    topTreatments: body.topTreatments as Prisma.InputJsonValue,
    patientCountLastYear: body.patientCountLastYear ?? null,
    dataPeriodLabel: body.dataPeriodLabel?.trim() || null,
    showPrices: body.showPrices,
    isActive: body.isActive,
    sortOrder: body.sortOrder,
  };
}
