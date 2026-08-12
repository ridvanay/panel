import type { FastifyInstance } from "fastify";
import type { ContentEntityType, Locale } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ConflictError } from "./errors";
import { slugify } from "./slug";
import type { ContentLocalizationDto } from "../schemas/entities";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — ortak yardımcı (bkz. .claude/architect-scope-i18n.md,
 * bağlayıcı karar dokümanı). `pages.routes.ts`/`blog.routes.ts`'te KOPYALANMIŞ olan
 * `applyLocale()` mantığı buraya taşındı; `Product`/`PortfolioItem` de artık AYNI yardımcıyı
 * kullanıyor (önceden bu iki entity'de çeviri yazılabiliyor ama okunamıyordu — §0.1b).
 */

export const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

/** `POST /admin/locales` — "küçük harf, `_` → `-`" normalizasyonu (bkz. openapi.yaml). */
export function normalizeLocaleCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Savunma ağı — `Locale` tablosu (beklenmedik şekilde) boşsa site tamamen kilitlenmesin.
 * §2.1 seed garantisi (migration ile birlikte `tr`/`en`) altında bu normalde asla
 * tetiklenmez; yalnızca test/geliştirme ortamlarında TRUNCATE gibi işlemler seed'i
 * silebilir (bkz. tests/helpers/reset-db.ts). Üretimde Locale tablosu boşsa bu, sistemin
 * "yeni dil = veri satırı" ilkesini ÇİĞNEMEZ — yalnızca çökme yerine `tr`'ye düşer.
 */
const FALLBACK_DEFAULT_LOCALE: Locale = {
  code: "tr",
  label: "Türkçe",
  nativeLabel: "Türkçe",
  isDefault: true,
  enabled: true,
  sortOrder: 0,
  hreflang: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

export interface LocaleSet {
  /** `enabled: true` diller, `sortOrder` artan. Varsayılan dil HER ZAMAN içindedir. */
  enabled: Locale[];
  /** `enabled` içindeki `isDefault: true` satır. */
  default: Locale;
}

export async function listAllLocales(app: FastifyInstance): Promise<Locale[]> {
  return app.prisma.locale.findMany({ orderBy: { sortOrder: "asc" } });
}

/** Public `/locales` + iç çözümleme için TEK sorguda etkin diller + varsayılan dil. */
export async function getLocaleSet(app: FastifyInstance): Promise<LocaleSet> {
  const enabled = await app.prisma.locale.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  if (enabled.length === 0) return { enabled: [FALLBACK_DEFAULT_LOCALE], default: FALLBACK_DEFAULT_LOCALE };
  const defaultLocale = enabled.find((locale) => locale.isDefault) ?? enabled[0]!;
  return { enabled, default: defaultLocale };
}

/**
 * `?locale=` query değerini geçerli/etkin bir koda çözer. Bilinmeyen/devre dışı bir kod
 * VEYA varsayılan dille eşleşen bir kod → `undefined` (override YOK, kanonik alanlar
 * olduğu gibi döner) — bkz. openapi.yaml `LocaleQuery` açıklaması: **hata DEĞİL, sessiz
 * fallback** (`400` DÖNMEZ).
 */
export function resolveEffectiveLocaleCode(localeSet: LocaleSet, requestedRaw?: string): string | undefined {
  if (!requestedRaw) return undefined;
  const normalized = requestedRaw.trim().toLowerCase();
  const match = localeSet.enabled.find((locale) => locale.code === normalized);
  if (!match || match.isDefault) return undefined;
  return match.code;
}

/**
 * `translations` JSON'undan `locale` için override kaydını döner. §2.4 geçiş toleransı:
 * önce küçük harf anahtar denenir, bulunamazsa BÜYÜK harf (eski veri) denenir. Yazma yolu
 * YALNIZCA küçük harf üretir — bu tolerans geçicidir (`chore/i18n-drop-uppercase-fallback`).
 */
function getTranslationOverride(translations: unknown, locale: string): Record<string, unknown> | undefined {
  const map = (translations ?? {}) as Record<string, unknown>;
  const lower = map[locale];
  if (lower && typeof lower === "object") return lower as Record<string, unknown>;
  const upper = map[locale.toUpperCase()];
  if (upper && typeof upper === "object") return upper as Record<string, unknown>;
  return undefined;
}

/** §1.4 — "çevrildi mi?" kuralı: en azından anlamlı (boş olmayan) bir `title` var mı. */
export function isLocaleTranslated(translations: unknown, locale: string): boolean {
  const title = getTranslationOverride(translations, locale)?.title;
  return typeof title === "string" && title.trim().length > 0;
}

/**
 * §5 — Alan bazlı sessiz fallback: `stringFields`/`arrayFields` listesindeki her alan için
 * `translations[locale]`'de dolu bir override VARSA onu kullanır, yoksa kanonik (varsayılan
 * dil) değer korunur. Boş string de "yok" sayılır (§5: "bulunmayan VEYA BOŞ STRING").
 */
export function applyFieldLocalization<T extends { translations: unknown }>(
  entity: T,
  locale: string,
  stringFields: readonly (keyof T & string)[],
  arrayFields: readonly (keyof T & string)[] = []
): T {
  const override = getTranslationOverride(entity.translations, locale);
  if (!override) return entity;

  const patched: Record<string, unknown> = { ...entity };
  for (const field of stringFields) {
    const value = override[field];
    if (typeof value === "string" && value.length > 0) patched[field] = value;
  }
  for (const field of arrayFields) {
    const value = override[field];
    if (Array.isArray(value)) patched[field] = value;
  }
  return patched as T;
}

export interface LocalizableEntity {
  id: string;
  /** Varsayılan dilin kanonik slug'ı. */
  slug: string;
  translations: unknown;
}

/**
 * Bir veya daha fazla içerik için TEK sorguda `ContentLocalization[]` üretir (`entityId
 * IN (...)` — liste uçlarında N+1 YASAK, bkz. §9 backend-agent madde 6). Varsayılan dil
 * HER ZAMAN `translated: true` ve kanonik slug ile döner (ContentSlug satırı olsun/olmasın —
 * §2.4 migration adım 3 zaten bu satırı da üretir, ama DTO seviyesinde buna bağımlı DEĞİLİZ).
 */
export async function attachLocalizations<T extends LocalizableEntity>(
  app: FastifyInstance,
  entityType: ContentEntityType,
  items: T[]
): Promise<Map<string, ContentLocalizationDto[]>> {
  const result = new Map<string, ContentLocalizationDto[]>();
  if (items.length === 0) return result;

  const { enabled } = await getLocaleSet(app);
  const rows = await app.prisma.contentSlug.findMany({
    where: { entityType, entityId: { in: items.map((item) => item.id) } },
  });

  const rowsByEntity = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = rowsByEntity.get(row.entityId);
    if (list) list.push(row);
    else rowsByEntity.set(row.entityId, [row]);
  }

  for (const item of items) {
    const itemRows = rowsByEntity.get(item.id) ?? [];
    const localizations = enabled.map((locale): ContentLocalizationDto => {
      if (locale.isDefault) return { locale: locale.code, slug: item.slug, translated: true };
      const row = itemRows.find((r) => r.locale === locale.code);
      return row
        ? { locale: locale.code, slug: row.slug, translated: true }
        : { locale: locale.code, slug: item.slug, translated: false };
    });
    result.set(item.id, localizations);
  }

  return result;
}

/** Tek bir içerik için `attachLocalizations`'ın kısayolu. */
export async function attachLocalizationsOne<T extends LocalizableEntity>(
  app: FastifyInstance,
  entityType: ContentEntityType,
  item: T
): Promise<ContentLocalizationDto[]> {
  const map = await attachLocalizations(app, entityType, [item]);
  return map.get(item.id) ?? [];
}

/**
 * §4/§12.2 — slug çözümleme: (1) `ContentSlug(locale, slug)` tam eşleşme (bulunan satırın
 * `entityType`'ı İSTENENLE eşleşmiyorsa yok sayılır — bkz. `@@unique([locale, slug])`
 * entityType SINIRI olmadığından farklı bir tipe ait olabilir), (2) çağıran taraf bulamazsa
 * kanonik `slug` kolonuyla WHERE'e düşer. Bu fonksiyon yalnızca adım (1)'i yapar.
 */
export async function resolveEntityIdBySlug(
  app: FastifyInstance,
  entityType: ContentEntityType,
  slug: string,
  effectiveLocaleCode: string | undefined
): Promise<string | undefined> {
  if (!effectiveLocaleCode) return undefined;
  const row = await app.prisma.contentSlug.findUnique({ where: { locale_slug: { locale: effectiveLocaleCode, slug } } });
  if (!row || row.entityType !== entityType) return undefined;
  return row.entityId;
}

function slugConflictError(err: unknown, slug: string, locale: string): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return new ConflictError(`"${slug}" slug'ı "${locale}" dilinde başka bir içerik tarafından kullanılıyor.`);
  }
  return err as Error;
}

async function upsertContentSlug(
  tx: Prisma.TransactionClient,
  entityType: ContentEntityType,
  entityId: string,
  locale: string,
  slug: string
): Promise<void> {
  try {
    await tx.contentSlug.upsert({
      where: { entityType_entityId_locale: { entityType, entityId, locale } },
      create: { entityType, entityId, locale, slug },
      update: { slug },
    });
  } catch (err) {
    throw slugConflictError(err, slug, locale);
  }
}

/**
 * §9 backend-agent madde 5 — `ContentSlug` yazma yolu: yazımdan HEMEN SONRA, nihai
 * (merge edilmiş) `translations` durumuyla TAM eşitler:
 *  - Varsayılan dil için HER ZAMAN bir satır vardır (kanonik slug'a işaret eder).
 *  - Diğer her ETKİN dil için: `translations[locale].title` anlamlı ise satır var/güncel
 *    (`slug` = `translations[locale].slug` verilmişse o, yoksa kanonik slug — kanonik slug
 *    SONRADAN değişirse bu "fallback" satırlar da bir sonraki yazımda otomatik güncellenir,
 *    yani asla bayatlamaz); değilse (çeviri silinmiş/başlıksız) satır YOK.
 *  - Slug çakışması (`@@unique([locale, slug])`) → `ConflictError` (409, 422 DEĞİL).
 *
 * AYNI transaction (`tx`) içinde çağrılmalıdır — içerik güncellemesiyle ATOMIK olmalı.
 */
export async function syncContentSlugs(
  tx: Prisma.TransactionClient,
  enabledLocales: Locale[],
  entityType: ContentEntityType,
  entityId: string,
  canonicalSlug: string,
  translations: unknown
): Promise<void> {
  const map = (translations ?? {}) as Record<string, unknown>;

  for (const locale of enabledLocales) {
    if (locale.isDefault) {
      await upsertContentSlug(tx, entityType, entityId, locale.code, canonicalSlug);
      continue;
    }

    const fields = map[locale.code];
    const title = fields && typeof fields === "object" ? (fields as Record<string, unknown>).title : undefined;
    const hasTranslation = typeof title === "string" && title.trim().length > 0;

    if (!hasTranslation) {
      await tx.contentSlug.deleteMany({ where: { entityType, entityId, locale: locale.code } });
      continue;
    }

    const localeSlugRaw = (fields as Record<string, unknown>).slug;
    const slug =
      typeof localeSlugRaw === "string" && localeSlugRaw.trim().length > 0 ? slugify(localeSlugRaw) : canonicalSlug;

    await upsertContentSlug(tx, entityType, entityId, locale.code, slug);
  }
}

/**
 * §9 backend-agent madde 7 — içerik KALICI silme yollarında çağrılır (aynı transaction).
 * `ContentSlug`'ın içerik tablolarına FK'si YOKTUR (polimorfik `entityType`+`entityId`) —
 * bu yüzden satırlar OTOMATİK gitmez, elle silinmesi gerekir. Soft-delete (çöp kutusu) BUNU
 * ÇAĞIRMAZ — geri yükleme slug'ı korumalıdır.
 */
export async function deleteContentSlugsForEntity(
  tx: Prisma.TransactionClient,
  entityType: ContentEntityType,
  entityId: string
): Promise<void> {
  await tx.contentSlug.deleteMany({ where: { entityType, entityId } });
}

/**
 * `translations` PATCH gövdesini (locale bazında shallow merge + `null` = sil, bkz.
 * openapi.yaml `ContentTranslations` açıklaması) mevcut kayıttaki `translations`'a uygular.
 * Merge SONUCU (silinen anahtarlar dahi olmadan) döner — `syncContentSlugs`'a doğrudan
 * geçirilebilir.
 */
export function mergeTranslations(
  existing: unknown,
  incoming: Record<string, Record<string, unknown> | null>
): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {
    ...((existing as Record<string, Record<string, unknown>> | null) ?? {}),
  };

  for (const [rawLocale, fields] of Object.entries(incoming)) {
    const locale = rawLocale.toLowerCase();
    if (fields === null) {
      delete merged[locale];
      continue;
    }
    merged[locale] = { ...(merged[locale] ?? {}), ...fields };
  }

  return merged;
}
