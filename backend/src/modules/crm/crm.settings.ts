import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

/**
 * Paket N (2026-10-23) — CRM ayarları. Yeni tablo AÇILMAZ: `SiteModule(key="crm").settings` JSON'unda
 * yaşar (tema/acil uyarı ayarlarıyla aynı desen). `crm` anahtarı `MODULE_REGISTRY`'de YOKTUR — modüller
 * ekranında görünmez, yalnızca CRM → Ayarlar'dan yönetilir. Takip VARSAYILAN KAPALI gelir.
 */
export const CRM_SETTINGS_KEY = "crm";

/** Çerez onay metni/kategorileri değişirse artırılır — eski onaylar banner'ı yeniden gösterir. */
export const CRM_CONSENT_VERSION = "2026-10-23";

const CIDR_OR_IP = z
  .string()
  .trim()
  .max(64)
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, "Geçerli bir IP ya da CIDR girin (ör. 203.0.113.0/24).");

const PATH_PREFIX = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[^\s?#]*$/, "Yol / ile başlamalı (ör. /kampanya-test).");

export const CrmScoreWeightsSchema = z.object({
  /** Okuma dakikası başına puan (en fazla 30 puan). */
  perEngagedMinute: z.number().int().min(0).max(20),
  /** Görüntülenen sayfa başına puan (en fazla 30 puan). */
  perPageview: z.number().int().min(0).max(20),
  /** İkinci ve sonraki her ziyaret için puan (en fazla 20 puan). */
  perReturnVisit: z.number().int().min(0).max(30),
  /** Randevu sihirbazına gelme. */
  bookingPage: z.number().int().min(0).max(50),
  /** WhatsApp/telefon/e-posta tıklaması (tek sefer). */
  contactClick: z.number().int().min(0).max(50),
  /** Bu puan ve üzeri "sıcak" ziyaretçi. */
  hotThreshold: z.number().int().min(1).max(100),
});

export const CrmSearchConsoleSchema = z.object({
  /** `sc-domain:ornek.com` ya da `https://ornek.com/` */
  propertyUrl: z.string().max(300).nullable(),
  /** Servis hesabı JSON'u — `lib/crypto.ts::encryptSecret` ile ŞİFRELİ. Yanıtlarda ASLA dönmez. */
  credentialsCiphertext: z.string().nullable(),
  clientEmail: z.string().max(300).nullable(),
  lastSyncAt: z.string().nullable(),
  lastSyncError: z.string().max(500).nullable(),
  initialSyncDone: z.boolean(),
});

export const CrmSettingsSchema = z.object({
  trackingEnabled: z.boolean(),
  /** Admin/personel oturumu açık cihazlar da takip edilsin mi (varsayılan HAYIR). */
  trackStaff: z.boolean(),
  /** `masked` (IPv4 /24, IPv6 /48) varsayılan. `full` aydınlatma metninde belirtilmelidir. */
  ipMode: z.enum(["masked", "full"]),
  excludedIps: z.array(CIDR_OR_IP).max(100),
  excludedPaths: z.array(PATH_PREFIX).max(100),
  /** Ham ziyaret verisi (ziyaretçi/oturum/olay) saklama süresi. */
  retentionDays: z.number().int().min(7).max(365),
  /** Talep (lead) kayıtları — süre dolunca anonimleştirilir. */
  leadRetentionDays: z.number().int().min(30).max(3650),
  notificationEmail: z.string().trim().email().max(320).nullable(),
  whatsappRef: z.boolean(),
  scoreWeights: CrmScoreWeightsSchema,
  /** İlk yanıt hedefi (saat) — talep listesindeki SLA göstergesi. */
  slaHours: z.number().int().min(1).max(168),
  adsConversionName: z.string().trim().max(100),
  adsLeadConversionName: z.string().trim().max(100),
  searchConsole: CrmSearchConsoleSchema,
});

export type CrmSettings = z.infer<typeof CrmSettingsSchema>;
export type CrmScoreWeights = z.infer<typeof CrmScoreWeightsSchema>;

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  trackingEnabled: false,
  trackStaff: false,
  ipMode: "masked",
  excludedIps: [],
  excludedPaths: [],
  retentionDays: 180,
  leadRetentionDays: 730,
  notificationEmail: null,
  whatsappRef: false,
  scoreWeights: { perEngagedMinute: 2, perPageview: 3, perReturnVisit: 10, bookingPage: 20, contactClick: 25, hotThreshold: 50 },
  slaHours: 2,
  // Google'a giden dosyada sağlık bilgisi ima etmeyen NÖTR adlar (ör. "Tedavi oldu" YAZILMAZ).
  adsConversionName: "Randevu dönüşümü",
  adsLeadConversionName: "Talep dönüşümü",
  searchConsole: {
    propertyUrl: null,
    credentialsCiphertext: null,
    clientEmail: null,
    lastSyncAt: null,
    lastSyncError: null,
    initialSyncDone: false,
  },
};

/** Admin PATCH gövdesi — `searchConsole` buradan YAZILMAZ (kendi uçları var). */
export const UpdateCrmSettingsRequestSchema = CrmSettingsSchema.omit({ searchConsole: true })
  .extend({ scoreWeights: CrmScoreWeightsSchema.partial() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "En az bir alan gönderilmeli." });

export type UpdateCrmSettingsRequest = z.infer<typeof UpdateCrmSettingsRequestSchema>;

/** Bozuk/eksik JSON alanları tek tek varsayılana düşer — kısmi bozulma tüm ayarı sıfırlamaz. */
export function parseCrmSettings(raw: unknown): CrmSettings {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  const shape = CrmSettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof CrmSettings)[]) {
    const field = shape[key] as z.ZodTypeAny;
    if (key === "scoreWeights" || key === "searchConsole") {
      const nested = source[key] && typeof source[key] === "object" ? (source[key] as Record<string, unknown>) : {};
      const nestedShape = (field as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
      const defaults = DEFAULT_CRM_SETTINGS[key] as Record<string, unknown>;
      const merged: Record<string, unknown> = {};
      for (const nestedKey of Object.keys(nestedShape)) {
        const parsed = nestedShape[nestedKey]!.safeParse(nested[nestedKey]);
        merged[nestedKey] = parsed.success ? parsed.data : defaults[nestedKey];
      }
      result[key] = merged;
      continue;
    }
    const parsed = field.safeParse(source[key]);
    result[key] = parsed.success ? parsed.data : DEFAULT_CRM_SETTINGS[key];
  }
  return result as CrmSettings;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function readCrmSettings(db: Db): Promise<CrmSettings> {
  const row = await db.siteModule.findUnique({ where: { key: CRM_SETTINGS_KEY }, select: { settings: true } });
  return parseCrmSettings(row?.settings ?? null);
}

export async function writeCrmSettings(db: Db, settings: CrmSettings, actorId: string | null): Promise<CrmSettings> {
  const value = settings as unknown as Prisma.InputJsonValue;
  await db.siteModule.upsert({
    where: { key: CRM_SETTINGS_KEY },
    create: { key: CRM_SETTINGS_KEY, enabled: true, settings: value, updatedById: actorId },
    update: { settings: value, updatedById: actorId },
  });
  return settings;
}

export function applyCrmSettingsPatch(current: CrmSettings, patch: UpdateCrmSettingsRequest): CrmSettings {
  const { scoreWeights, ...rest } = patch;
  return {
    ...current,
    ...rest,
    scoreWeights: { ...current.scoreWeights, ...(scoreWeights ?? {}) },
  };
}

/** Admin yanıtı — şifreli kimlik bilgisi ASLA dönmez; yalnızca bağlı olup olmadığı ve maskeli e-posta. */
export function toCrmSettingsDto(settings: CrmSettings) {
  const { searchConsole, ...rest } = settings;
  return {
    ...rest,
    searchConsole: {
      propertyUrl: searchConsole.propertyUrl,
      connected: Boolean(searchConsole.credentialsCiphertext),
      clientEmailMasked: searchConsole.clientEmail ? maskEmail(searchConsole.clientEmail) : null,
      lastSyncAt: searchConsole.lastSyncAt,
      lastSyncError: searchConsole.lastSyncError,
      initialSyncDone: searchConsole.initialSyncDone,
    },
  };
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 3);
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
