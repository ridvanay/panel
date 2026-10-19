import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Locale, Prisma, PrismaClient } from "@prisma/client";
import { sanitizePageBlocks } from "../modules/pages/lib/sanitize-blocks";
import { PageBlockListSchema } from "../modules/pages/pages.schemas";
import { syncContentSlugs } from "./localization";
import { triggerPublicPageRevalidation } from "./revalidate";

/**
 * Paket J (2026-10-19) — yasal sayfaların (`docs/legal/*.tr.md|*.en.md`) CMS'e yüklenmesi.
 * `scripts/publish-legal-pages.ts` bu modülün ince sarmalayıcısıdır; mantık test edilebilsin diye
 * burada durur.
 *
 * CMS yapısı (bkz. prisma `Page` + `Locale`, .claude/architect-scope-i18n.md): varsayılan dilin
 * (`Locale.isDefault`) içeriği KANONİK kolonlarda (`Page.title`, `Page.blocks`), diğer dillerin
 * içeriği `Page.translations.<kod>` JSON'unda (`{ title, blocks, slug?, seo... }`) durur; ayrı
 * çeviri tablosu yoktur. Dil başına slug `ContentSlug` tablosundadır (`syncContentSlugs`).
 * Bu yüzden TR/EN metinleri hangi dil varsayılansa ona göre yerleşir: varsayılan TR ise TR kanonik
 * kolonlara, EN `translations.en`'e; varsayılan EN ise tersi.
 *
 * Korunanlar: slug, `isLegalDocument`, yayın durumu (`status`/`publishedAt`), SEO alanları, menü/
 * footer bağlantıları (NavigationItem — dokunulmaz) ve çeviri JSON'undaki diğer alanlar
 * (`slug`, `seoTitle`...). YALNIZCA başlık ve bloklar güncellenir. Yeni sayfa AÇILMAZ.
 */

export const LEGAL_PAGE_MAP = [
  { slug: "kvkk-aydinlatma-metni-2", file: "kvkk-aydinlatma-metni" },
  { slug: "acik-riza-metni-2", file: "acik-riza-metni" },
  { slug: "kullanim-kosullari-2", file: "kullanim-kosullari" },
  { slug: "distance-service-agreement", file: "mesafeli-hizmet-sozlesmesi" },
] as const;

export const PUBLISH_CONFIRM_KEY = "publish-legal";
export const RESTORE_CONFIRM_KEY = "restore-legal";
export const PUBLISH_AUDIT_ACTION = "cms.legal_pages.published";
export const RESTORE_AUDIT_ACTION = "cms.legal_pages.restored";

export type LegalLang = "tr" | "en";
export type PlaceholderValues = Record<string, Partial<Record<LegalLang, string>>>;

export class LegalPublishError extends Error {}

// ---------------------------------------------------------------------------
// Saf yardımcılar
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * `{{ANAHTAR}}` değerlerini `values[ANAHTAR][lang]` ile doldurur. Değeri olmayan ya da boş olan
 * anahtar `missing`'e yazılır ve metinde OLDUĞU GİBİ bırakılır (kuru çalışmada görünsün diye).
 */
export function fillPlaceholders(text: string, values: PlaceholderValues, lang: LegalLang): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = text.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = values[key]?.[lang];
    if (typeof value !== "string" || value.trim() === "") {
      missing.add(key);
      return match;
    }
    return value;
  });
  // Doldurulamayan her `{{...}}` — biçimi bozuk olanlar dahil — gerçek yüklemeyi engeller.
  for (const leftover of filled.matchAll(/\{\{([^}]*)\}\}/g)) missing.add(leftover[1]!.trim() || "(boş)");
  return { text: filled, missing: [...missing].sort() };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Satır içi: `**kalın**`, `*italik*`, `[metin](http(s)/mailto)`. Önce HTML kaçışı yapılır. */
export function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_m, label: string, href: string) => `<a href="${href}">${label}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

/**
 * Metinlerde kullanılan markdown alt kümesini HTML'e çevirir: `##`/`###`/`####` başlık, paragraf,
 * `- `/`* ` madde listesi, `1. ` numaralı liste, `> ` alıntı, satır içi kalın/italik/bağlantı.
 * (Projede markdown kütüphanesi yok ve bu pakette bağımlılık eklenmez.) Çıktı ayrıca
 * `sanitizePageBlocks` ile sanitize edilir.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      // Gövdedeki `#` (sayfa başlığı ayrıca çıkarılır) h2'ye indirgenir — sayfada tek h1 kalsın.
      const level = Math.max(2, heading[1]!.length);
      html.push(`<h${level}>${renderInline(heading[2]!.trim())}</h${level}>`);
      continue;
    }
    const quoteLine = /^>\s?(.*)$/.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]!);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // Madde devam satırı.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return html.join("\n");
}

/** İlk `# Başlık` satırı sayfa başlığıdır; gövdeden çıkarılır. */
export function extractTitle(markdown: string): { title: string; body: string } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (index === -1) throw new LegalPublishError("Dosyada `# Başlık` satırı yok.");
  const title = lines[index]!.replace(/^#\s+/, "").trim();
  lines.splice(index, 1);
  return { title, body: lines.join("\n") };
}

/** Sayfa bloğu ağacı: başlık (h1) + tek `text` bloğu. `PageBlockListSchema` ile doğrulanır ve sanitize edilir. */
export function buildLegalBlocks(title: string, bodyHtml: string, key: string): unknown[] {
  const blocks = [
    { id: `legal-${key}-heading`, type: "heading", data: { text: title, level: 1, align: "left", underline: false } },
    { id: `legal-${key}-body`, type: "text", data: { html: bodyHtml } },
  ];
  const parsed = PageBlockListSchema.safeParse(blocks);
  if (!parsed.success) {
    throw new LegalPublishError(`Üretilen bloklar PageBlockListSchema'yı geçemedi: ${JSON.stringify(parsed.error.issues)}`);
  }
  return sanitizePageBlocks(blocks);
}

/** Bloklardaki görünen metin uzunluğu (HTML etiketleri hariç) — kuru çalışma raporu için. */
export function contentTextLength(blocks: unknown): number {
  let total = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((key === "html" || key === "text") && typeof value === "string") total += value.replace(/<[^>]*>/g, "").trim().length;
      else if (typeof value === "object") visit(value);
    }
  };
  visit(blocks);
  return total;
}

export interface LegalDocument {
  lang: LegalLang;
  title: string;
  blocks: unknown[];
  missing: string[];
}

export async function loadLegalDocument(dir: string, file: string, lang: LegalLang, values: PlaceholderValues): Promise<LegalDocument> {
  const raw = await fs.readFile(path.join(dir, `${file}.${lang}.md`), "utf8");
  const { text, missing } = fillPlaceholders(raw, values, lang);
  const { title, body } = extractTitle(text);
  return { lang, title, blocks: buildLegalBlocks(title, markdownToHtml(body), `${file}-${lang}`), missing };
}

export async function loadValues(dir: string): Promise<PlaceholderValues> {
  const raw = await fs.readFile(path.join(dir, "values.json"), "utf8");
  return JSON.parse(raw) as PlaceholderValues;
}

// ---------------------------------------------------------------------------
// Plan / yükleme / geri dönüş
// ---------------------------------------------------------------------------

export interface PagePlan {
  slug: string;
  file: string;
  pageId: string;
  status: string;
  updatedAt: Date;
  canonicalLang: LegalLang;
  translationLang: LegalLang;
  translationLocaleEnabled: boolean;
  current: { canonicalTitle: string; canonicalLength: number; translationTitle: string | null; translationLength: number; translationExists: boolean };
  next: { tr: LegalDocument; en: LegalDocument };
}

export interface PublishPlan {
  defaultLocale: string;
  pages: PagePlan[];
  missing: { slug: string; lang: LegalLang; keys: string[] }[];
}

type Db = Pick<PrismaClient, "page" | "locale" | "contentSlug" | "auditLog" | "$transaction">;

async function resolveLocales(db: Db): Promise<{ enabled: Locale[]; defaultCode: string }> {
  const enabled = await db.locale.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  const def = enabled.find((l) => l.isDefault);
  if (!def) throw new LegalPublishError("Etkin varsayılan dil (Locale.isDefault) bulunamadı.");
  return { enabled, defaultCode: def.code };
}

function langOf(code: string): LegalLang | null {
  const c = code.toLowerCase();
  if (c === "tr" || c.startsWith("tr-")) return "tr";
  if (c === "en" || c.startsWith("en-")) return "en";
  return null;
}

export async function buildPublishPlan(db: Db, dir: string, values: PlaceholderValues): Promise<PublishPlan> {
  const { enabled, defaultCode } = await resolveLocales(db);
  const canonicalLang = langOf(defaultCode);
  if (!canonicalLang) {
    throw new LegalPublishError(`Varsayılan dil "${defaultCode}" TR ya da EN değil — metinlerin hangi kayda yazılacağı belirsiz.`);
  }
  const translationLang: LegalLang = canonicalLang === "tr" ? "en" : "tr";
  const translationLocale = enabled.find((l) => langOf(l.code) === translationLang);

  const pages: PagePlan[] = [];
  const missing: PublishPlan["missing"] = [];
  for (const { slug, file } of LEGAL_PAGE_MAP) {
    const page = await db.page.findUnique({ where: { slug } });
    if (!page || page.deletedAt) throw new LegalPublishError(`Sayfa bulunamadı (slug="${slug}"). Yeni sayfa açılmaz; işlem durduruldu.`);

    const tr = await loadLegalDocument(dir, file, "tr", values);
    const en = await loadLegalDocument(dir, file, "en", values);
    if (tr.missing.length) missing.push({ slug, lang: "tr", keys: tr.missing });
    if (en.missing.length) missing.push({ slug, lang: "en", keys: en.missing });

    const translations = (page.translations ?? {}) as Record<string, Record<string, unknown>>;
    const translationKey = translationLocale?.code ?? translationLang;
    const existingTranslation = translations[translationKey];
    pages.push({
      slug,
      file,
      pageId: page.id,
      status: page.status,
      updatedAt: page.updatedAt,
      canonicalLang,
      translationLang,
      translationLocaleEnabled: Boolean(translationLocale),
      current: {
        canonicalTitle: page.title,
        canonicalLength: contentTextLength(page.blocks),
        translationTitle: typeof existingTranslation?.title === "string" ? existingTranslation.title : null,
        translationLength: contentTextLength(existingTranslation?.blocks ?? []),
        translationExists: Boolean(existingTranslation && typeof existingTranslation.title === "string" && existingTranslation.title.trim()),
      },
      next: { tr, en },
    });
  }
  return { defaultLocale: defaultCode, pages, missing };
}

export function formatPlan(plan: PublishPlan): string {
  const lines = [`Varsayılan dil: ${plan.defaultLocale} → ${plan.pages[0]?.canonicalLang.toUpperCase()} kanonik kayda, ${plan.pages[0]?.translationLang.toUpperCase()} translations.<kod>'a yazılır.`];
  for (const p of plan.pages) {
    const canon = p.next[p.canonicalLang];
    const trans = p.next[p.translationLang];
    lines.push(
      `\n[${p.slug}] (durum: ${p.status})`,
      `  ${p.canonicalLang.toUpperCase()} (kanonik): "${p.current.canonicalTitle}" (${p.current.canonicalLength} krk) → "${canon.title}" (${contentTextLength(canon.blocks)} krk)`,
      `  ${p.translationLang.toUpperCase()} (çeviri): ${p.current.translationExists ? `"${p.current.translationTitle}" (${p.current.translationLength} krk)` : "YOK — oluşturulacak"} → "${trans.title}" (${contentTextLength(trans.blocks)} krk)` +
        (p.translationLocaleEnabled ? "" : `  [UYARI: ${p.translationLang} dili etkin değil — çeviri yazılır ama sitede görünmez]`)
    );
  }
  lines.push(
    plan.missing.length
      ? `\nEKSİK YER TUTUCULAR (gerçek yükleme engellenir):\n${plan.missing.map((m) => `  - ${m.slug} [${m.lang}]: ${m.keys.join(", ")}`).join("\n")}`
      : "\nEksik yer tutucu yok."
  );
  return lines.join("\n");
}

interface BackupPage {
  id: string;
  slug: string;
  title: string;
  blocks: unknown;
  translations: unknown;
  updatedAt: string;
}

export interface LegalBackup {
  kind: "legal-pages-backup";
  createdAt: string;
  defaultLocale: string;
  pages: BackupPage[];
}

export interface OperatorInfo {
  operator: string;
  osUser: string;
  hostname: string;
}

function assertOperator(info: OperatorInfo) {
  if (!info.operator || info.operator.trim().length < 3) {
    throw new LegalPublishError("--operator zorunlu (en az 3 karakter; kim çalıştırıyor?).");
  }
}

async function writeBackup(db: Db, backupDir: string, slugs: string[], now: Date): Promise<string> {
  const { defaultCode } = await resolveLocales(db);
  const pages = await db.page.findMany({ where: { slug: { in: slugs } } });
  const backup: LegalBackup = {
    kind: "legal-pages-backup",
    createdAt: now.toISOString(),
    defaultLocale: defaultCode,
    pages: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, blocks: p.blocks, translations: p.translations, updatedAt: p.updatedAt.toISOString() })),
  };
  await fs.mkdir(backupDir, { recursive: true });
  const file = path.join(backupDir, `legal-pages-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(backup, null, 2), { encoding: "utf8", mode: 0o600 });
  return file;
}

/** Revalidate yardımcıları Fastify örneği bekler; betikte yalnızca `prisma` + `log` gerekir. */
function appLike(db: Db): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

export interface PublishResult {
  backupFile: string;
  slugs: string[];
}

export async function publishLegalPages(
  db: Db,
  plan: PublishPlan,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<PublishResult> {
  if (options.confirm !== PUBLISH_CONFIRM_KEY) throw new LegalPublishError(`Gerçek yükleme için --confirm=${PUBLISH_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  if (plan.missing.length) {
    throw new LegalPublishError(`Eksik yer tutucular var; gerçek yükleme yapılmadı:\n${plan.missing.map((m) => `  - ${m.slug} [${m.lang}]: ${m.keys.join(", ")}`).join("\n")}`);
  }

  const now = options.now ?? new Date();
  const slugs = plan.pages.map((p) => p.slug);
  const backupFile = await writeBackup(db, options.backupDir, slugs, now);
  const { enabled } = await resolveLocales(db);

  const updated = await db.$transaction(async (tx) => {
    const results = [];
    for (const p of plan.pages) {
      const current = await tx.page.findUnique({ where: { id: p.pageId } });
      // Plan ile yükleme arasında sayfa başka biri tarafından değiştirildiyse hiçbir şey yazılmaz.
      if (!current || current.updatedAt.getTime() !== p.updatedAt.getTime()) {
        throw new LegalPublishError(`"${p.slug}" plan alındıktan sonra değişmiş; işlem geri alındı. Kuru çalışmayı yeniden yapın.`);
      }
      const canon = p.next[p.canonicalLang];
      const trans = p.next[p.translationLang];
      const translationKey = enabled.find((l) => langOf(l.code) === p.translationLang)?.code ?? p.translationLang;
      const translations = { ...((current.translations ?? {}) as Record<string, Record<string, unknown>>) };
      translations[translationKey] = { ...(translations[translationKey] ?? {}), title: trans.title, blocks: trans.blocks };

      const page = await tx.page.update({
        where: { id: p.pageId },
        data: { title: canon.title, blocks: canon.blocks as Prisma.InputJsonValue, translations: translations as Prisma.InputJsonValue },
      });
      await syncContentSlugs(tx, enabled, "PAGE", page.id, page.slug, page.translations);
      results.push(page);
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: PUBLISH_AUDIT_ACTION,
        targetType: "Page",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, slugs, backupFile: path.basename(backupFile), defaultLocale: plan.defaultLocale },
      },
    });
    return results;
  });

  if (options.revalidate !== false) {
    for (const page of updated) {
      if (page.status === "PUBLISHED") await triggerPublicPageRevalidation(appLike(db), page);
    }
  }
  return { backupFile, slugs };
}

export async function readBackup(file: string): Promise<LegalBackup> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as LegalBackup;
  if (parsed?.kind !== "legal-pages-backup" || !Array.isArray(parsed.pages)) throw new LegalPublishError("Geçerli bir yasal sayfa yedeği değil.");
  return parsed;
}

/** Yedekteki hâli (başlık, bloklar, çeviriler) birebir geri yazar; önce mevcut hâlin yedeğini alır. */
export async function restoreLegalPages(
  db: Db,
  backupFile: string,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ preRestoreBackup: string; slugs: string[] }> {
  if (options.confirm !== RESTORE_CONFIRM_KEY) throw new LegalPublishError(`Geri dönüş için --confirm=${RESTORE_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const backup = await readBackup(backupFile);
  const slugs = backup.pages.map((p) => p.slug);
  const preRestoreBackup = await writeBackup(db, options.backupDir, slugs, options.now ?? new Date());
  const { enabled } = await resolveLocales(db);

  const restored = await db.$transaction(async (tx) => {
    const results = [];
    for (const p of backup.pages) {
      const current = await tx.page.findUnique({ where: { id: p.id } });
      if (!current || current.slug !== p.slug) throw new LegalPublishError(`Yedekteki sayfa bulunamadı ya da slug değişmiş (id=${p.id}, slug=${p.slug}).`);
      const page = await tx.page.update({
        where: { id: p.id },
        data: { title: p.title, blocks: p.blocks as Prisma.InputJsonValue, translations: p.translations as Prisma.InputJsonValue },
      });
      await syncContentSlugs(tx, enabled, "PAGE", page.id, page.slug, page.translations);
      results.push(page);
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: RESTORE_AUDIT_ACTION,
        targetType: "Page",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, slugs, backupFile: path.basename(backupFile), preRestoreBackup: path.basename(preRestoreBackup) },
      },
    });
    return results;
  });

  if (options.revalidate !== false) {
    for (const page of restored) {
      if (page.status === "PUBLISHED") await triggerPublicPageRevalidation(appLike(db), page);
    }
  }
  return { preRestoreBackup, slugs };
}
