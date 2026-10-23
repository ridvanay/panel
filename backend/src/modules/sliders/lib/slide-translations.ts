import { z } from "zod";
import type { Media, PrismaClient } from "@prisma/client";
import { LOCALE_CODE_PATTERN } from "../../../lib/localization";

/**
 * Paket O (2026-10-23) — dile özel slayt arka plan görseli. Görsele gömülü yazılar (ör. "OUR HEALTH
 * SERVICE…") dile göre değişebilsin diye her dil için opsiyonel masaüstü/tablet/mobil görsel:
 * `Slide.translations = { "<dil>": { bgMediaId, bgTabletMediaId?, bgMobileMediaId? } }`.
 *
 * KURALLAR: yalnızca medya kütüphanesi id'leri (UUID) — dış URL şema seviyesinde reddedilir; id'ler
 * route katmanında `image/*` MIME'a karşı doğrulanır. Yalnızca `bgType=IMAGE` slaytlarda uygulanır.
 * Dilin görseli yoksa (ya da medya silinmişse) varsayılan görseller gösterilir.
 */
export const SLIDE_TRANSLATION_MEDIA_KEYS = ["bgMediaId", "bgTabletMediaId", "bgMobileMediaId"] as const;
type MediaKey = (typeof SLIDE_TRANSLATION_MEDIA_KEYS)[number];
export type SlideTranslations = Record<string, Partial<Record<MediaKey, string>>>;

const MAX_LOCALES = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compact(map: Record<string, Partial<Record<MediaKey, string | null | undefined>>>): SlideTranslations {
  const out: SlideTranslations = {};
  for (const [locale, entry] of Object.entries(map)) {
    const ids: Partial<Record<MediaKey, string>> = {};
    for (const key of SLIDE_TRANSLATION_MEDIA_KEYS) {
      const value = entry?.[key];
      if (typeof value === "string" && UUID_RE.test(value)) ids[key] = value;
    }
    // Masaüstü görseli olmayan dil kaydı anlamsız (tablet/mobil yalnızca onun yedeği) → atılır.
    if (ids.bgMediaId) out[locale] = ids;
  }
  return out;
}

export const SlideTranslationsSchema = z
  .record(
    z.string().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu."),
    z
      .object({
        bgMediaId: z.string().uuid("Yalnızca medya kütüphanesinden görsel seçilebilir.").nullable().optional(),
        bgTabletMediaId: z.string().uuid("Yalnızca medya kütüphanesinden görsel seçilebilir.").nullable().optional(),
        bgMobileMediaId: z.string().uuid("Yalnızca medya kütüphanesinden görsel seçilebilir.").nullable().optional(),
      })
      .strict()
  )
  .refine((map) => Object.keys(map).length <= MAX_LOCALES, `En fazla ${MAX_LOCALES} dil.`)
  .transform(compact);

/** DB'deki JSON'u güvenli okur (bozuk/eksik veri yok sayılır). */
export function readSlideTranslations(value: unknown): SlideTranslations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return compact(value as Record<string, Partial<Record<MediaKey, string>>>);
}

export function slideTranslationMediaIds(translations: unknown): string[] {
  return [...new Set(Object.values(readSlideTranslations(translations)).flatMap((entry) => Object.values(entry)))];
}

export type WithTranslationMedia<T> = T & { translationMedia: Media[] };

/** Slaytların dil görsellerinin `Media` satırlarını TEK sorguda yükler (yalnızca görsel MIME). */
export async function attachTranslationMedia<T extends { translations: unknown }>(
  prisma: Pick<PrismaClient, "media">,
  slides: T[]
): Promise<WithTranslationMedia<T>[]> {
  const ids = [...new Set(slides.flatMap((slide) => slideTranslationMediaIds(slide.translations)))];
  const media = ids.length ? await prisma.media.findMany({ where: { id: { in: ids }, mimeType: { startsWith: "image/" } } }) : [];
  return slides.map((slide) => {
    const own = new Set(slideTranslationMediaIds(slide.translations));
    return { ...slide, translationMedia: media.filter((m) => own.has(m.id)) };
  });
}

/** Tek slayt / slider kısayolları (route'larda `toSlideDto`/`toSliderDto` öncesi). */
export async function withSlideMedia<T extends { translations: unknown }>(prisma: Pick<PrismaClient, "media">, slide: T): Promise<WithTranslationMedia<T>> {
  return (await attachTranslationMedia(prisma, [slide]))[0]!;
}

export async function withSliderMedia<S extends { slides: { translations: unknown }[] }>(
  prisma: Pick<PrismaClient, "media">,
  slider: S
): Promise<S & { slides: WithTranslationMedia<S["slides"][number]>[] }> {
  return { ...slider, slides: await attachTranslationMedia(prisma, slider.slides) };
}

/** Dilin görselleri: masaüstü zorunlu; tablet/mobil yoksa CİHAZ yedek zinciri dilin kendi görseline düşer. */
export function resolveSlideTranslationMedia(
  slide: { translations: unknown; translationMedia?: Media[] },
  locale: string
): { bgMedia: Media; bgTabletMedia: Media | null; bgMobileMedia: Media | null } | null {
  const entry = readSlideTranslations(slide.translations)[locale];
  if (!entry) return null;
  const find = (id?: string) => (id ? (slide.translationMedia ?? []).find((m) => m.id === id) ?? null : null);
  const bgMedia = find(entry.bgMediaId);
  if (!bgMedia) return null;
  return { bgMedia, bgTabletMedia: find(entry.bgTabletMediaId), bgMobileMedia: find(entry.bgMobileMediaId) };
}

/** Public okuma: aktif dilin görseli varsa (yalnızca `IMAGE` slaytta) varsayılan görsellerin yerine geçer. */
export function localizeSlideBackground<
  T extends {
    bgType: string;
    translations: unknown;
    translationMedia?: Media[];
    bgMedia: Media | null;
    bgMediaId: string | null;
    bgTabletMedia: Media | null;
    bgTabletMediaId: string | null;
    bgMobileMedia: Media | null;
    bgMobileMediaId: string | null;
  },
>(slide: T, locale: string | undefined): T {
  if (!locale || slide.bgType !== "IMAGE") return slide;
  const media = resolveSlideTranslationMedia(slide, locale);
  if (!media) return slide;
  return {
    ...slide,
    bgMedia: media.bgMedia,
    bgMediaId: media.bgMedia.id,
    bgTabletMedia: media.bgTabletMedia,
    bgTabletMediaId: media.bgTabletMedia?.id ?? null,
    bgMobileMedia: media.bgMobileMedia,
    bgMobileMediaId: media.bgMobileMedia?.id ?? null,
  };
}
