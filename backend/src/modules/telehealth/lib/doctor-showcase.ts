import type { DoctorMedia, DoctorProcedure, Media } from "@prisma/client";
import { z } from "zod";
import { LOCALE_CODE_PATTERN } from "../../../lib/localization";
import { absolutizeMediaUrl } from "../../../mappers";

/**
 * Paket Y — hekim profilinin "vitrin" içerikleri: işlemler (fiyat YOK), foto/video galerisi ve SSS çevirisi.
 *
 * Video kuralları (çerez/KVKK): YouTube (`youtube-nocookie.com`) ya da Vimeo (`dnt=1`) kimliği saklanır
 * ya da (Paket AE) MP4 sunucuya yüklenir (`videoProvider: "upload"`, `mediaId` = MP4; poster
 * `thumbnailMediaId`, altyazı `captionsMediaId`). Küçük resim admin kaydında sunucuda BİR KEZ indirilip Media'ya kaydedilir
 * (`lib/video-thumbnail.ts`); sayfada yalnızca bu YEREL kopya (yoksa nötr yer tutucu) görünür, iframe
 * "Oynat"a basılınca yüklenir — o ana kadar youtube/ytimg/vimeo alanlarına istek gitmez.
 *
 * Hasta içeriği: `before-after` kategorisi ve hastanın tanınabildiği her öğe (`showsPatient`)
 * `patientConsentConfirmed=true` olmadan YAYINLANAMAZ. `before-after` ayrıca telehealth ayarı
 * `doctorMedia.beforeAfterEnabled` (varsayılan false) kapalıyken HİÇ görünmez.
 */
const localeKey = z.string().regex(LOCALE_CODE_PATTERN);
const noHtml = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/<[a-z!/]/i.test(v), "HTML kullanılamaz.");

export const PROCEDURE_TEXT_FIELDS = ["title", "description", "duration", "anesthesia", "hospitalStay", "recovery"] as const;

export const ProcedureTextSchema = z
  .object({
    title: noHtml(160).pipe(z.string().min(1)),
    description: noHtml(2000).default(""),
    duration: noHtml(120).default(""),
    anesthesia: noHtml(120).default(""),
    hospitalStay: noHtml(120).default(""),
    recovery: noHtml(300).default(""),
  })
  .strict();

export const ProcedureBodySchema = z
  .object({
    translations: z
      .record(localeKey, ProcedureTextSchema)
      .refine((t) => Object.keys(t).length >= 1, "En az bir dilde başlık gerekli.")
      .refine((t) => Object.keys(t).length <= 20, "En çok 20 dil."),
    relatedCareTopicIds: z.array(z.string().uuid()).max(20).default([]),
    sortOrder: z.number().int().min(0).max(100000).default(0),
    isPublished: z.boolean().default(false),
  })
  .strict();

export const MEDIA_KINDS = ["photo", "video"] as const;
export const MEDIA_CATEGORIES = ["about", "clinic", "procedure", "interview", "before-after"] as const;
export const VIDEO_PROVIDERS = ["youtube", "vimeo", "upload"] as const;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

export const MediaTextSchema = z
  .object({
    title: noHtml(160).default(""),
    description: noHtml(1000).default(""),
    /** Fotoğrafta zorunlu (erişilebilirlik). */
    alt: noHtml(200).default(""),
  })
  .strict();

export const DoctorMediaBodySchema = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    mediaId: z.string().uuid().nullish(),
    videoProvider: z.enum(VIDEO_PROVIDERS).nullish(),
    videoId: z.string().trim().max(40).nullish(),
    /** Paket AE — yalnızca `upload`: poster görseli, WebVTT altyazı ve dili. */
    posterMediaId: z.string().uuid().nullish(),
    captionsMediaId: z.string().uuid().nullish(),
    captionsLang: localeKey.nullish(),
    category: z.enum(MEDIA_CATEGORIES),
    translations: z.record(localeKey, MediaTextSchema).refine((t) => Object.keys(t).length <= 20, "En çok 20 dil."),
    showsPatient: z.boolean().default(false),
    patientConsentConfirmed: z.boolean().default(false),
    consentNote: z.string().trim().max(1000).nullish(),
    isPublished: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.kind === "photo") {
      if (!b.mediaId) ctx.addIssue({ code: "custom", path: ["mediaId"], message: "Fotoğraf için medya seçin." });
      if (!Object.values(b.translations).some((t) => t.alt.trim())) ctx.addIssue({ code: "custom", path: ["translations"], message: "Fotoğraf için alt metin zorunlu." });
    } else if (b.videoProvider === "upload") {
      if (!b.mediaId) ctx.addIssue({ code: "custom", path: ["mediaId"], message: "Yüklenen video seçilmedi." });
      if (b.captionsMediaId && !b.captionsLang) ctx.addIssue({ code: "custom", path: ["captionsLang"], message: "Altyazı dilini seçin." });
    } else {
      if (!b.videoProvider || !b.videoId) ctx.addIssue({ code: "custom", path: ["videoId"], message: "Video için sağlayıcı ve video kimliği gerekli." });
      else if (b.videoProvider === "youtube" && !YOUTUBE_ID.test(b.videoId)) ctx.addIssue({ code: "custom", path: ["videoId"], message: "Geçersiz YouTube video kimliği." });
      else if (b.videoProvider === "vimeo" && !VIMEO_ID.test(b.videoId)) ctx.addIssue({ code: "custom", path: ["videoId"], message: "Geçersiz Vimeo video kimliği." });
    }
    if (requiresPatientConsent(b) && b.isPublished && !b.patientConsentConfirmed) {
      ctx.addIssue({ code: "custom", path: ["patientConsentConfirmed"], message: "Hastanın göründüğü içerik, hastadan yazılı onay alınmadan yayınlanamaz." });
    }
    if (b.patientConsentConfirmed && !b.consentNote?.trim()) {
      ctx.addIssue({ code: "custom", path: ["consentNote"], message: "Onayın nasıl alındığını not edin." });
    }
  });

export function requiresPatientConsent(m: { category: string; showsPatient: boolean }): boolean {
  return m.category === "before-after" || m.showsPatient;
}

// --- ayar ---------------------------------------------------------------------------------------
/** Paket AE — yüklenen videonun azami boyutu (MB). Nginx `client_max_body_size` bunun biraz üstünde olmalı. */
export const DEFAULT_MAX_VIDEO_UPLOAD_MB = 100;
export const MAX_VIDEO_UPLOAD_MB_LIMIT = 500;
const MaxVideoMb = z.number().int().min(1).max(MAX_VIDEO_UPLOAD_MB_LIMIT);

export const DoctorMediaSettingsSchema = z.object({ beforeAfterEnabled: z.boolean(), maxVideoUploadMb: MaxVideoMb });
export type DoctorMediaSettings = z.infer<typeof DoctorMediaSettingsSchema>;
/** PUT gövdesi: alanlar ayrı ayrı güncellenebilir (eski istemci yalnızca `beforeAfterEnabled` gönderir). */
export const DoctorMediaSettingsUpdateSchema = z.object({ beforeAfterEnabled: z.boolean().optional(), maxVideoUploadMb: MaxVideoMb.optional() }).strict();

export function parseDoctorMediaSettings(rawSettings: unknown): DoctorMediaSettings {
  const raw = rawSettings && typeof rawSettings === "object" ? (rawSettings as Record<string, unknown>).doctorMedia : undefined;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  // Varsayılan KAPALI — hukuk onayı gelene kadar önce/sonra kategorisi hiç görünmez.
  const beforeAfter = z.boolean().safeParse(obj.beforeAfterEnabled);
  const maxMb = MaxVideoMb.safeParse(obj.maxVideoUploadMb);
  return { beforeAfterEnabled: beforeAfter.success ? beforeAfter.data : false, maxVideoUploadMb: maxMb.success ? maxMb.data : DEFAULT_MAX_VIDEO_UPLOAD_MB };
}

// --- herkese açık DTO --------------------------------------------------------------------------
function pickText<T extends Record<string, unknown>>(translations: unknown, locale: string | undefined): T | null {
  const all = translations && typeof translations === "object" ? (translations as Record<string, T>) : {};
  if (locale && all[locale]) return all[locale]!;
  return all.en ?? all.tr ?? Object.values(all)[0] ?? null;
}

export function toPublicProcedureDto(row: DoctorProcedure, locale: string | undefined) {
  const t = pickText<z.infer<typeof ProcedureTextSchema>>(row.translations, locale);
  if (!t?.title) return null;
  return {
    id: row.id,
    title: t.title,
    description: t.description ?? "",
    duration: t.duration ?? "",
    anesthesia: t.anesthesia ?? "",
    hospitalStay: t.hospitalStay ?? "",
    recovery: t.recovery ?? "",
    relatedCareTopicIds: row.relatedCareTopicIds,
  };
}

/** Okuma anında da doğrulanır (veritabanına başka yoldan yazılmış kimlik iframe src'ye girmesin). */
function validVideo(provider: string | null, videoId: string | null): boolean {
  if (!videoId) return false;
  return (provider === "youtube" && YOUTUBE_ID.test(videoId)) || (provider === "vimeo" && VIMEO_ID.test(videoId));
}

export function videoEmbedUrl(provider: string | null, videoId: string | null): string | null {
  if (!validVideo(provider, videoId)) return null;
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
  return `https://player.vimeo.com/video/${videoId}?dnt=1&autoplay=1`;
}

/** Galeri için izin verilen görsel türleri (SVG yok). */
export const GALLERY_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

export function toPublicMediaDto(row: DoctorMedia & { media: Media | null; thumbnailMedia?: Media | null; captionsMedia?: Media | null }, locale: string | undefined) {
  const t = pickText<z.infer<typeof MediaTextSchema>>(row.translations, locale) ?? { title: "", description: "", alt: "" };
  if (row.kind === "photo") {
    if (!row.media || !t.alt) return null;
    return {
      id: row.id,
      kind: "photo" as const,
      category: row.category,
      title: t.title,
      description: t.description,
      alt: t.alt,
      url: absolutizeMediaUrl(row.media.url),
      width: row.media.width,
      height: row.media.height,
    };
  }
  const thumbnailUrl = row.thumbnailMedia ? absolutizeMediaUrl(row.thumbnailMedia.url) : null;
  if (row.videoProvider === "upload") {
    if (!row.media || row.media.mimeType !== "video/mp4") return null;
    const captions = row.captionsMedia && row.captionsMedia.mimeType === "text/vtt" ? row.captionsMedia : null;
    return {
      id: row.id,
      kind: "video" as const,
      category: row.category,
      title: t.title,
      description: t.description,
      alt: t.alt || t.title,
      videoProvider: "upload" as const,
      videoId: null,
      thumbnailUrl,
      embedUrl: null,
      videoUrl: absolutizeMediaUrl(row.media.url),
      captionsUrl: captions ? absolutizeMediaUrl(captions.url) : null,
      captionsLang: captions ? row.captionsLang : null,
      durationSec: row.media.durationSec,
    };
  }
  const embedUrl = videoEmbedUrl(row.videoProvider, row.videoId);
  if (!embedUrl) return null;
  return {
    id: row.id,
    kind: "video" as const,
    category: row.category,
    title: t.title,
    description: t.description,
    alt: t.alt || t.title,
    videoProvider: row.videoProvider,
    videoId: row.videoId,
    // Yalnızca YEREL kopya; sağlayıcı adresi asla dönmez.
    thumbnailUrl,
    embedUrl,
    videoUrl: null,
    captionsUrl: null,
    captionsLang: null,
    durationSec: null,
  };
}

/** Profil SSS çevirisi: `translations.<dil>.faq` doluysa o; yoksa kanonik (alan döndürülmez). */
export function localizedFaq(translations: unknown, locale: string): { faq?: { question: string; answer: string }[] } {
  const t = translations && typeof translations === "object" ? (translations as Record<string, { faq?: unknown }>)[locale] : undefined;
  const faq = Array.isArray(t?.faq) ? (t!.faq as { question?: unknown; answer?: unknown }[]) : null;
  if (!faq || faq.length === 0) return {};
  const items = faq.filter((f) => typeof f.question === "string" && typeof f.answer === "string" && f.question.trim() && f.answer.trim()) as { question: string; answer: string }[];
  return items.length ? { faq: items } : {};
}
