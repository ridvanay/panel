import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { absolutizeMediaUrl } from "../../../mappers";
import { NotFoundError, ValidationError } from "../../../lib/errors";

/**
 * Paket M (2026-10-23) — doktor profil başlığının (`/doctors/[slug]` hero) arka plan görseli ve
 * koyu katman opaklığı. Tema renkleri ve acil durum uyarısıyla aynı yerde, `SiteModule(key="telehealth")
 * .settings` JSON'unun `doctorHero` alanında tutulur (migration YOK — `SiteAppearance`'ta JSON kolonu
 * yoktur). Şekil: `{ imageMediaId: uuid | null, overlayOpacity: 0–80 }`.
 *
 * Güvenlik: görsel YALNIZCA medya kütüphanesinden (`imageMediaId`) seçilir; dış URL alanı yoktur
 * (gövde `strict` — bilinmeyen alan 422). Bağlantı her okumada `Media.url`'den türetilir; medya
 * silinmişse ya da görsel değilse `imageUrl: null` döner ve site varsayılan SVG'yi gösterir.
 */
export const DOCTOR_HERO_OVERLAY_MIN = 0;
export const DOCTOR_HERO_OVERLAY_MAX = 80;
export const DOCTOR_HERO_OVERLAY_DEFAULT = 55;

export const DoctorHeroSettingsSchema = z.object({
  imageMediaId: z.string().uuid().nullable(),
  /** Sunucuda `Media.url`'den çözülür (mutlak). `null` = varsayılan görsel. */
  imageUrl: z.string().nullable(),
  overlayOpacity: z.number().int().min(DOCTOR_HERO_OVERLAY_MIN).max(DOCTOR_HERO_OVERLAY_MAX),
});
export type DoctorHeroSettings = z.infer<typeof DoctorHeroSettingsSchema>;

/** `PATCH /admin/telehealth/settings/doctor-hero` — kısmi; `imageMediaId: null` varsayılana döner. */
export const UpdateDoctorHeroRequestSchema = z
  .object({
    imageMediaId: z.string().uuid("Geçersiz medya kimliği.").nullable().optional(),
    overlayOpacity: z.number().int().min(DOCTOR_HERO_OVERLAY_MIN).max(DOCTOR_HERO_OVERLAY_MAX).optional(),
  })
  .strict()
  .refine((body) => body.imageMediaId !== undefined || body.overlayOpacity !== undefined, "Güncellenecek bir alan gönderin.");
export type UpdateDoctorHeroRequest = z.infer<typeof UpdateDoctorHeroRequestSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** JSON'daki ham değer (URL'siz). Bozuk/eksik değerler SESSİZCE varsayılana düşer; ASLA hata fırlatmaz. */
export function parseDoctorHero(rawSettings: unknown): Omit<DoctorHeroSettings, "imageUrl"> {
  const hero = asRecord(asRecord(rawSettings).doctorHero);
  const id = typeof hero.imageMediaId === "string" && UUID_RE.test(hero.imageMediaId) ? hero.imageMediaId : null;
  const opacity = hero.overlayOpacity;
  const valid = typeof opacity === "number" && Number.isInteger(opacity) && opacity >= DOCTOR_HERO_OVERLAY_MIN && opacity <= DOCTOR_HERO_OVERLAY_MAX;
  return { imageMediaId: id, overlayOpacity: valid ? opacity : DOCTOR_HERO_OVERLAY_DEFAULT };
}

/** Görsel bağlantısını medya kaydından çözer; medya yoksa ya da görsel değilse `null`. */
export async function resolveDoctorHero(db: Pick<PrismaClient, "media">, rawSettings: unknown): Promise<DoctorHeroSettings> {
  const hero = parseDoctorHero(rawSettings);
  if (!hero.imageMediaId) return { ...hero, imageUrl: null };
  const media = await db.media.findUnique({ where: { id: hero.imageMediaId }, select: { url: true, mimeType: true } });
  const imageUrl = media && media.mimeType.startsWith("image/") ? absolutizeMediaUrl(media.url) : null;
  return { ...hero, imageUrl };
}

/** Güncellemeyi doğrular (medya var ve görsel mi) ve JSON'a yazılacak değeri döner. */
export async function applyDoctorHeroUpdate(
  db: Pick<PrismaClient, "media">,
  rawSettings: unknown,
  patch: UpdateDoctorHeroRequest
): Promise<Omit<DoctorHeroSettings, "imageUrl">> {
  const current = parseDoctorHero(rawSettings);
  if (patch.imageMediaId) {
    const media = await db.media.findUnique({ where: { id: patch.imageMediaId }, select: { mimeType: true } });
    if (!media) throw new NotFoundError("Seçilen medya bulunamadı.");
    if (!media.mimeType.startsWith("image/")) {
      throw new ValidationError("Seçilen dosya bir görsel değil.", { imageMediaId: ["Yalnızca görsel (PNG/JPG/WebP/GIF) seçilebilir."] });
    }
  }
  return {
    imageMediaId: patch.imageMediaId !== undefined ? patch.imageMediaId : current.imageMediaId,
    overlayOpacity: patch.overlayOpacity ?? current.overlayOpacity,
  };
}
