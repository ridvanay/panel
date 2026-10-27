/**
 * Paket L (2026-10-23) — çevrilecek içeriğin dışa aktarımı ve çevirilerin içe aktarımı.
 * Scriptler: `scripts/export-translatable-content.ts` (salt okuma), `scripts/import-translations.ts`.
 * Rapor: `docs/prompts/2026-10-23-L-RAPOR.md`.
 *
 * Akış: export (EN kanonik metin) → ayrı oturumda çeviri (`translations.<dil>` doldurulur) → import.
 *
 * İçe aktarma KURALLARI:
 *  - Yalnızca `translations.es|de|ar|ru` (ve koşullu `tr`, bkz. Paket O) yazılır. Kanonik kolonlara ve
 *    `translations.en`'e ASLA dokunulmaz; dosyada başka bir dil anahtarı varsa işlem reddedilir.
 *  - Yalnızca `translations` kolonu olan içerik yazılabilir: sayfa (`Page`), doktor profili ve
 *    (Paket O'dan itibaren) uzmanlık, menü öğesi, footer sütunu/bağlantısı. Site ayarları hâlâ
 *    "importable: false" (çeviri kolonu yok).
 *  - Yasal sayfalar (`isLegalDocument`) export'a girmez, import'ta da reddedilir (yeni dillerde EN'e düşer).
 *  - Sayfa bloklarında çevirmen yalnızca metni değiştirebilir: ağaç yapısı, id/tip, bağlantılar,
 *    URL'ler, renkler ve sayılar kanonikle birebir aynı olmalıdır. HTML sanitize edilir.
 *  - Kanonik metin export'tan sonra değiştiyse o kalem atlanır (çeviri bayat olabilir).
 *  - Varsayılan kuru çalışma; `--confirm` ile yedek → tek transaction → audit → önbellek yenileme.
 *
 * Paket O (2026-10-23):
 *  - `translations.tr` de içe aktarılabilir (varsayılan dil TR'nin kendi çevirisi; kanonik EN). TR
 *    YALNIZCA hedefte TR çevirisi yoksa ya da `overwriteLocales` içinde "tr" varsa
 *    (`--overwrite-locale=tr`) yazılır. `en` anahtarı her zaman reddedilir — kanonik metne dokunulmaz.
 *  - Export `only` seçicileriyle (`--only=page:home,doctor:vahit-mutlu`) yalnızca seçilen kalemleri yazar.
 *  - Uzmanlık (`name`, `description`), menü öğesi (`label`), footer sütunu (`title`) ve bağlantısı
 *    (`label`) içe aktarılabilir.
 *
 * Bayatlık (2026-10-24): `updatedAt` KULLANILMAZ — sayfa görüntüleme sayacı (`POST /pages/:slug/view`
 * → `viewCount` artışı) `Page.updatedAt`'i her ziyarette değiştirir. Bunun yerine export'taki
 * kanonik alanlar (`fields`) ile kaydın şimdiki kanonik alanları, anahtar sırasından bağımsız
 * deterministik bir özetle (`canonicalHash`) karşılaştırılır; tüm türlerde aynı kural.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeRichHtml } from "./html-sanitize";
import { syncContentSlugs } from "./localization";
import { CACHE_TAGS, triggerPublicPageRevalidation, triggerTagRevalidation } from "./revalidate";
import { sanitizePageBlocks } from "../modules/pages/lib/sanitize-blocks";
import { PageBlockListSchema } from "../modules/pages/pages.schemas";

// Paket T (2026-10-27) — ro/fr/sr-latn (Sırpça Latin) eklendi.
export const TARGET_LOCALES = ["es", "de", "ar", "ru", "ro", "fr", "sr-latn"] as const;
/** İçe aktarılabilen tüm diller: hedef diller + varsayılan dil TR (koşullu; bkz. dosya başı). */
export const IMPORT_LOCALES = ["tr", ...TARGET_LOCALES] as const;
export type TargetLocale = (typeof IMPORT_LOCALES)[number];
/** Mevcut çeviri varken yalnızca açık izinle (`--overwrite-locale=tr`) yazılan diller. */
const GUARDED_LOCALES: readonly string[] = ["tr"];
export const EXPORT_KIND = "translatable-content-export";
export const EXPORT_VERSION = 1;
export const IMPORT_CONFIRM_KEY = "import-translations";
export const RESTORE_CONFIRM_KEY = "restore-translations";
export const IMPORT_AUDIT_ACTION = "content.translations.imported";
export const RESTORE_AUDIT_ACTION = "content.translations.restored";

export class TranslationImportError extends Error {}

type ItemType = "page" | "doctor" | "specialty" | "navigationItem" | "footerColumn" | "footerLink" | "siteSettings";

export interface ExportItem {
  type: ItemType;
  id: string;
  /** İnsan okuması için (slug/etiket). */
  ref: string;
  importable: boolean;
  note?: string;
  /** Kaydın export anındaki `updatedAt`'i — yalnızca bilgi (bayatlık `canonicalHash` ile kontrol edilir). */
  updatedAt: string | null;
  fields: Record<string, unknown>;
  translations: Partial<Record<TargetLocale, Record<string, unknown> | null>>;
  /** Paket O — kayıtta zaten dolu olan çeviri dilleri (bilgi; `tr` doluysa üzerine yazılmaz). */
  existingLocales?: string[];
}

export interface TranslationExport {
  kind: typeof EXPORT_KIND;
  version: number;
  exportedAt: string;
  canonicalLocale: string;
  targetLocales: readonly string[];
  instructions: string;
  items: ExportItem[];
}

type Db = Pick<
  PrismaClient,
  | "page"
  | "doctorProfile"
  | "specialty"
  | "navigationItem"
  | "footerColumn"
  | "footerLink"
  | "siteSettings"
  | "locale"
  | "contentSlug"
  | "auditLog"
  | "$transaction"
>;

const NO_COLUMN_NOTE = "Bu modelde çeviri kolonu yok; içe aktarılmaz (ayrı bir migration gerektirir).";

/**
 * Paket O — basit (düz metin alanlı) içerik türleri: alan → { en fazla karakter, zorunlu mu }.
 * Kanonik kolon adlarıyla AYNI alan adları `translations.<dil>` altına yazılır.
 */
type EntityType = "specialty" | "navigationItem" | "footerColumn" | "footerLink";
const ENTITY_FIELDS: Record<EntityType, Record<string, { max: number; required: boolean }>> = {
  specialty: { name: { max: 80, required: true }, description: { max: 500, required: false } },
  navigationItem: { label: { max: 80, required: true } },
  footerColumn: { title: { max: 80, required: true } },
  footerLink: { label: { max: 80, required: true } },
};
const isEntityType = (type: string): type is EntityType => type in ENTITY_FIELDS;

interface EntityRow {
  id: string;
  translations: unknown;
  updatedAt?: Date;
  [field: string]: unknown;
}

/** Export'a giren (çevrilecek) kanonik alanlar — export ve bayatlık kontrolü AYNI listeyi kullanır. */
const PAGE_CANONICAL_FIELDS = ["title", "seoTitle", "seoDescription", "ogTitle", "blocks"] as const;
const DOCTOR_CANONICAL_FIELDS = ["title", "bio", "aboutHtml", "subSpecialty"] as const;

function canonicalFieldsOf(type: "page" | "doctor" | EntityType, row: Record<string, unknown>): Record<string, unknown> {
  const fields: readonly string[] = type === "page" ? PAGE_CANONICAL_FIELDS : type === "doctor" ? DOCTOR_CANONICAL_FIELDS : Object.keys(ENTITY_FIELDS[type]);
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

/** Anahtar sırasından bağımsız JSON (nesne anahtarları sıralı; `undefined` → yok sayılır). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Kanonik alanların deterministik özeti (sha256). Eksik alan `null` sayılır. */
export function canonicalHash(fields: Record<string, unknown> | undefined): string {
  const normalized = Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, v ?? null]));
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

async function findEntity(db: Db, type: EntityType, id: string): Promise<EntityRow | null> {
  switch (type) {
    case "specialty":
      return db.specialty.findUnique({ where: { id } });
    case "navigationItem":
      return db.navigationItem.findUnique({ where: { id } });
    case "footerColumn":
      return db.footerColumn.findUnique({ where: { id } });
    case "footerLink":
      return db.footerLink.findUnique({ where: { id } });
  }
}

async function updateEntityTranslations(tx: Prisma.TransactionClient, type: EntityType, id: string, translations: Prisma.InputJsonValue) {
  const args = { where: { id }, data: { translations } };
  switch (type) {
    case "specialty":
      return tx.specialty.update(args);
    case "navigationItem":
      return tx.navigationItem.update(args);
    case "footerColumn":
      return tx.footerColumn.update(args);
    case "footerLink":
      return tx.footerLink.update(args);
  }
}

const entityKey = (type: string, id: string) => `${type}:${id}`;

const INSTRUCTIONS =
  "Her kalemde `fields` kanonik (EN) metindir. Çeviriyi aynı alan adlarıyla `translations.<tr|es|de|ar|ru>` içine yazın. " +
  "`translations.tr` yalnızca hedefte TR çevirisi yoksa (ya da --overwrite-locale=tr ile) yazılır; `existingLocales` mevcut çevirileri gösterir. " +
  "Sayfa `blocks` ağacında YALNIZCA görünen metinleri çevirin: yapı, id/type, bağlantı (href/url), görsel, renk ve sayı değerleri aynen kalmalıdır. " +
  "`importable: false` kalemler bilgi amaçlıdır, içe aktarılmaz. Boş bırakılan (null) dil yazılmaz.";

/** Kayıttaki `translations` JSON'unda dolu olan diller (export'ta çevirmene bilgi). */
function filledLocales(translations: unknown): string[] {
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) return [];
  return Object.entries(translations as Record<string, unknown>)
    .filter(([, v]) => v && typeof v === "object" && Object.keys(v as object).length > 0)
    .map(([k]) => k)
    .sort();
}

/**
 * `--only` seçicileri: `tip:ref` ya da `tip:id` (örn. `page:home`, `doctor:vahit-mutlu`). Virgülle
 * çoklu. Eşleşmeyen seçiciler `unmatched` içinde döner (script hata verir).
 */
export function filterExportItems(items: ExportItem[], selectors: string[]): { items: ExportItem[]; unmatched: string[] } {
  const parsed = selectors
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const idx = raw.indexOf(":");
      if (idx <= 0 || idx === raw.length - 1) throw new TranslationImportError(`Geçersiz --only seçicisi "${raw}" (beklenen tip:ref, örn. page:home).`);
      return { raw, type: raw.slice(0, idx), key: raw.slice(idx + 1) };
    });
  const matches = (item: ExportItem, sel: { type: string; key: string }) => item.type === sel.type && (item.ref === sel.key || item.id === sel.key);
  return {
    items: items.filter((item) => parsed.some((sel) => matches(item, sel))),
    unmatched: parsed.filter((sel) => !items.some((item) => matches(item, sel))).map((sel) => sel.raw),
  };
}

/* ------------------------------------------------------------------ */
/* Export (salt okuma)                                                 */
/* ------------------------------------------------------------------ */

export async function buildTranslationExport(
  db: Db,
  now = new Date(),
  options: { only?: string[]; locales?: string[] } = {}
): Promise<TranslationExport> {
  // Paket T — `--locales=ro,fr,sr-latn`: çeviri yuvaları yalnızca bu dillerle (mevcut diller dosyada hiç yer almaz,
  // dolayısıyla import'ta yeniden yazılamaz).
  const locales = options.locales?.length ? options.locales : [...IMPORT_LOCALES];
  const unknownLocales = locales.filter((l) => !(IMPORT_LOCALES as readonly string[]).includes(l));
  if (unknownLocales.length) throw new TranslationImportError(`--locales bilinmeyen dil: ${unknownLocales.join(", ")} (yalnızca ${IMPORT_LOCALES.join(", ")}).`);
  const emptyTranslations = (): ExportItem["translations"] => Object.fromEntries(locales.map((l) => [l, null]));
  const defaultLocale = (await db.locale.findFirst({ where: { isDefault: true } }))?.code ?? "en";
  const items: ExportItem[] = [];

  const pages = await db.page.findMany({
    where: { status: "PUBLISHED", deletedAt: null, isLegalDocument: false },
    orderBy: { slug: "asc" },
  });
  for (const p of pages) {
    items.push({
      type: "page",
      id: p.id,
      ref: p.slug,
      importable: true,
      updatedAt: p.updatedAt.toISOString(),
      fields: canonicalFieldsOf("page", p),
      translations: emptyTranslations(),
      existingLocales: filledLocales(p.translations),
    });
  }

  const doctors = await db.doctorProfile.findMany({ where: { isActive: true, archivedAt: null }, orderBy: { seq: "asc" } });
  for (const d of doctors) {
    items.push({
      type: "doctor",
      id: d.id,
      ref: d.slug,
      importable: true,
      note: "cvEntries ve publications çevrilmez.",
      updatedAt: d.updatedAt.toISOString(),
      fields: canonicalFieldsOf("doctor", d),
      translations: emptyTranslations(),
      existingLocales: filledLocales(d.translations),
    });
  }

  const entityItem = (type: EntityType, row: EntityRow, ref: string, fields: Record<string, unknown>): ExportItem => ({
    type,
    id: row.id,
    ref,
    importable: true,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    fields,
    translations: emptyTranslations(),
    existingLocales: filledLocales(row.translations),
  });
  for (const s of await db.specialty.findMany({ where: { isActive: true }, orderBy: { order: "asc" } })) {
    items.push(entityItem("specialty", s, s.slug, { name: s.name, description: s.description }));
  }
  for (const n of await db.navigationItem.findMany({ orderBy: [{ parentId: "asc" }, { order: "asc" }] })) {
    items.push(entityItem("navigationItem", n, n.href, { label: n.label }));
  }
  for (const c of await db.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } })) {
    items.push(entityItem("footerColumn", c, c.title, { title: c.title }));
    for (const l of c.links) items.push(entityItem("footerLink", l, l.href, { label: l.label }));
  }
  const settings = await db.siteSettings.findFirst();
  if (settings) {
    items.push({
      type: "siteSettings",
      id: settings.id,
      ref: "site-settings",
      importable: false,
      note: NO_COLUMN_NOTE,
      updatedAt: null,
      fields: { tagline: settings.tagline, headerCtaLabel: settings.headerCtaLabel, footerCopyrightText: settings.footerCopyrightText },
      translations: emptyTranslations(),
    });
  }

  let selected = items;
  if (options.only?.length) {
    const filtered = filterExportItems(items, options.only);
    if (filtered.unmatched.length) throw new TranslationImportError(`--only eşleşmeyen kalem: ${filtered.unmatched.join(", ")}`);
    selected = filtered.items;
  }

  return {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    canonicalLocale: defaultLocale,
    targetLocales: locales,
    instructions: INSTRUCTIONS,
    items: selected,
  };
}

export function summarizeExport(data: TranslationExport): string {
  const byType = new Map<string, { total: number; importable: boolean }>();
  for (const item of data.items) {
    const entry = byType.get(item.type) ?? { total: 0, importable: item.importable };
    entry.total++;
    byType.set(item.type, entry);
  }
  return [...byType].map(([type, v]) => `  ${type}: ${v.total}${v.importable ? "" : " (yalnızca bilgi, içe aktarılmaz)"}`).join("\n");
}

/* ------------------------------------------------------------------ */
/* Doğrulama                                                           */
/* ------------------------------------------------------------------ */

const PROTECTED_KEY = /^(id|type|icon|variant|href|url|src|slug|align|layout|source|shape|imageShape|style|effect|position|direction|target|rel|columns|kind|.*Id|.*Ids|.*Url|.*Href|.*Color|.*Media)$/;
const NON_TEXT_VALUE = /^(https?:\/\/|\/|#|mailto:|tel:|data:)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|^#[0-9a-f]{3,8}$|^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ms|s)?$/i;

/** Çevrilmiş blok ağacı kanonikle aynı yapıda mı? Yalnızca metin olan string yaprakları farklı olabilir. */
export function compareBlockStructure(canonical: unknown, translated: unknown, where = "blocks"): string[] {
  if (Array.isArray(canonical)) {
    if (!Array.isArray(translated)) return [`${where}: dizi bekleniyordu`];
    if (canonical.length !== translated.length) return [`${where}: öğe sayısı farklı (${canonical.length} ≠ ${translated.length})`];
    return canonical.flatMap((c, i) => compareBlockStructure(c, translated[i], `${where}[${i}]`));
  }
  if (canonical && typeof canonical === "object") {
    if (!translated || typeof translated !== "object" || Array.isArray(translated)) return [`${where}: nesne bekleniyordu`];
    const a = Object.keys(canonical).sort();
    const b = Object.keys(translated).sort();
    if (a.join() !== b.join()) return [`${where}: alan kümesi farklı`];
    return a.flatMap((key) => {
      const c = (canonical as Record<string, unknown>)[key];
      const t = (translated as Record<string, unknown>)[key];
      if (typeof c === "string" && (PROTECTED_KEY.test(key) || NON_TEXT_VALUE.test(c.trim()))) {
        return c === t ? [] : [`${where}.${key}: çevrilemez değer değiştirilmiş`];
      }
      return compareBlockStructure(c, t, `${where}.${key}`);
    });
  }
  if (typeof canonical === "string") {
    if (typeof translated !== "string") return [`${where}: metin bekleniyordu`];
    // Zengin metin: HTML içindeki bağlantı/kaynak hedefleri (href/src) aynı sırayla korunmalı.
    return sameHtmlTargets(canonical, translated) ? [] : [`${where}: HTML içindeki bağlantı/kaynak hedefleri değiştirilmiş`];
  }
  return canonical === translated ? [] : [`${where}: değer değiştirilmiş`];
}

const HTML_TAG = /<[a-z!/][^>]*>/i;
const HTML_TARGET_ATTR = /\b(?:href|src|srcset|action|formaction|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/** HTML'deki href/src/... hedeflerinin sıralı listesi (metin olmayan string'lerde boş). */
export function htmlTargets(html: string): string[] {
  if (!html.includes("<")) return [];
  return [...html.matchAll(HTML_TARGET_ATTR)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim());
}

export function sameHtmlTargets(canonical: string, translated: string): boolean {
  return htmlTargets(canonical).join("\u0000") === htmlTargets(translated).join("\u0000");
}

function plainText(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw new TranslationImportError(`${field} zorunlu.`);
    return null;
  }
  if (typeof value !== "string") throw new TranslationImportError(`${field} metin olmalı.`);
  const trimmed = value.trim();
  if (HTML_TAG.test(trimmed)) throw new TranslationImportError(`${field} HTML içeremez.`);
  if (trimmed.length > max) throw new TranslationImportError(`${field} en fazla ${max} karakter.`);
  return trimmed;
}

export interface PreparedPage {
  id: string;
  ref: string;
  locale: TargetLocale;
  value: { title: string; seoTitle?: string; seoDescription?: string; ogTitle?: string; blocks: unknown[] };
}

export interface PreparedDoctor {
  id: string;
  ref: string;
  locale: TargetLocale;
  value: { title: string; bio: string; aboutHtml?: string; subSpecialty?: string };
}

/** Paket O — uzmanlık / menü / footer çevirisi. */
export interface PreparedEntity {
  type: EntityType;
  id: string;
  ref: string;
  locale: TargetLocale;
  value: Record<string, string>;
}

export interface ImportPlan {
  pages: PreparedPage[];
  doctors: PreparedDoctor[];
  entities: PreparedEntity[];
  skipped: { type: string; ref: string; locale?: string; reason: string }[];
  /** Plan anındaki `translations` damgaları — yazma sırasında eşzamanlı değişiklik kontrolü. */
  /**
   * Plan anındaki damgalar — yazma sırasında eşzamanlı değişiklik kontrolü: `translations` (çeviriler
   * değişmiş mi) ve `canonical` (kanonik metin değişmiş mi; `updatedAt` DEĞİL — sayaç onu da değiştirir).
   */
  stamps: { pages: Record<string, string>; doctors: Record<string, string>; canonical: Record<string, string>; entities: Record<string, string> };
}

export function prepareEntityTranslation(type: EntityType, input: Record<string, unknown>): Record<string, string> {
  const spec = ENTITY_FIELDS[type];
  const unknownKeys = Object.keys(input).filter((key) => !(key in spec));
  if (unknownKeys.length) throw new TranslationImportError(`Bilinmeyen alan: ${unknownKeys.join(", ")}`);
  const value: Record<string, string> = {};
  for (const [field, { max, required }] of Object.entries(spec)) {
    const v = plainText(input[field], field, max, required);
    if (v) value[field] = v;
  }
  return value;
}

/** Export'taki kanonik metin şimdikiyle aynı mı (tüm türlerde aynı kural; `updatedAt`'e bakılmaz). */
function isCanonicalStale(type: "page" | "doctor" | EntityType, row: Record<string, unknown>, exported: Record<string, unknown>): boolean {
  return canonicalHash(canonicalFieldsOf(type, row)) !== canonicalHash(exported);
}

const STALE_REASON = "Kanonik metin export'tan sonra değişmiş; yeniden export/çeviri gerekir.";

export async function readTranslationFile(file: string): Promise<TranslationExport> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as TranslationExport;
  if (parsed?.kind !== EXPORT_KIND || parsed.version !== EXPORT_VERSION || !Array.isArray(parsed.items)) {
    throw new TranslationImportError("Geçerli bir çeviri dosyası değil (kind/version).");
  }
  for (const item of parsed.items) {
    for (const key of Object.keys(item.translations ?? {})) {
      if (!(IMPORT_LOCALES as readonly string[]).includes(key)) {
        throw new TranslationImportError(`"${item.type}:${item.ref}" kaleminde izin verilmeyen dil anahtarı "${key}" var (yalnızca ${IMPORT_LOCALES.join(", ")}).`);
      }
    }
  }
  return parsed;
}

export interface ImportPlanOptions {
  /** `--overwrite-locale=tr` — mevcut TR çevirisinin üzerine yazılmasına izin verir. */
  overwriteLocales?: string[];
}

/**
 * Korunan dil (TR) hedefte zaten doluysa ve açık izin yoksa yazılmaz: atlananlara eklenir.
 * Dönen liste yazılabilecek dillerdir.
 */
function guardLocales(
  plan: ImportPlan,
  item: { type: string; ref: string },
  filled: TargetLocale[],
  current: unknown,
  options: ImportPlanOptions
): TargetLocale[] {
  const existing = filledLocales(current);
  return filled.filter((locale) => {
    if (!GUARDED_LOCALES.includes(locale) || !existing.includes(locale) || options.overwriteLocales?.includes(locale)) return true;
    plan.skipped.push({ type: item.type, ref: item.ref, locale, reason: `Hedefte ${locale.toUpperCase()} çevirisi zaten var; üzerine yazmak için --overwrite-locale=${locale}.` });
    return false;
  });
}

export async function buildImportPlan(db: Db, data: TranslationExport, options: ImportPlanOptions = {}): Promise<ImportPlan> {
  const plan: ImportPlan = { pages: [], doctors: [], entities: [], skipped: [], stamps: { pages: {}, doctors: {}, canonical: {}, entities: {} } };

  for (const item of data.items) {
    const filled = IMPORT_LOCALES.filter((l) => item.translations?.[l]);
    if (filled.length === 0) continue;
    if (isEntityType(item.type)) {
      const type = item.type;
      const row = await findEntity(db, type, item.id);
      if (!row) {
        plan.skipped.push({ type, ref: item.ref, reason: "Kayıt bulunamadı (menü/footer yeniden kaydedildiyse yeniden export alın)." });
        continue;
      }
      if (isCanonicalStale(type, row, item.fields)) {
        plan.skipped.push({ type, ref: item.ref, reason: STALE_REASON });
        continue;
      }
      plan.stamps.entities[entityKey(type, row.id)] = stableStringify(row.translations ?? {});
      plan.stamps.canonical[entityKey(type, row.id)] = canonicalHash(canonicalFieldsOf(type, row));
      for (const locale of guardLocales(plan, item, filled, row.translations, options)) {
        try {
          plan.entities.push({ type, id: row.id, ref: item.ref, locale, value: prepareEntityTranslation(type, item.translations[locale]!) });
        } catch (err) {
          plan.skipped.push({ type, ref: item.ref, locale, reason: (err as Error).message });
        }
      }
      continue;
    }
    if (item.type !== "page" && item.type !== "doctor") {
      plan.skipped.push({ type: item.type, ref: item.ref, reason: NO_COLUMN_NOTE });
      continue;
    }

    if (item.type === "page") {
      const page = await db.page.findUnique({ where: { id: item.id } });
      if (!page || page.deletedAt) {
        plan.skipped.push({ type: "page", ref: item.ref, reason: "Sayfa bulunamadı." });
        continue;
      }
      if (page.isLegalDocument) {
        plan.skipped.push({ type: "page", ref: item.ref, reason: "Yasal sayfa — çevrilmez (yeni dillerde EN'e düşer)." });
        continue;
      }
      if (isCanonicalStale("page", page, item.fields)) {
        plan.skipped.push({ type: "page", ref: item.ref, reason: STALE_REASON });
        continue;
      }
      plan.stamps.pages[page.id] = stableStringify(page.translations ?? {});
      plan.stamps.canonical[entityKey("page", page.id)] = canonicalHash(canonicalFieldsOf("page", page));
      for (const locale of guardLocales(plan, item, filled, page.translations, options)) {
        try {
          plan.pages.push({ id: page.id, ref: item.ref, locale, value: preparePageTranslation(page.blocks, item.translations[locale]!) });
        } catch (err) {
          plan.skipped.push({ type: "page", ref: item.ref, locale, reason: (err as Error).message });
        }
      }
      continue;
    }

    const doctor = await db.doctorProfile.findUnique({ where: { id: item.id } });
    if (!doctor) {
      plan.skipped.push({ type: "doctor", ref: item.ref, reason: "Doktor bulunamadı." });
      continue;
    }
    if (isCanonicalStale("doctor", doctor, item.fields)) {
      plan.skipped.push({ type: "doctor", ref: item.ref, reason: STALE_REASON });
      continue;
    }
    plan.stamps.doctors[doctor.id] = stableStringify(doctor.translations ?? {});
    plan.stamps.canonical[entityKey("doctor", doctor.id)] = canonicalHash(canonicalFieldsOf("doctor", doctor));
    for (const locale of guardLocales(plan, item, filled, doctor.translations, options)) {
      try {
        plan.doctors.push({ id: doctor.id, ref: item.ref, locale, value: prepareDoctorTranslation(item.translations[locale]!, doctor.aboutHtml) });
      } catch (err) {
        plan.skipped.push({ type: "doctor", ref: item.ref, locale, reason: (err as Error).message });
      }
    }
  }
  return plan;
}

export function preparePageTranslation(canonicalBlocks: unknown, input: Record<string, unknown>): PreparedPage["value"] {
  const title = plainText(input.title, "title", 200, true)!;
  const value: PreparedPage["value"] = { title, blocks: [] };
  for (const field of ["seoTitle", "seoDescription", "ogTitle"] as const) {
    const v = plainText(input[field], field, field === "seoDescription" ? 500 : 200, false);
    if (v) value[field] = v;
  }
  const issues = compareBlockStructure(canonicalBlocks, input.blocks);
  if (issues.length) throw new TranslationImportError(`blocks yapısı kanonikle uyuşmuyor: ${issues.slice(0, 3).join("; ")}`);
  if (!PageBlockListSchema.safeParse(input.blocks).success) throw new TranslationImportError("blocks şema doğrulamasından geçmedi.");
  value.blocks = sanitizePageBlocks(input.blocks as unknown[]);
  return value;
}

export function prepareDoctorTranslation(input: Record<string, unknown>, canonicalAboutHtml?: string | null): PreparedDoctor["value"] {
  const value: PreparedDoctor["value"] = {
    title: plainText(input.title, "title", 40, true)!,
    bio: plainText(input.bio, "bio", 5000, true)!,
  };
  const sub = plainText(input.subSpecialty, "subSpecialty", 120, false);
  if (sub) value.subSpecialty = sub;
  if (typeof input.aboutHtml === "string" && input.aboutHtml.trim()) {
    if (input.aboutHtml.length > 20000) throw new TranslationImportError("aboutHtml en fazla 20000 karakter.");
    if (canonicalAboutHtml !== undefined && !sameHtmlTargets(canonicalAboutHtml ?? "", input.aboutHtml)) {
      throw new TranslationImportError("aboutHtml içindeki bağlantı/kaynak hedefleri kanonikle aynı olmalı.");
    }
    const clean = sanitizeRichHtml(input.aboutHtml);
    if (clean) value.aboutHtml = clean;
  }
  return value;
}

export function formatImportPlan(plan: ImportPlan): string {
  const count = (list: { locale: string }[]) =>
    IMPORT_LOCALES.map((l) => `${l}=${list.filter((x) => x.locale === l).length}`).join(" ");
  const lines = [
    `Sayfa çevirileri: ${plan.pages.length} (${count(plan.pages)})`,
    `Doktor çevirileri: ${plan.doctors.length} (${count(plan.doctors)})`,
    `Uzmanlık/menü/footer çevirileri: ${plan.entities.length} (${count(plan.entities)})`,
  ];
  if (plan.skipped.length) {
    lines.push(`Atlanan (${plan.skipped.length}):`);
    for (const s of plan.skipped) lines.push(`  - [${s.type}${s.locale ? `/${s.locale}` : ""}] ${s.ref}: ${s.reason}`);
  }
  lines.push("Kanonik (EN) alanlara ve translations.en'e dokunulmaz; translations.tr yalnızca boşsa ya da --overwrite-locale=tr ile yazılır.");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Yazma / geri dönüş                                                  */
/* ------------------------------------------------------------------ */

export interface OperatorInfo {
  operator: string;
  osUser: string;
  hostname: string;
}

export interface TranslationsBackup {
  kind: "content-translations-backup";
  createdAt: string;
  /** Paket O — bu yedeğin ait olduğu import'un yazdığı diller; geri dönüş yalnızca bunlara dokunur. Eski yedeklerde yok → hedef diller. */
  locales?: string[];
  pages: { id: string; translations: unknown }[];
  doctors: { id: string; translations: unknown }[];
  /** Paket O — uzmanlık/menü/footer (eski yedeklerde yok). */
  entities?: { type: EntityType; id: string; translations: unknown }[];
}

function assertOperator(info: OperatorInfo) {
  const op = info.operator?.trim() ?? "";
  // eslint-disable-next-line no-control-regex
  if (op.length < 3 || op.length > 100 || /[\u0000-\u001f\u007f]/.test(op)) {
    throw new TranslationImportError("--operator zorunlu (3–100 karakter, kontrol karakteri yok).");
  }
}

async function writeBackup(
  db: Db,
  backupDir: string,
  pageIds: string[],
  doctorIds: string[],
  now: Date,
  locales: string[],
  entityRefs: { type: EntityType; id: string }[] = []
): Promise<string> {
  const pages = await db.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, translations: true } });
  const doctors = await db.doctorProfile.findMany({ where: { id: { in: doctorIds } }, select: { id: true, translations: true } });
  const entities: NonNullable<TranslationsBackup["entities"]> = [];
  for (const ref of entityRefs) {
    const row = await findEntity(db, ref.type, ref.id);
    if (row) entities.push({ type: ref.type, id: row.id, translations: row.translations ?? {} });
  }
  const backup: TranslationsBackup = { kind: "content-translations-backup", createdAt: now.toISOString(), locales, pages, doctors, entities };
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const file = path.join(backupDir, `translations-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(backup, null, 2), { encoding: "utf8", mode: 0o600 });
  return file;
}

function appLike(db: Db): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

/** Yalnızca hedef dil anahtarlarını birleştirir; diğer anahtarlar (tr/en/…) aynen kalır. */
function mergeTargetLocales(current: unknown, updates: { locale: TargetLocale; value: Record<string, unknown> }[]): Record<string, unknown> {
  const next = { ...((current ?? {}) as Record<string, unknown>) };
  for (const u of updates) {
    if (!(IMPORT_LOCALES as readonly string[]).includes(u.locale)) throw new TranslationImportError(`Hedef dışı dil: ${u.locale}`);
    next[u.locale] = { ...((next[u.locale] as Record<string, unknown>) ?? {}), ...u.value };
  }
  return next;
}

async function revalidateAll(db: Db, pageIds: string[], doctorsChanged: boolean, entityTypes: EntityType[] = []) {
  const app = appLike(db);
  if (pageIds.length) {
    const pages = await db.page.findMany({ where: { id: { in: pageIds } } });
    for (const page of pages) if (page.status === "PUBLISHED") await triggerPublicPageRevalidation(app, page);
  }
  const tags = new Set<string>();
  if (doctorsChanged) tags.add(CACHE_TAGS.doctors);
  if (entityTypes.includes("specialty")) [CACHE_TAGS.specialties, CACHE_TAGS.doctors].forEach((t) => tags.add(t));
  if (entityTypes.some((t) => t !== "specialty")) tags.add(CACHE_TAGS.navigation);
  if (tags.size) await triggerTagRevalidation(app, [...tags]);
}

export async function applyImportPlan(
  db: Db,
  plan: ImportPlan,
  options: OperatorInfo & { confirm?: string; backupDir: string; sourceFile: string; now?: Date; revalidate?: boolean }
): Promise<{ backupFile: string; pages: number; doctors: number; entities: number }> {
  if (options.confirm !== IMPORT_CONFIRM_KEY) throw new TranslationImportError(`Gerçek yazma için --confirm=${IMPORT_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const pageIds = [...new Set(plan.pages.map((p) => p.id))];
  const doctorIds = [...new Set(plan.doctors.map((d) => d.id))];
  const entityRefs = [...new Map(plan.entities.map((e) => [entityKey(e.type, e.id), { type: e.type, id: e.id }])).values()];
  if (pageIds.length + doctorIds.length + entityRefs.length === 0) throw new TranslationImportError("Yazılacak çeviri yok.");
  const now = options.now ?? new Date();
  const writtenLocales = IMPORT_LOCALES.filter((l) => [...plan.pages, ...plan.doctors, ...plan.entities].some((x) => x.locale === l));
  // Yedek her zaman hedef dilleri kapsar (eski davranış); TR yalnızca bu import TR yazdıysa.
  const backupLocales = [...new Set<string>([...TARGET_LOCALES, ...writtenLocales])];
  const backupFile = await writeBackup(db, options.backupDir, pageIds, doctorIds, now, backupLocales, entityRefs);
  const targetLocaleRows = await db.locale.findMany({ where: { code: { in: [...TARGET_LOCALES] } } });

  await db.$transaction(async (tx) => {
    for (const id of pageIds) {
      const current = await tx.page.findUniqueOrThrow({ where: { id } });
      // Kanonik bloklar veya çeviriler plan sonrası değiştiyse (yapı doğrulaması eski bloklara göre yapıldı) yazılmaz.
      if (
        canonicalHash(canonicalFieldsOf("page", current)) !== plan.stamps.canonical[entityKey("page", id)] ||
        stableStringify(current.translations ?? {}) !== plan.stamps.pages[id]
      ) {
        throw new TranslationImportError(`Sayfa "${current.slug}" çevirileri plan sonrası değişmiş; işlem geri alındı.`);
      }
      const translations = mergeTargetLocales(
        current.translations,
        plan.pages.filter((p) => p.id === id).map((p) => ({ locale: p.locale, value: p.value }))
      );
      const page = await tx.page.update({ where: { id }, data: { translations: translations as Prisma.InputJsonValue } });
      // Hedef dillerin ContentSlug satırları (dil henüz kapalı olsa da) — açıldığında yerelleştirilmiş başlık/slug hazır olur.
      await syncContentSlugs(tx, targetLocaleRows.filter((l) => !l.isDefault), "PAGE", page.id, page.slug, page.translations);
    }
    for (const id of doctorIds) {
      const current = await tx.doctorProfile.findUniqueOrThrow({ where: { id } });
      if (
        canonicalHash(canonicalFieldsOf("doctor", current)) !== plan.stamps.canonical[entityKey("doctor", id)] ||
        stableStringify(current.translations ?? {}) !== plan.stamps.doctors[id]
      ) {
        throw new TranslationImportError(`Doktor "${current.slug}" çevirileri plan sonrası değişmiş; işlem geri alındı.`);
      }
      const translations = mergeTargetLocales(
        current.translations,
        plan.doctors.filter((d) => d.id === id).map((d) => ({ locale: d.locale, value: d.value }))
      );
      await tx.doctorProfile.update({ where: { id }, data: { translations: translations as Prisma.InputJsonValue } });
    }
    for (const ref of entityRefs) {
      const current = await findEntity(tx as unknown as Db, ref.type, ref.id);
      if (
        !current ||
        stableStringify(current.translations ?? {}) !== plan.stamps.entities[entityKey(ref.type, ref.id)] ||
        canonicalHash(canonicalFieldsOf(ref.type, current)) !== plan.stamps.canonical[entityKey(ref.type, ref.id)]
      ) {
        throw new TranslationImportError(`${ref.type} "${ref.id}" çevirileri plan sonrası değişmiş; işlem geri alındı.`);
      }
      const translations = mergeTargetLocales(
        current.translations,
        plan.entities.filter((e) => e.type === ref.type && e.id === ref.id).map((e) => ({ locale: e.locale, value: e.value }))
      );
      await updateEntityTranslations(tx, ref.type, ref.id, translations as Prisma.InputJsonValue);
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: IMPORT_AUDIT_ACTION,
        targetType: "Content",
        targetId: null,
        metadata: {
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          sourceFile: path.basename(options.sourceFile),
          backupFile: path.basename(backupFile),
          pages: plan.pages.length,
          doctors: plan.doctors.length,
          entities: plan.entities.length,
        },
      },
    });
  });

  if (options.revalidate !== false) await revalidateAll(db, pageIds, doctorIds.length > 0, entityRefs.map((r) => r.type));
  return { backupFile, pages: plan.pages.length, doctors: plan.doctors.length, entities: plan.entities.length };
}

export async function readTranslationsBackup(file: string): Promise<TranslationsBackup> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as TranslationsBackup;
  if (parsed?.kind !== "content-translations-backup" || !Array.isArray(parsed.pages) || !Array.isArray(parsed.doctors)) {
    throw new TranslationImportError("Geçerli bir çeviri yedeği değil.");
  }
  if (parsed.locales !== undefined && (!Array.isArray(parsed.locales) || parsed.locales.some((l) => !(IMPORT_LOCALES as readonly string[]).includes(l)))) {
    throw new TranslationImportError("Yedekteki dil listesi geçersiz.");
  }
  const isMap = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  for (const row of [...parsed.pages, ...parsed.doctors, ...(parsed.entities ?? [])]) {
    if (typeof row?.id !== "string" || !isMap(row.translations)) throw new TranslationImportError("Yedekte geçersiz kayıt var.");
  }
  if (parsed.entities !== undefined && (!Array.isArray(parsed.entities) || parsed.entities.some((e) => !isEntityType(e?.type)))) {
    throw new TranslationImportError("Yedekte geçersiz kayıt türü var.");
  }
  return parsed;
}

/**
 * Yedekteki `translations` değerlerini geri yazar — YALNIZCA yedeğin `locales` listesindeki diller
 * (eski yedekte hedef diller es/de/ar/ru; TR yalnızca o import TR yazdıysa) yedekteki hâline döner;
 * en ve diğer anahtarlar mevcut hâliyle korunur. Sayfa çevirisi HTML'i sanitize edilir.
 */
export async function restoreTranslations(
  db: Db,
  backupFile: string,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ preRestoreBackup: string }> {
  if (options.confirm !== RESTORE_CONFIRM_KEY) throw new TranslationImportError(`Geri dönüş için --confirm=${RESTORE_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const backup = await readTranslationsBackup(backupFile);
  const pageIds = backup.pages.map((p) => p.id);
  const doctorIds = backup.doctors.map((d) => d.id);
  // Geri dönülecek diller: yedeğin kaydettiği import dilleri (eski yedek → yalnızca hedef diller). `en` asla.
  const restoreLocales = (backup.locales ?? [...TARGET_LOCALES]).filter((l): l is TargetLocale => (IMPORT_LOCALES as readonly string[]).includes(l));
  const entityRefs = (backup.entities ?? []).map((e) => ({ type: e.type, id: e.id }));
  const preRestoreBackup = await writeBackup(db, options.backupDir, pageIds, doctorIds, options.now ?? new Date(), restoreLocales, entityRefs);
  const targetLocaleRows = await db.locale.findMany({ where: { code: { in: [...TARGET_LOCALES] } } });

  /** Yalnızca hedef diller; her girdi beklenen alanlara indirgenir ve doğrulanır (yedek operatör girdisidir). */
  const restoreTargets = (current: unknown, saved: unknown, clean: (entry: Record<string, unknown>) => Record<string, unknown>) => {
    const next = { ...((current ?? {}) as Record<string, unknown>) };
    const old = (saved ?? {}) as Record<string, unknown>;
    for (const locale of restoreLocales) {
      const entry = old[locale];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) next[locale] = clean(entry as Record<string, unknown>);
      else delete next[locale];
    }
    return next;
  };
  const cleanPage = (entry: Record<string, unknown>) => {
    const out: Record<string, unknown> = { title: plainText(entry.title, "title", 200, true) };
    for (const field of ["seoTitle", "seoDescription", "ogTitle"] as const) {
      const v = plainText(entry[field], field, field === "seoDescription" ? 500 : 200, false);
      if (v) out[field] = v;
    }
    const slug = plainText(entry.slug, "slug", 200, false);
    if (slug) out.slug = slug;
    if (entry.blocks !== undefined) {
      if (!Array.isArray(entry.blocks) || !PageBlockListSchema.safeParse(entry.blocks).success) {
        throw new TranslationImportError("Yedekteki sayfa çevirisinin blokları geçersiz.");
      }
      out.blocks = sanitizePageBlocks(entry.blocks);
    }
    return out;
  };
  const cleanDoctor = (entry: Record<string, unknown>) => ({ ...prepareDoctorTranslation(entry) });

  await db.$transaction(async (tx) => {
    for (const row of backup.pages) {
      const current = await tx.page.findUnique({ where: { id: row.id } });
      if (!current) throw new TranslationImportError(`Yedekteki sayfa bulunamadı (id=${row.id}).`);
      const next = restoreTargets(current.translations, row.translations, cleanPage);
      // Yasal sayfaların yeni dillerde çevirisi olmaz (EN'e düşer) — yedekle de enjekte edilemez.
      if (current.isLegalDocument && TARGET_LOCALES.some((l) => restoreLocales.includes(l) && next[l] !== undefined)) {
        throw new TranslationImportError(`"${current.slug}" yasal sayfa; hedef dillerde çeviri geri yüklenemez.`);
      }
      const page = await tx.page.update({ where: { id: row.id }, data: { translations: next as Prisma.InputJsonValue } });
      await syncContentSlugs(tx, targetLocaleRows.filter((l) => !l.isDefault), "PAGE", page.id, page.slug, page.translations);
    }
    for (const row of backup.doctors) {
      const current = await tx.doctorProfile.findUnique({ where: { id: row.id } });
      if (!current) throw new TranslationImportError(`Yedekteki doktor bulunamadı (id=${row.id}).`);
      const next = restoreTargets(current.translations, row.translations, cleanDoctor);
      await tx.doctorProfile.update({ where: { id: row.id }, data: { translations: next as Prisma.InputJsonValue } });
    }
    for (const row of backup.entities ?? []) {
      const current = await findEntity(tx as unknown as Db, row.type, row.id);
      if (!current) throw new TranslationImportError(`Yedekteki ${row.type} bulunamadı (id=${row.id}).`);
      const next = restoreTargets(current.translations, row.translations, (entry) => prepareEntityTranslation(row.type, entry));
      await updateEntityTranslations(tx, row.type, row.id, next as Prisma.InputJsonValue);
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: RESTORE_AUDIT_ACTION,
        targetType: "Content",
        targetId: null,
        metadata: {
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          backupFile: path.basename(backupFile),
          preRestoreBackup: path.basename(preRestoreBackup),
        },
      },
    });
  });

  if (options.revalidate !== false) await revalidateAll(db, pageIds, doctorIds.length > 0, entityRefs.map((r) => r.type));
  return { preRestoreBackup };
}
