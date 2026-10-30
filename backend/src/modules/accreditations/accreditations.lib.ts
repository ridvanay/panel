import type { AccreditationBadge, Media } from "@prisma/client";
import { z } from "zod";
import { textTranslationsSchema, readTranslations } from "../../lib/entity-translations";
import { absolutizeMediaUrl } from "../../mappers";

/**
 * Paket V (İş 4) — güven ve yetki belgeleri. Kurallar:
 *  - `isActive=true` için `certificateNo` dolu olmalı (burada + DB CHECK). Belge numarası olmayan
 *    kayıt sitede GÖSTERİLMEZ.
 *  - `validUntil` (dahil) bugünden (İstanbul takvim günü) önceyse süresi geçmiştir: sitede otomatik
 *    gizlenir, admin listesinde `expired: true` ile uyarı çıkar.
 *  - `verificationUrl` yalnızca `https://` mutlak adres (yeni sekmede, `noopener` ile açılır).
 *  - Logo yalnızca medya kütüphanesinden (PNG/JPG/WebP); dosya repoya eklenmez/üretilmez.
 *  - JSON-LD `hasCredential` yalnızca sitede görünen (aktif + geçerli) belgelerden üretilir (frontend).
 */
export const ACCREDITATION_NAME_MAX = 120;
export const ACCREDITATION_ISSUER_MAX = 160;
export const ACCREDITATION_DESCRIPTION_MAX = 300;
export const ACCREDITATION_CERTIFICATE_MAX = 80;

export const ACCREDITATION_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** `YYYY-MM-DD` — İstanbul takvim günü. */
export function istanbulToday(now: Date = new Date()): string {
  return new Date(now.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

export function isExpired(validUntil: Date | null, now: Date = new Date()): boolean {
  if (!validUntil) return false;
  return validUntil.toISOString().slice(0, 10) < istanbulToday(now);
}

export function hasCertificate(certificateNo: string | null | undefined): boolean {
  return typeof certificateNo === "string" && certificateNo.trim().length > 0;
}

/** Sitede gösterilir mi: aktif + belge numarası dolu + süresi geçmemiş. */
export function isPubliclyVisible(badge: Pick<AccreditationBadge, "isActive" | "certificateNo" | "validUntil">, now: Date = new Date()): boolean {
  return badge.isActive && hasCertificate(badge.certificateNo) && !isExpired(badge.validUntil, now);
}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url("Geçerli bir adres girin.")
  .refine((v) => /^https:\/\//i.test(v), "Doğrulama adresi https:// ile başlamalıdır.");

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Geçersiz tarih.");

const BadgeTranslationsSchema = textTranslationsSchema({ name: ACCREDITATION_NAME_MAX, description: ACCREDITATION_DESCRIPTION_MAX });

const baseFields = {
  name: z.string().trim().min(1, "Ad zorunludur.").max(ACCREDITATION_NAME_MAX),
  issuer: z.string().trim().min(1, "Veren kurum zorunludur.").max(ACCREDITATION_ISSUER_MAX),
  logoMediaId: z.string().uuid().nullable().optional(),
  certificateNo: z.string().trim().max(ACCREDITATION_CERTIFICATE_MAX).nullable().optional(),
  verificationUrl: httpsUrl.nullable().optional(),
  validUntil: dateOnly.nullable().optional(),
  translations: BadgeTranslationsSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
};

export const CreateAccreditationRequestSchema = z.object(baseFields).strict();
export type CreateAccreditationRequest = z.infer<typeof CreateAccreditationRequestSchema>;

export const UpdateAccreditationRequestSchema = z
  .object({ ...baseFields, name: baseFields.name.optional(), issuer: baseFields.issuer.optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Güncellenecek bir alan gönderin.");
export type UpdateAccreditationRequest = z.infer<typeof UpdateAccreditationRequestSchema>;

export const AccreditationIdParamSchema = z.object({ id: z.string().uuid() });

export const AdminAccreditationSchema = z.object({
  id: z.string(),
  name: z.string(),
  issuer: z.string(),
  logoMediaId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  certificateNo: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  validUntil: z.string().nullable(),
  translations: z.record(z.record(z.string())),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  /** Süresi geçmiş (sitede gizli) — admin uyarısı. */
  expired: z.boolean(),
  /** Sitede şu an görünüyor mu (aktif + belge no + geçerli). */
  publiclyVisible: z.boolean(),
  updatedAt: z.string(),
});
export type AdminAccreditationDto = z.infer<typeof AdminAccreditationSchema>;

export const PublicAccreditationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  issuer: z.string(),
  logoUrl: z.string().nullable(),
  logoAlt: z.string().nullable(),
  certificateNo: z.string(),
  verificationUrl: z.string().nullable(),
  validUntil: z.string().nullable(),
});
export type PublicAccreditationDto = z.infer<typeof PublicAccreditationSchema>;

type BadgeWithLogo = AccreditationBadge & { logoMedia: Pick<Media, "url" | "altText"> | null };

function dateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toAdminAccreditationDto(badge: BadgeWithLogo, now: Date = new Date()): AdminAccreditationDto {
  return {
    id: badge.id,
    name: badge.name,
    issuer: badge.issuer,
    logoMediaId: badge.logoMediaId,
    logoUrl: badge.logoMedia ? absolutizeMediaUrl(badge.logoMedia.url) : null,
    certificateNo: badge.certificateNo,
    verificationUrl: badge.verificationUrl,
    validUntil: dateString(badge.validUntil),
    translations: readTranslations(badge.translations),
    sortOrder: badge.sortOrder,
    isActive: badge.isActive,
    expired: isExpired(badge.validUntil, now),
    publiclyVisible: isPubliclyVisible(badge, now),
    updatedAt: badge.updatedAt.toISOString(),
  };
}

/** `locale` içerik dili (çeviri yoksa kanonik EN ad). Çağıran yalnızca `isPubliclyVisible` kayıtları verir. */
export function toPublicAccreditationDto(badge: BadgeWithLogo, locale: string | undefined): PublicAccreditationDto {
  const t = locale ? readTranslations(badge.translations)[locale] : undefined;
  const name = t?.name ?? badge.name;
  return {
    id: badge.id,
    name,
    description: t?.description ?? readTranslations(badge.translations).en?.description ?? null,
    issuer: badge.issuer,
    logoUrl: badge.logoMedia ? absolutizeMediaUrl(badge.logoMedia.url) : null,
    logoAlt: badge.logoMedia?.altText?.trim() || name,
    certificateNo: badge.certificateNo!.trim(),
    verificationUrl: badge.verificationUrl,
    validUntil: dateString(badge.validUntil),
  };
}

/** Birleşik (mevcut + yama) durum için aktiflik kuralı — ihlalde alan bazlı hata mesajı. */
export function activationError(state: { isActive: boolean; certificateNo: string | null | undefined }): string | null {
  if (state.isActive && !hasCertificate(state.certificateNo)) return "Belge numarası olmadan belge aktif edilemez.";
  return null;
}

export function parseDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T00:00:00Z`);
}
