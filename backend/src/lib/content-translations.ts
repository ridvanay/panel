/**
 * Paket L (2026-10-23) — çevrilecek içeriğin dışa aktarımı ve çevirilerin içe aktarımı.
 * Scriptler: `scripts/export-translatable-content.ts` (salt okuma), `scripts/import-translations.ts`.
 * Rapor: `docs/prompts/2026-10-23-L-RAPOR.md`.
 *
 * Akış: export (EN kanonik metin) → ayrı oturumda çeviri (`translations.<dil>` doldurulur) → import.
 *
 * İçe aktarma KURALLARI:
 *  - Yalnızca `translations.es|de|ar|ru` yazılır. Kanonik kolonlara ve `translations.tr`/`en`'e
 *    ASLA dokunulmaz; dosyada başka bir dil anahtarı varsa işlem reddedilir.
 *  - Yalnızca `translations` kolonu olan içerik yazılabilir: sayfa (`Page`) ve doktor profili.
 *    Uzmanlık, menü, footer ve site ayarları export'ta "importable: false" olarak listelenir
 *    (bu modellerde çeviri kolonu yok; ayrı bir migration gerektirir).
 *  - Yasal sayfalar (`isLegalDocument`) export'a girmez, import'ta da reddedilir (yeni dillerde EN'e düşer).
 *  - Sayfa bloklarında çevirmen yalnızca metni değiştirebilir: ağaç yapısı, id/tip, bağlantılar,
 *    URL'ler, renkler ve sayılar kanonikle birebir aynı olmalıdır. HTML sanitize edilir.
 *  - Kanonik metin export'tan sonra değiştiyse o kalem atlanır (çeviri bayat olabilir).
 *  - Varsayılan kuru çalışma; `--confirm` ile yedek → tek transaction → audit → önbellek yenileme.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeRichHtml } from "./html-sanitize";
import { syncContentSlugs } from "./localization";
import { CACHE_TAGS, triggerPublicPageRevalidation, triggerTagRevalidation } from "./revalidate";
import { sanitizePageBlocks } from "../modules/pages/lib/sanitize-blocks";
import { PageBlockListSchema } from "../modules/pages/pages.schemas";

export const TARGET_LOCALES = ["es", "de", "ar", "ru"] as const;
export type TargetLocale = (typeof TARGET_LOCALES)[number];
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
  /** Kanonik metnin export anındaki son değişikliği — import'ta bayatlık kontrolü. */
  updatedAt: string | null;
  fields: Record<string, unknown>;
  translations: Partial<Record<TargetLocale, Record<string, unknown> | null>>;
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
  "page" | "doctorProfile" | "specialty" | "navigationItem" | "footerColumn" | "siteSettings" | "locale" | "contentSlug" | "auditLog" | "$transaction"
>;

const NO_COLUMN_NOTE = "Bu modelde çeviri kolonu yok; içe aktarılmaz (ayrı bir migration gerektirir).";

const INSTRUCTIONS =
  "Her kalemde `fields` kanonik (EN) metindir. Çeviriyi aynı alan adlarıyla `translations.<es|de|ar|ru>` içine yazın. " +
  "Sayfa `blocks` ağacında YALNIZCA görünen metinleri çevirin: yapı, id/type, bağlantı (href/url), görsel, renk ve sayı değerleri aynen kalmalıdır. " +
  "`importable: false` kalemler bilgi amaçlıdır, içe aktarılmaz. Boş bırakılan (null) dil yazılmaz.";

const emptyTranslations = (): ExportItem["translations"] => Object.fromEntries(TARGET_LOCALES.map((l) => [l, null]));

/* ------------------------------------------------------------------ */
/* Export (salt okuma)                                                 */
/* ------------------------------------------------------------------ */

export async function buildTranslationExport(db: Db, now = new Date()): Promise<TranslationExport> {
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
      fields: { title: p.title, seoTitle: p.seoTitle, seoDescription: p.seoDescription, ogTitle: p.ogTitle, blocks: p.blocks },
      translations: emptyTranslations(),
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
      fields: { title: d.title, bio: d.bio, aboutHtml: d.aboutHtml, subSpecialty: d.subSpecialty },
      translations: emptyTranslations(),
    });
  }

  for (const s of await db.specialty.findMany({ where: { isActive: true }, orderBy: { order: "asc" } })) {
    items.push({ type: "specialty", id: s.id, ref: s.slug, importable: false, note: NO_COLUMN_NOTE, updatedAt: s.updatedAt.toISOString(), fields: { name: s.name, description: s.description }, translations: emptyTranslations() });
  }
  for (const n of await db.navigationItem.findMany({ orderBy: [{ parentId: "asc" }, { order: "asc" }] })) {
    items.push({ type: "navigationItem", id: n.id, ref: n.href, importable: false, note: NO_COLUMN_NOTE, updatedAt: null, fields: { label: n.label }, translations: emptyTranslations() });
  }
  for (const c of await db.footerColumn.findMany({ orderBy: { order: "asc" }, include: { links: { orderBy: { order: "asc" } } } })) {
    items.push({ type: "footerColumn", id: c.id, ref: c.title, importable: false, note: NO_COLUMN_NOTE, updatedAt: null, fields: { title: c.title }, translations: emptyTranslations() });
    for (const l of c.links) {
      items.push({ type: "footerLink", id: l.id, ref: l.href, importable: false, note: NO_COLUMN_NOTE, updatedAt: null, fields: { label: l.label }, translations: emptyTranslations() });
    }
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

  return {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    canonicalLocale: defaultLocale,
    targetLocales: TARGET_LOCALES,
    instructions: INSTRUCTIONS,
    items,
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
  if (typeof canonical === "string") return typeof translated === "string" ? [] : [`${where}: metin bekleniyordu`];
  return canonical === translated ? [] : [`${where}: değer değiştirilmiş`];
}

const HTML_TAG = /<[a-z!/][^>]*>/i;

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

export interface ImportPlan {
  pages: PreparedPage[];
  doctors: PreparedDoctor[];
  skipped: { type: string; ref: string; locale?: string; reason: string }[];
  /** Plan anındaki `translations` damgaları — yazma sırasında eşzamanlı değişiklik kontrolü. */
  stamps: { pages: Record<string, string>; doctors: Record<string, string> };
}

export async function readTranslationFile(file: string): Promise<TranslationExport> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as TranslationExport;
  if (parsed?.kind !== EXPORT_KIND || parsed.version !== EXPORT_VERSION || !Array.isArray(parsed.items)) {
    throw new TranslationImportError("Geçerli bir çeviri dosyası değil (kind/version).");
  }
  for (const item of parsed.items) {
    for (const key of Object.keys(item.translations ?? {})) {
      if (!(TARGET_LOCALES as readonly string[]).includes(key)) {
        throw new TranslationImportError(`"${item.type}:${item.ref}" kaleminde izin verilmeyen dil anahtarı "${key}" var (yalnızca ${TARGET_LOCALES.join(", ")}).`);
      }
    }
  }
  return parsed;
}

export async function buildImportPlan(db: Db, data: TranslationExport): Promise<ImportPlan> {
  const plan: ImportPlan = { pages: [], doctors: [], skipped: [], stamps: { pages: {}, doctors: {} } };

  for (const item of data.items) {
    const filled = TARGET_LOCALES.filter((l) => item.translations?.[l]);
    if (filled.length === 0) continue;
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
      if (item.updatedAt && page.updatedAt.toISOString() !== item.updatedAt) {
        plan.skipped.push({ type: "page", ref: item.ref, reason: "Kanonik metin export'tan sonra değişmiş; yeniden export/çeviri gerekir." });
        continue;
      }
      plan.stamps.pages[page.id] = JSON.stringify(page.translations ?? {});
      for (const locale of filled) {
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
    if (item.updatedAt && doctor.updatedAt.toISOString() !== item.updatedAt) {
      plan.skipped.push({ type: "doctor", ref: item.ref, reason: "Kanonik metin export'tan sonra değişmiş; yeniden export/çeviri gerekir." });
      continue;
    }
    plan.stamps.doctors[doctor.id] = JSON.stringify(doctor.translations ?? {});
    for (const locale of filled) {
      try {
        plan.doctors.push({ id: doctor.id, ref: item.ref, locale, value: prepareDoctorTranslation(item.translations[locale]!) });
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

export function prepareDoctorTranslation(input: Record<string, unknown>): PreparedDoctor["value"] {
  const value: PreparedDoctor["value"] = {
    title: plainText(input.title, "title", 40, true)!,
    bio: plainText(input.bio, "bio", 5000, true)!,
  };
  const sub = plainText(input.subSpecialty, "subSpecialty", 120, false);
  if (sub) value.subSpecialty = sub;
  if (typeof input.aboutHtml === "string" && input.aboutHtml.trim()) {
    if (input.aboutHtml.length > 20000) throw new TranslationImportError("aboutHtml en fazla 20000 karakter.");
    const clean = sanitizeRichHtml(input.aboutHtml);
    if (clean) value.aboutHtml = clean;
  }
  return value;
}

export function formatImportPlan(plan: ImportPlan): string {
  const count = (list: { locale: string }[]) =>
    TARGET_LOCALES.map((l) => `${l}=${list.filter((x) => x.locale === l).length}`).join(" ");
  const lines = [`Sayfa çevirileri: ${plan.pages.length} (${count(plan.pages)})`, `Doktor çevirileri: ${plan.doctors.length} (${count(plan.doctors)})`];
  if (plan.skipped.length) {
    lines.push(`Atlanan (${plan.skipped.length}):`);
    for (const s of plan.skipped) lines.push(`  - [${s.type}${s.locale ? `/${s.locale}` : ""}] ${s.ref}: ${s.reason}`);
  }
  lines.push("Kanonik alanlara ve translations.tr/en'e dokunulmaz.");
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
  pages: { id: string; translations: unknown }[];
  doctors: { id: string; translations: unknown }[];
}

function assertOperator(info: OperatorInfo) {
  if (!info.operator || info.operator.trim().length < 3) throw new TranslationImportError("--operator zorunlu (en az 3 karakter).");
}

async function writeBackup(db: Db, backupDir: string, pageIds: string[], doctorIds: string[], now: Date): Promise<string> {
  const pages = await db.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, translations: true } });
  const doctors = await db.doctorProfile.findMany({ where: { id: { in: doctorIds } }, select: { id: true, translations: true } });
  const backup: TranslationsBackup = { kind: "content-translations-backup", createdAt: now.toISOString(), pages, doctors };
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
    if (!(TARGET_LOCALES as readonly string[]).includes(u.locale)) throw new TranslationImportError(`Hedef dışı dil: ${u.locale}`);
    next[u.locale] = { ...((next[u.locale] as Record<string, unknown>) ?? {}), ...u.value };
  }
  return next;
}

async function revalidateAll(db: Db, pageIds: string[], doctorsChanged: boolean) {
  const app = appLike(db);
  if (pageIds.length) {
    const pages = await db.page.findMany({ where: { id: { in: pageIds } } });
    for (const page of pages) if (page.status === "PUBLISHED") await triggerPublicPageRevalidation(app, page);
  }
  if (doctorsChanged) await triggerTagRevalidation(app, [CACHE_TAGS.doctors]);
}

export async function applyImportPlan(
  db: Db,
  plan: ImportPlan,
  options: OperatorInfo & { confirm?: string; backupDir: string; sourceFile: string; now?: Date; revalidate?: boolean }
): Promise<{ backupFile: string; pages: number; doctors: number }> {
  if (options.confirm !== IMPORT_CONFIRM_KEY) throw new TranslationImportError(`Gerçek yazma için --confirm=${IMPORT_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const pageIds = [...new Set(plan.pages.map((p) => p.id))];
  const doctorIds = [...new Set(plan.doctors.map((d) => d.id))];
  if (pageIds.length + doctorIds.length === 0) throw new TranslationImportError("Yazılacak çeviri yok.");
  const now = options.now ?? new Date();
  const backupFile = await writeBackup(db, options.backupDir, pageIds, doctorIds, now);
  const targetLocaleRows = await db.locale.findMany({ where: { code: { in: [...TARGET_LOCALES] } } });

  await db.$transaction(async (tx) => {
    for (const id of pageIds) {
      const current = await tx.page.findUniqueOrThrow({ where: { id } });
      if (JSON.stringify(current.translations ?? {}) !== plan.stamps.pages[id]) {
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
      if (JSON.stringify(current.translations ?? {}) !== plan.stamps.doctors[id]) {
        throw new TranslationImportError(`Doktor "${current.slug}" çevirileri plan sonrası değişmiş; işlem geri alındı.`);
      }
      const translations = mergeTargetLocales(
        current.translations,
        plan.doctors.filter((d) => d.id === id).map((d) => ({ locale: d.locale, value: d.value }))
      );
      await tx.doctorProfile.update({ where: { id }, data: { translations: translations as Prisma.InputJsonValue } });
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
        },
      },
    });
  });

  if (options.revalidate !== false) await revalidateAll(db, pageIds, doctorIds.length > 0);
  return { backupFile, pages: plan.pages.length, doctors: plan.doctors.length };
}

export async function readTranslationsBackup(file: string): Promise<TranslationsBackup> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as TranslationsBackup;
  if (parsed?.kind !== "content-translations-backup" || !Array.isArray(parsed.pages) || !Array.isArray(parsed.doctors)) {
    throw new TranslationImportError("Geçerli bir çeviri yedeği değil.");
  }
  const isMap = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  for (const row of [...parsed.pages, ...parsed.doctors]) {
    if (typeof row?.id !== "string" || !isMap(row.translations)) throw new TranslationImportError("Yedekte geçersiz kayıt var.");
  }
  return parsed;
}

/**
 * Yedekteki `translations` değerlerini geri yazar — YALNIZCA hedef dil anahtarları (es/de/ar/ru)
 * yedekteki hâline döner; tr/en ve diğer anahtarlar mevcut hâliyle korunur (yedek dosyası elle
 * değiştirilmiş olsa bile kanonik/TR içeriğe dokunulamaz). Sayfa çevirisi HTML'i sanitize edilir.
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
  const preRestoreBackup = await writeBackup(db, options.backupDir, pageIds, doctorIds, options.now ?? new Date());
  const targetLocaleRows = await db.locale.findMany({ where: { code: { in: [...TARGET_LOCALES] } } });

  const restoreTargets = (current: unknown, saved: unknown) => {
    const next = { ...((current ?? {}) as Record<string, unknown>) };
    const old = (saved ?? {}) as Record<string, unknown>;
    for (const locale of TARGET_LOCALES) {
      if (old[locale] !== undefined) next[locale] = old[locale];
      else delete next[locale];
    }
    return next;
  };

  await db.$transaction(async (tx) => {
    for (const row of backup.pages) {
      const current = await tx.page.findUnique({ where: { id: row.id } });
      if (!current) throw new TranslationImportError(`Yedekteki sayfa bulunamadı (id=${row.id}).`);
      const next = restoreTargets(current.translations, row.translations);
      for (const locale of TARGET_LOCALES) {
        const entry = next[locale] as Record<string, unknown> | undefined;
        if (entry && Array.isArray(entry.blocks)) next[locale] = { ...entry, blocks: sanitizePageBlocks(entry.blocks) };
      }
      const page = await tx.page.update({ where: { id: row.id }, data: { translations: next as Prisma.InputJsonValue } });
      await syncContentSlugs(tx, targetLocaleRows.filter((l) => !l.isDefault), "PAGE", page.id, page.slug, page.translations);
    }
    for (const row of backup.doctors) {
      const current = await tx.doctorProfile.findUnique({ where: { id: row.id } });
      if (!current) throw new TranslationImportError(`Yedekteki doktor bulunamadı (id=${row.id}).`);
      const next = restoreTargets(current.translations, row.translations);
      for (const locale of TARGET_LOCALES) {
        const entry = next[locale] as Record<string, unknown> | undefined;
        if (entry && typeof entry.aboutHtml === "string") next[locale] = { ...entry, aboutHtml: sanitizeRichHtml(entry.aboutHtml) };
      }
      await tx.doctorProfile.update({ where: { id: row.id }, data: { translations: next as Prisma.InputJsonValue } });
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

  if (options.revalidate !== false) await revalidateAll(db, pageIds, doctorIds.length > 0);
  return { preRestoreBackup };
}
