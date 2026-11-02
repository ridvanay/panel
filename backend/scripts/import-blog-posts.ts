/**
 * Paket Z2 — blog yazısı parti içe aktarma. Parti JSON biçimi: `imports/blog/batch-XX.json`
 * (categories[] + posts[]; bkz. Z2 parti biçimi). Yazılar HER ZAMAN DRAFT olarak girer; hekim
 * onayı (medicalReviewStatus) panelden/hekim kuyruğundan verilir, script yayınlamaz.
 *
 * KULLANIM (backend/ dizininden):
 *   npx tsx scripts/import-blog-posts.ts --file=../imports/blog/batch-01.json                          # kuru çalıştırma
 *   npx tsx scripts/import-blog-posts.ts --file=<parti.json> --confirm=import-blog --operator=<ad>     # gerçek yazım
 *   npx tsx scripts/import-blog-posts.ts --restore=<yedek.json> --confirm=import-blog --operator=<ad> # geri al
 *   (isteğe bağlı: --backup-dir=<yol> [varsayılan storage/backups], --no-revalidate)
 *
 * DOĞRULAMA (kuru ve gerçek çalıştırmada AYNI; HATA varsa hiçbir şey yazılmaz, hepsi listelenir):
 *  şema (zod) · slug biçimi (küçük harf-tire, <=60) ve parti içi benzersizlik · kategori partide ya da DB'de ·
 *  specialtySlug DB'de ve en az bir aktif (herkese açık) hekimi var · reviewerDoctorSlug herkese açık aktif
 *  hekim ve uzmanlığı yazınınkiyle eşleşiyor (seyahat: null + not_required; tıbbi: pending) · careTopicSlugs DB'de,
 *  isActive, isRedFlag değil ve (genel konu değilse) yazının uzmanlığına bağlı · tıbbi olmayan kategori yalnızca
 *  seyahat yazılarında · references https · ContentSlug çakışması.
 *  UYARI (yazımı engellemez): kelime sayısı 1.200-1.800 dışı, yasak ifade taraması, uzunluk kılavuzları, kaynak
 *  eksikliği, izinsiz etiket/H1, VARSAYILAN DİL EN DEĞİL.
 *
 * VARSAYILAN DİL: Locale.isDefault. EN ise metin kanonik kolonlara; değilse (yerel TR) metin `translations.en`'e
 * yazılır ve kanonik kolonlar da aynı EN metinle doldurulur (uyarı basılır).
 *
 * İDEMPOTENT (slug ile): yoksa oluştur; DRAFT ve onaylanmamışsa içerik güncellenir (düzeltme yeniden aktarımı);
 * PUBLISHED/SCHEDULED/onaylı/çöpteki yazı ATLANIR (hekim onayından sonra script içeriği ezmez).
 * Kategori: yoksa oluştur; varsa yalnızca EKSİK çeviriler eklenir (isMedical uyuşmazlığı uyarı; değiştirilmez).
 *
 * YEDEK: gerçek yazımdan önce `storage/backups/blog-import-<tarih>.json` (etkilenecek mevcut kayıtların tam JSON'u +
 * oluşturulacakların id listesi). Restore: oluşturulanları siler (yalnızca hâlâ DRAFT ve onaysızsa), güncellenenleri
 * eski hâline döndürür.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sanitizeRichHtml } from "../src/lib/html-sanitize";
import { deleteContentSlugsForEntity, syncContentSlugs } from "../src/lib/localization";
import { CACHE_TAGS, triggerTagRevalidation } from "../src/lib/revalidate";
import {
  BlogCategoryTranslationsSchema,
  FaqSchema,
  KeyTakeawaysSchema,
  ReferencesSchema,
} from "../src/modules/blog/blog.schemas";
import { computeReadingMinutes } from "../src/modules/blog/lib/medical-review";
import { sanitizeBlogTranslations } from "../src/modules/blog/lib/sanitize-content";
import { PUBLIC_DOCTOR_WHERE } from "../src/modules/telehealth/lib/archive-filters";

const prisma = new PrismaClient();

const CONFIRM_TOKEN = "import-blog";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 60;
const WORDS_MIN = 1200;
const WORDS_MAX = 1800;
const EXPECTED_CATEGORY_LOCALES = ["tr", "de", "ar", "ru", "es", "fr", "ro", "sr-latn"];
const ALLOWED_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "a", "table", "thead", "tbody", "tr", "th", "td", "blockquote"]);

// ---------------------------------------------------------------- şema

const BatchSchema = z.object({
  batch: z.string().min(1),
  generatedAt: z.string().optional(),
  categories: z
    .array(
      z.object({
        slug: z.string().min(1),
        isMedical: z.boolean(),
        name: z.string().trim().min(1).max(120),
        translations: BlogCategoryTranslationsSchema.optional().default({}),
      })
    )
    .default([]),
  posts: z.array(
    z.object({
      planNumber: z.number().int().positive(),
      slug: z.string().min(1),
      title: z.string().trim().min(1),
      excerpt: z.string().trim().min(1),
      seoTitle: z.string().trim().min(1),
      seoDescription: z.string().trim().min(1),
      categorySlug: z.string().min(1),
      specialtySlug: z.string().min(1).nullable(),
      careTopicSlugs: z.array(z.string().min(1)).default([]),
      reviewerDoctorSlug: z.string().min(1).nullable(),
      medicalReviewStatus: z.enum(["pending", "not_required"]),
      packageSlug: z.string().min(1).nullable().optional(),
      keyTakeaways: z.unknown(),
      faq: z.unknown(),
      references: z.unknown(),
      sourcesMissing: z.boolean().optional().default(false),
      sourcesNote: z.string().nullable().optional(),
      /** İsteğe bağlı hekim notu (<=2000; null = notu temizle). ALAN YOKSA mevcut not KORUNUR. */
      medicalReviewNote: z.string().max(2000).nullable().optional(),
      wordCount: z.number().int().nonnegative().optional(),
      contentHtml: z.string().min(1),
    })
  ),
});
type Batch = z.infer<typeof BatchSchema>;

// ---------------------------------------------------------------- yardımcılar

function parseArgs(argv: string[]) {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    file: value("file"),
    confirm: value("confirm"),
    operator: value("operator"),
    restore: value("restore"),
    backupDir: value("backup-dir"),
    revalidate: !argv.includes("--no-revalidate"),
  };
}

function plainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(html: string): number {
  return plainText(html)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "price/cost/fee", re: /\b(price|prices|pricing|priced|cost|costs|fee|fees)\b/gi },
  { label: "%", re: /%/g },
  { label: "success rate", re: /success rates?/gi },
  { label: "guarantee", re: /\bguarantee[ds]?\b/gi },
  { label: "best", re: /\bbest\b/gi },
  { label: "leading", re: /\bleading\b/gi },
  { label: "top-rated", re: /top[- ]rated/gi },
  { label: "before and after", re: /before and after/gi },
  { label: "dose", re: /\b(dose|doses|dosage|dosing)\b/gi },
  { label: "mg", re: /\bmg\b/gi },
];

function forbiddenHits(text: string): string[] {
  const hits: string[] = [];
  for (const { label, re } of FORBIDDEN) {
    const n = (text.match(re) ?? []).length;
    if (n > 0) hits.push(`${label} x${n}`);
  }
  return hits;
}

const jsonValue = (v: unknown) => v as Prisma.InputJsonValue;

function appLike(): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma, log } as unknown as FastifyInstance;
}

// ---------------------------------------------------------------- plan tipleri

type Action = "oluştur" | "güncelle" | "atla";

interface PostPlan {
  planNumber: number;
  slug: string;
  action: Action;
  warnings: string[];
  note: string;
  existingId: string | null;
  newId: string | null;
  data: {
    title: string;
    excerpt: string;
    contentHtml: string;
    seoTitle: string;
    seoDescription: string;
    keyTakeaways: unknown;
    faq: unknown;
    references: unknown;
    readingMinutes: number;
    categoryId: string | null; // kategori partide yeni oluşuyorsa slug üzerinden çözülür
    categorySlug: string;
    specialtyId: string | null;
    careTopicIds: string[];
    reviewerDoctorId: string | null;
    medicalReviewStatus: "pending" | "not_required";
    /** undefined = partide alan yok (mevcut not korunur); null = notu temizle. */
    medicalReviewNote: string | null | undefined;
    translationsEn: Record<string, unknown> | null;
  } | null;
}

interface CategoryPlan {
  slug: string;
  action: Action;
  warnings: string[];
  existingId: string | null;
  newId: string | null;
  name: string;
  isMedical: boolean;
  /** Yazılacak son translations (mevcut + eksikler). */
  translations: Record<string, unknown>;
  addedLocales: string[];
}

interface Plan {
  batch: string;
  defaultLocale: string;
  defaultIsEn: boolean;
  errors: string[];
  globalWarnings: string[];
  categories: CategoryPlan[];
  posts: PostPlan[];
}

/** Anahtar sırasından bağımsız (jsonb anahtarları yeniden sıralar) kanonik JSON. */
function canon(v: unknown): string {
  const norm = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(norm)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, val]) => [k, norm(val)]))
        : x;
  return JSON.stringify(norm(v ?? null));
}

/** Planlanan veri mevcut DRAFT kayıtla aynıysa true (yeniden aktarım "atla / değişiklik yok" olur). */
function isUnchanged(
  existing: {
    title: string; excerpt: string | null; contentHtml: string; seoTitle: string | null; seoDescription: string | null;
    keyTakeaways: unknown; faq: unknown; references: unknown; categoryId: string | null; specialtyId: string | null;
    careTopicIds: string[]; reviewerDoctorId: string | null; medicalReviewStatus: string | null; medicalReviewNote: string | null; translations: unknown;
  },
  d: NonNullable<PostPlan["data"]>,
  categoryId: string | null
): boolean {
  if (categoryId === null || existing.categoryId !== categoryId) return false;
  const sameScalars =
    existing.title === d.title && existing.excerpt === d.excerpt && existing.contentHtml === d.contentHtml &&
    existing.seoTitle === d.seoTitle && existing.seoDescription === d.seoDescription &&
    existing.specialtyId === d.specialtyId && existing.reviewerDoctorId === d.reviewerDoctorId &&
    (existing.medicalReviewStatus ?? "pending") === d.medicalReviewStatus &&
    (d.medicalReviewNote === undefined || existing.medicalReviewNote === d.medicalReviewNote) &&
    canon([...existing.careTopicIds].sort()) === canon([...d.careTopicIds].sort()) &&
    canon(existing.keyTakeaways) === canon(d.keyTakeaways) && canon(existing.faq) === canon(d.faq) &&
    canon(existing.references) === canon(d.references);
  if (!sameScalars) return false;
  if (!d.translationsEn) return true;
  const planned = sanitizeBlogTranslations({ en: d.translationsEn }).en;
  const current = ((existing.translations ?? {}) as Record<string, unknown>).en;
  return canon(planned) === canon(current);
}

// ---------------------------------------------------------------- doğrulama + plan

async function buildPlan(raw: unknown): Promise<Plan> {
  const plan: Plan = { batch: "?", defaultLocale: "?", defaultIsEn: false, errors: [], globalWarnings: [], categories: [], posts: [] };

  const parsed = BatchSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) plan.errors.push(`şema: ${issue.path.join(".") || "(kök)"}: ${issue.message}`);
    return plan;
  }
  const batch: Batch = parsed.data;
  plan.batch = batch.batch;

  // Varsayılan dil
  const locales = await prisma.locale.findMany();
  const defaultLocale = locales.find((l) => l.isDefault);
  if (!defaultLocale) {
    plan.errors.push("varsayılan dil (Locale.isDefault) bulunamadı.");
    return plan;
  }
  plan.defaultLocale = defaultLocale.code;
  plan.defaultIsEn = defaultLocale.code === "en";
  if (!plan.defaultIsEn) {
    plan.globalWarnings.push(
      `VARSAYILAN DİL EN DEĞİL ("${defaultLocale.code}"): metin translations.en'e yazılır, kanonik alanlar da aynı EN metinle doldurulur. Canlı ortamda varsayılan dil EN olmalıdır.`
    );
  }

  // ---- kategoriler
  const batchCats = new Map<string, Batch["categories"][number]>();
  for (const c of batch.categories) {
    const prefix = `kategori "${c.slug}"`;
    if (!SLUG_RE.test(c.slug) || c.slug.length > SLUG_MAX) plan.errors.push(`${prefix}: slug biçimi geçersiz (küçük harf-tire, <=${SLUG_MAX}).`);
    if (batchCats.has(c.slug)) plan.errors.push(`${prefix}: partide birden fazla tanımlı.`);
    batchCats.set(c.slug, c);
  }
  const dbCats = new Map((await prisma.blogCategory.findMany()).map((c) => [c.slug, c]));

  const catIsMedical = new Map<string, boolean>();
  for (const c of batchCats.values()) {
    const existing = dbCats.get(c.slug);
    const warnings: string[] = [];
    const existingTr = ((existing?.translations ?? {}) as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...existingTr };
    const addedLocales: string[] = [];
    for (const [code, value] of Object.entries(c.translations)) {
      if (merged[code] === undefined) {
        merged[code] = value;
        addedLocales.push(code);
      }
    }
    const missing = EXPECTED_CATEGORY_LOCALES.filter((code) => merged[code] === undefined);
    if (missing.length > 0) warnings.push(`çevirisi eksik diller: ${missing.join(",")}`);
    if (existing && existing.isMedical !== c.isMedical) {
      warnings.push(`isMedical uyuşmuyor (DB=${existing.isMedical}, parti=${c.isMedical}); DEĞİŞTİRİLMEZ.`);
    }
    catIsMedical.set(c.slug, existing ? existing.isMedical : c.isMedical);
    const action: Action = !existing ? "oluştur" : addedLocales.length > 0 ? "güncelle" : "atla";
    plan.categories.push({
      slug: c.slug,
      action,
      warnings,
      existingId: existing?.id ?? null,
      newId: existing ? null : crypto.randomUUID(),
      name: c.name,
      isMedical: c.isMedical,
      translations: merged,
      addedLocales,
    });
  }
  for (const c of dbCats.values()) if (!catIsMedical.has(c.slug)) catIsMedical.set(c.slug, c.isMedical);

  // ---- referans verileri (toplu sorgu)
  const specSlugs = [...new Set(batch.posts.map((p) => p.specialtySlug).filter((s): s is string => !!s))];
  const specialties = await prisma.specialty.findMany({ where: { slug: { in: specSlugs } } });
  const specBySlug = new Map(specialties.map((s) => [s.slug, s]));

  const doctorSlugs = [...new Set(batch.posts.map((p) => p.reviewerDoctorSlug).filter((s): s is string => !!s))];
  const doctors = await prisma.doctorProfile.findMany({
    where: { slug: { in: doctorSlugs } },
    include: { additionalSpecialties: { select: { specialtyId: true } } },
  });
  const doctorBySlug = new Map(doctors.map((d) => [d.slug, d]));

  // uzmanlık başına aktif hekim sayısı
  const activeDocCount = new Map<string, number>();
  for (const s of specialties) {
    activeDocCount.set(
      s.slug,
      await prisma.doctorProfile.count({
        where: { ...PUBLIC_DOCTOR_WHERE, OR: [{ specialtyId: s.id }, { additionalSpecialties: { some: { specialtyId: s.id } } }] },
      })
    );
  }

  const topicSlugs = [...new Set(batch.posts.flatMap((p) => p.careTopicSlugs))];
  const topics = await prisma.careTopic.findMany({ where: { slug: { in: topicSlugs } }, include: { specialties: { select: { specialtyId: true } } } });
  const topicBySlug = new Map(topics.map((t) => [t.slug, t]));

  const pkgSlugs = [...new Set(batch.posts.map((p) => p.packageSlug).filter((s): s is string => !!s))];
  const packages = await prisma.healthPackage.findMany({ where: { slug: { in: pkgSlugs } }, select: { slug: true, isActive: true } });
  const pkgBySlug = new Map(packages.map((p) => [p.slug, p]));

  const existingPosts = await prisma.blogPost.findMany({ where: { slug: { in: batch.posts.map((p) => p.slug) } } });
  const existingBySlug = new Map(existingPosts.map((p) => [p.slug, p]));

  // ---- yazılar
  const seenSlugs = new Set<string>();
  const seenNumbers = new Set<number>();
  for (const p of batch.posts) {
    const tag = `#${p.planNumber} ${p.slug}`;
    const warnings: string[] = [];
    const errors: string[] = [];
    const err = (m: string) => errors.push(`${tag}: ${m}`);

    if (!SLUG_RE.test(p.slug) || p.slug.length > SLUG_MAX) err(`slug biçimi geçersiz (küçük harf-tire, <=${SLUG_MAX}).`);
    if (seenSlugs.has(p.slug)) err("slug partide tekrar ediyor.");
    seenSlugs.add(p.slug);
    if (seenNumbers.has(p.planNumber)) err("planNumber partide tekrar ediyor.");
    seenNumbers.add(p.planNumber);

    // kategori
    if (!catIsMedical.has(p.categorySlug)) err(`kategori "${p.categorySlug}" ne partide tanımlı ne DB'de var.`);
    const categoryMedical = catIsMedical.get(p.categorySlug);
    const isTravel = p.specialtySlug === null;

    if (categoryMedical === false && !isTravel) err("tıbbi olmayan kategori yalnızca seyahat (specialtySlug=null) yazılarında kullanılabilir.");

    // uzmanlık / hekim
    let specialtyId: string | null = null;
    let reviewerId: string | null = null;
    if (isTravel) {
      if (p.reviewerDoctorSlug !== null) err("seyahat yazısında reviewerDoctorSlug null olmalı.");
      if (p.medicalReviewStatus !== "not_required") err('seyahat yazısında medicalReviewStatus "not_required" olmalı.');
      if (categoryMedical === true) err('seyahat yazısı (not_required) tıbbi olmayan bir kategoride olmalı.');
    } else {
      const spec = specBySlug.get(p.specialtySlug!);
      if (!spec) err(`specialtySlug "${p.specialtySlug}" DB'de yok.`);
      else {
        specialtyId = spec.id;
        if (!spec.isActive) warnings.push(`uzmanlık "${spec.slug}" pasif.`);
        if ((activeDocCount.get(spec.slug) ?? 0) < 1) err(`uzmanlık "${spec.slug}" için aktif hekim yok.`);
      }
      if (p.medicalReviewStatus !== "pending") err('tıbbi yazıda medicalReviewStatus "pending" olmalı.');
      if (categoryMedical === false) err("tıbbi yazı tıbbi olmayan kategoride olamaz.");
      if (p.reviewerDoctorSlug === null) err("tıbbi yazıda reviewerDoctorSlug zorunlu.");
      else {
        const doc = doctorBySlug.get(p.reviewerDoctorSlug);
        if (!doc) err(`hekim "${p.reviewerDoctorSlug}" DB'de yok.`);
        else if (!doc.isActive || doc.archivedAt !== null) err(`hekim "${doc.slug}" herkese açık aktif değil (pasif/arşivli).`);
        else {
          reviewerId = doc.id;
          if (specialtyId && doc.specialtyId !== specialtyId && !doc.additionalSpecialties.some((a) => a.specialtyId === specialtyId)) {
            err(`hekim "${doc.slug}" uzmanlığı "${p.specialtySlug}" ile eşleşmiyor.`);
          }
        }
      }
    }

    // bakım konuları
    const topicIds: string[] = [];
    for (const ts of p.careTopicSlugs) {
      const t = topicBySlug.get(ts);
      if (!t) {
        err(`careTopic "${ts}" DB'de yok.`);
        continue;
      }
      if (!t.isActive) err(`careTopic "${ts}" pasif.`);
      if (t.isRedFlag) err(`careTopic "${ts}" isRedFlag=true; yazılara bağlanmaz.`);
      const general = t.specialties.length === 0;
      if (!general && (!specialtyId || !t.specialties.some((s) => s.specialtyId === specialtyId))) {
        err(`careTopic "${ts}" yazının uzmanlığına (${p.specialtySlug ?? "yok"}) bağlı değil.`);
      }
      topicIds.push(t.id);
    }

    // zengin alanlar
    const kt = KeyTakeawaysSchema.safeParse(p.keyTakeaways);
    const fq = FaqSchema.safeParse(p.faq);
    const rf = ReferencesSchema.safeParse(p.references);
    if (!kt.success) err(`keyTakeaways geçersiz: ${kt.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    if (!fq.success) err(`faq geçersiz: ${fq.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    if (!rf.success) err(`references geçersiz: ${rf.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    if (kt.success && (kt.data.length < 4 || kt.data.length > 6)) warnings.push(`keyTakeaways ${kt.data.length} madde (hedef 4-6).`);
    if (fq.success && (fq.data.length < 5 || fq.data.length > 8)) warnings.push(`faq ${fq.data.length} soru (hedef 5-8).`);
    if (rf.success) {
      if (rf.data.length < 2 && !p.sourcesMissing) warnings.push(`yalnızca ${rf.data.length} kaynak ama sourcesMissing=false.`);
      if (rf.data.length > 0 && rf.data.length < 3) warnings.push(`kaynak sayısı ${rf.data.length} (hedef 3-6).`);
    }
    if (p.sourcesMissing) warnings.push(`KAYNAK EKSİK${p.sourcesNote ? `: ${p.sourcesNote}` : ""}`);

    // içerik
    const cleanHtml = sanitizeRichHtml(p.contentHtml);
    const words = countWords(cleanHtml);
    if (words < WORDS_MIN || words > WORDS_MAX) warnings.push(`kelime sayısı ${words} (hedef ${WORDS_MIN}-${WORDS_MAX}).`);
    else if (p.wordCount !== undefined && Math.abs(p.wordCount - words) > words * 0.1) warnings.push(`bildirilen wordCount=${p.wordCount}, ölçülen=${words}.`);
    const badTags = new Set<string>();
    for (const m of p.contentHtml.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) {
      const t = m[1]!.toLowerCase();
      if (!ALLOWED_TAGS.has(t)) badTags.add(t);
    }
    if (badTags.size > 0) warnings.push(`izinsiz etiket(ler) (sanitize sileceğinden etkisi olabilir): ${[...badTags].join(",")}`);
    if (!isTravel && !/\/find-a-physician/.test(p.contentHtml)) warnings.push("içerikte /find-a-physician bağlantısı yok.");
    if (!isTravel && p.specialtySlug && !p.contentHtml.includes(`/specialties/${p.specialtySlug}`)) warnings.push(`içerikte /specialties/${p.specialtySlug} bağlantısı yok.`);
    if (p.packageSlug) {
      if (!p.contentHtml.includes(`/packages/${p.packageSlug}`)) warnings.push(`içerikte /packages/${p.packageSlug} bağlantısı yok.`);
      const pkg = pkgBySlug.get(p.packageSlug);
      if (!pkg) warnings.push(`paket "${p.packageSlug}" DB'de yok.`);
      else if (!pkg.isActive) warnings.push(`paket "${p.packageSlug}" pasif.`);
    }
    if (p.title.length > 70) warnings.push(`title ${p.title.length} karakter (tercih <=70).`);
    if (p.excerpt.length > 200) warnings.push(`excerpt ${p.excerpt.length} karakter (<=200).`);
    if (p.seoTitle.length > 60) warnings.push(`seoTitle ${p.seoTitle.length} karakter (<=60).`);
    if (p.seoDescription.length < 120 || p.seoDescription.length > 160) warnings.push(`seoDescription ${p.seoDescription.length} karakter (120-160).`);

    const scanText = [
      plainText(cleanHtml),
      p.title,
      p.excerpt,
      p.seoTitle,
      p.seoDescription,
      ...(kt.success ? kt.data : []),
      ...(fq.success ? fq.data.flatMap((f) => [f.question, f.answer]) : []),
    ].join(" \n ");
    const hits = forbiddenHits(scanText);
    if (hits.length > 0) warnings.push(`YASAK İFADE TARAMASI: ${hits.join(", ")}`);

    // mevcut kayıt / ContentSlug çakışması
    const existing = existingBySlug.get(p.slug) ?? null;
    let action: Action = existing ? "güncelle" : "oluştur";
    if (existing) {
      if (existing.deletedAt) {
        action = "atla";
        warnings.push("yazı çöp kutusunda; atlandı.");
      } else if (existing.status !== "DRAFT") {
        action = "atla";
        warnings.push(`yazı ${existing.status}; atlandı (yayındaki içerik ezilmez).`);
      } else if (existing.medicalReviewStatus === "approved") {
        action = "atla";
        warnings.push("yazı hekim onaylı (approved); atlandı (onaylı içerik ezilmez).");
      }
    }
    if (action !== "atla") {
      const slugLocales = [...new Set([defaultLocale.code, ...(plan.defaultIsEn ? [] : ["en"])])];
      const clash = await prisma.contentSlug.findFirst({
        where: {
          slug: p.slug,
          locale: { in: slugLocales },
          NOT: existing ? { entityType: "BLOG_POST", entityId: existing.id } : undefined,
        },
      });
      if (clash) err(`slug başka bir içerikte kullanımda (ContentSlug ${clash.entityType}/${clash.locale}).`);
    }

    plan.errors.push(...errors);

    // veri
    const translationsEn = plan.defaultIsEn
      ? null
      : {
          title: p.title,
          excerpt: p.excerpt,
          contentHtml: p.contentHtml,
          seoTitle: p.seoTitle,
          seoDescription: p.seoDescription,
          keyTakeaways: kt.success ? kt.data : [],
          faq: fq.success ? fq.data : [],
        };
    const data: NonNullable<PostPlan["data"]> = {
      title: p.title,
      excerpt: p.excerpt,
      contentHtml: cleanHtml,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      keyTakeaways: kt.success ? kt.data : [],
      faq: fq.success ? fq.data : [],
      references: rf.success ? rf.data : [],
      readingMinutes: computeReadingMinutes(cleanHtml),
      categoryId: null,
      categorySlug: p.categorySlug,
      specialtyId,
      careTopicIds: [...new Set(topicIds)],
      reviewerDoctorId: reviewerId,
      medicalReviewStatus: p.medicalReviewStatus,
      medicalReviewNote: p.medicalReviewNote,
      translationsEn,
    };
    let note = "";
    if (action === "güncelle" && existing && errors.length === 0 && isUnchanged(existing, data, dbCats.get(p.categorySlug)?.id ?? null)) {
      action = "atla";
      note = "(değişiklik yok)";
    }
    plan.posts.push({
      planNumber: p.planNumber,
      slug: p.slug,
      action,
      warnings,
      note,
      existingId: existing?.id ?? null,
      newId: existing ? null : crypto.randomUUID(),
      data: action === "atla" || errors.length > 0 ? null : data,
    });
  }

  if (batch.posts.length === 0) plan.globalWarnings.push("partide yazı yok.");
  return plan;
}

// ---------------------------------------------------------------- yazdırma

function printPlan(plan: Plan) {
  console.log(`\nParti: ${plan.batch} | varsayılan dil: ${plan.defaultLocale}`);
  for (const w of plan.globalWarnings) console.log(`[UYARI] ${w}`);
  if (plan.categories.length > 0) {
    console.log("\nKATEGORİLER");
    for (const c of plan.categories) {
      const extra = c.action === "güncelle" ? ` (+çeviri: ${c.addedLocales.join(",")})` : "";
      console.log(`  ${c.slug.padEnd(32)} ${c.action}${extra}${c.warnings.length ? `  | ${c.warnings.join(" | ")}` : ""}`);
    }
  }
  console.log("\nYAZILAR");
  console.log("  planNo  slug                                              işlem      uyarılar");
  for (const p of plan.posts) {
    console.log(`  ${String(p.planNumber).padEnd(7)} ${p.slug.padEnd(49)} ${p.action.padEnd(10)} ${[p.note, ...p.warnings].filter(Boolean).join(" | ")}`);
  }
  const count = (list: { action: Action }[], a: Action) => list.filter((x) => x.action === a).length;
  const warned = plan.posts.filter((p) => p.warnings.length > 0).length;
  console.log(
    `\nÖzet: yazı oluştur=${count(plan.posts, "oluştur")} güncelle=${count(plan.posts, "güncelle")} atla=${count(plan.posts, "atla")} | ` +
      `kategori oluştur=${count(plan.categories, "oluştur")} güncelle=${count(plan.categories, "güncelle")} atla=${count(plan.categories, "atla")} | ` +
      `uyarılı yazı=${warned} | hata=${plan.errors.length}`
  );
}

// ---------------------------------------------------------------- yazım

const POST_RESTORE_FIELDS = [
  "title", "excerpt", "contentHtml", "seoTitle", "seoDescription", "keyTakeaways", "faq", "references", "translations",
  "readingMinutes", "categoryId", "specialtyId", "careTopicIds", "reviewerDoctorId", "medicalReviewStatus", "medicalReviewNote",
] as const;

async function enabledLocaleList() {
  const locales = await prisma.locale.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  const def = locales.find((l) => l.isDefault);
  if (def) return locales;
  const dflt = await prisma.locale.findFirstOrThrow({ where: { isDefault: true } });
  return [...locales, dflt];
}

async function writeBackup(plan: Plan, dir: string, operator: string): Promise<string> {
  const updatedPostIds = plan.posts.filter((p) => p.action === "güncelle").map((p) => p.existingId!);
  const updatedCatIds = plan.categories.filter((c) => c.action === "güncelle").map((c) => c.existingId!);
  const [posts, cats] = await Promise.all([
    prisma.blogPost.findMany({ where: { id: { in: updatedPostIds } } }),
    prisma.blogCategory.findMany({ where: { id: { in: updatedCatIds } } }),
  ]);
  const snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    batch: plan.batch,
    operator,
    defaultLocale: plan.defaultLocale,
    created: {
      categories: plan.categories.filter((c) => c.action === "oluştur").map((c) => ({ id: c.newId, slug: c.slug })),
      posts: plan.posts.filter((p) => p.action === "oluştur").map((p) => ({ id: p.newId, slug: p.slug })),
    },
    updated: { categories: cats, posts },
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `blog-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  return file;
}

async function applyPlan(plan: Plan, operator: string, backupName: string) {
  const enabled = await enabledLocaleList();
  const counts = { postsCreated: 0, postsUpdated: 0, postsSkipped: 0, categoriesCreated: 0, categoriesUpdated: 0 };

  await prisma.$transaction(
    async (tx) => {
      const catIdBySlug = new Map<string, string>();
      for (const c of plan.categories) {
        if (c.action === "oluştur") {
          await tx.blogCategory.create({
            data: { id: c.newId!, name: c.name, slug: c.slug, isMedical: c.isMedical, translations: jsonValue(c.translations) },
          });
          catIdBySlug.set(c.slug, c.newId!);
          counts.categoriesCreated++;
        } else {
          catIdBySlug.set(c.slug, c.existingId!);
          if (c.action === "güncelle") {
            await tx.blogCategory.update({ where: { id: c.existingId! }, data: { translations: jsonValue(c.translations) } });
            counts.categoriesUpdated++;
          }
        }
      }
      for (const p of plan.posts) {
        if (p.action === "atla" || !p.data) {
          counts.postsSkipped++;
          continue;
        }
        const d = p.data;
        const categoryId = catIdBySlug.get(d.categorySlug) ?? (await tx.blogCategory.findUniqueOrThrow({ where: { slug: d.categorySlug } })).id;

        let existingTranslations: Record<string, Record<string, unknown> | null> = {};
        if (p.existingId) {
          const cur = await tx.blogPost.findUniqueOrThrow({ where: { id: p.existingId }, select: { translations: true } });
          existingTranslations = (cur.translations ?? {}) as typeof existingTranslations;
        }
        const translations = d.translationsEn
          ? sanitizeBlogTranslations({ ...existingTranslations, en: d.translationsEn })
          : existingTranslations;

        const fields = {
          title: d.title,
          excerpt: d.excerpt,
          contentHtml: d.contentHtml,
          seoTitle: d.seoTitle,
          seoDescription: d.seoDescription,
          keyTakeaways: jsonValue(d.keyTakeaways),
          faq: jsonValue(d.faq),
          references: jsonValue(d.references),
          readingMinutes: d.readingMinutes,
          categoryId,
          specialtyId: d.specialtyId,
          careTopicIds: d.careTopicIds,
          reviewerDoctorId: d.reviewerDoctorId,
          medicalReviewStatus: d.medicalReviewStatus,
          // Alan partide yoksa (undefined) Prisma kolona dokunmaz → mevcut not korunur.
          ...(d.medicalReviewNote !== undefined ? { medicalReviewNote: d.medicalReviewNote } : {}),
          translations: jsonValue(translations),
        };
        let post;
        if (p.existingId) {
          post = await tx.blogPost.update({ where: { id: p.existingId }, data: fields });
          counts.postsUpdated++;
        } else {
          post = await tx.blogPost.create({
            data: { id: p.newId!, slug: p.slug, status: "DRAFT", isFeatured: false, coverImageUrl: null, ...fields },
          });
          counts.postsCreated++;
        }
        await syncContentSlugs(tx, enabled, "BLOG_POST", post.id, post.slug, post.translations);
      }

      await tx.auditLog.create({
        data: {
          actorEmail: `script:${operator}`,
          action: "blog.import_batch",
          targetType: "BlogPost",
          metadata: { script: "import-blog-posts", batch: plan.batch, operator, backup: backupName, ...counts },
        },
      });
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  return counts;
}

// ---------------------------------------------------------------- restore

interface BackupFile {
  version: number;
  batch: string;
  created: { categories: { id: string; slug: string }[]; posts: { id: string; slug: string }[] };
  updated: { categories: Record<string, unknown>[]; posts: Record<string, unknown>[] };
}

async function restoreBackup(file: string, operator: string, write: boolean, revalidate: boolean) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as BackupFile;
  if (snap.version !== 1 || !snap.created || !snap.updated) throw new Error("Geçersiz yedek dosyası biçimi.");
  const enabled = await enabledLocaleList();
  const result = { postsDeleted: 0, postsReverted: 0, categoriesDeleted: 0, categoriesReverted: 0, skipped: 0 };
  const log = (m: string) => console.log(`${write ? "" : "[kuru] "}${m}`);

  const restorable = (p: { status: string; medicalReviewStatus: string | null; deletedAt: Date | null } | null) =>
    p !== null && p.status === "DRAFT" && p.medicalReviewStatus !== "approved";

  await prisma.$transaction(
    async (tx) => {
      for (const c of snap.created.posts) {
        const cur = await tx.blogPost.findUnique({ where: { id: c.id } });
        if (!cur) {
          log(`[atla] yazı ${c.slug}: zaten yok.`);
          continue;
        }
        if (!restorable(cur)) {
          log(`[UYARI] yazı ${c.slug}: artık ${cur.status}/${cur.medicalReviewStatus ?? "pending"}; SİLİNMEDİ.`);
          result.skipped++;
          continue;
        }
        log(`yazı silinecek: ${c.slug}`);
        if (write) {
          await deleteContentSlugsForEntity(tx, "BLOG_POST", c.id);
          await tx.blogPost.delete({ where: { id: c.id } });
        }
        result.postsDeleted++;
      }
      for (const row of snap.updated.posts) {
        const id = String(row.id);
        const cur = await tx.blogPost.findUnique({ where: { id } });
        if (!cur) {
          log(`[atla] yazı ${String(row.slug)}: artık yok.`);
          continue;
        }
        if (!restorable(cur)) {
          log(`[UYARI] yazı ${cur.slug}: artık ${cur.status}/${cur.medicalReviewStatus ?? "pending"}; ESKİ HÂLİNE DÖNDÜRÜLMEDİ.`);
          result.skipped++;
          continue;
        }
        log(`yazı eski hâline dönecek: ${cur.slug}`);
        if (write) {
          const data: Record<string, unknown> = {};
          for (const f of POST_RESTORE_FIELDS) {
            const v = row[f];
            data[f] = ["keyTakeaways", "faq", "references", "translations"].includes(f) ? jsonValue(v ?? (f === "translations" ? {} : [])) : v;
          }
          const updated = await tx.blogPost.update({ where: { id }, data: data as Prisma.BlogPostUncheckedUpdateInput });
          await syncContentSlugs(tx, enabled, "BLOG_POST", updated.id, updated.slug, updated.translations);
        }
        result.postsReverted++;
      }
      for (const c of snap.created.categories) {
        const cur = await tx.blogCategory.findUnique({ where: { id: c.id }, include: { _count: { select: { posts: true } } } });
        if (!cur) continue;
        // Yazım yapılmıyorsa (kuru) silinecek yazıların etkisi hesaba katılmaz; gerçekte yazılar önce silinir.
        const remaining = write ? cur._count.posts : cur._count.posts - snap.created.posts.length;
        if (remaining > 0) {
          log(`[UYARI] kategori ${c.slug}: hâlâ ${cur._count.posts} yazı bağlı; SİLİNMEDİ.`);
          result.skipped++;
          continue;
        }
        log(`kategori silinecek: ${c.slug}`);
        if (write) await tx.blogCategory.delete({ where: { id: c.id } });
        result.categoriesDeleted++;
      }
      for (const row of snap.updated.categories) {
        log(`kategori eski hâline dönecek: ${String(row.slug)}`);
        if (write) {
          await tx.blogCategory.update({
            where: { id: String(row.id) },
            data: { name: String(row.name), isMedical: Boolean(row.isMedical), translations: jsonValue(row.translations ?? {}) },
          });
        }
        result.categoriesReverted++;
      }
      if (write) {
        await tx.auditLog.create({
          data: {
            actorEmail: `script:${operator}`,
            action: "blog.import_restore",
            targetType: "BlogPost",
            metadata: { script: "import-blog-posts", batch: snap.batch, operator, backup: path.basename(file), ...result },
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 20_000 }
  );

  console.log(
    `${write ? "[geri yüklendi]" : "[kuru] hiçbir şey yazılmadı —"} yazı silinen=${result.postsDeleted} eski hâle=${result.postsReverted} | kategori silinen=${result.categoriesDeleted} eski hâle=${result.categoriesReverted} | atlanan=${result.skipped}`
  );
  if (write && revalidate) await triggerTagRevalidation(appLike(), [CACHE_TAGS.blog]);
}

// ---------------------------------------------------------------- main

async function main() {
  const { file, confirm, operator, restore, backupDir, revalidate } = parseArgs(process.argv.slice(2));
  const write = confirm === CONFIRM_TOKEN;
  if (confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  console.log(`[import-blog-posts] mod=${restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);

  if (restore) {
    const f = path.resolve(restore);
    if (!fs.existsSync(f)) throw new Error(`Yedek dosyası bulunamadı: ${f}`);
    await restoreBackup(f, operator?.trim() ?? "", write, revalidate);
    return;
  }

  if (!file) throw new Error("--file=<parti.json> zorunludur.");
  const f = path.resolve(file);
  if (!fs.existsSync(f)) throw new Error(`Parti dosyası bulunamadı: ${f}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    throw new Error(`Parti dosyası geçerli JSON değil: ${e instanceof Error ? e.message : String(e)}`);
  }

  const plan = await buildPlan(raw);
  printPlan(plan);

  if (plan.errors.length > 0) {
    console.error(`\nDOĞRULAMA HATALARI (${plan.errors.length}) — HİÇBİR ŞEY YAZILMADI:`);
    for (const e of plan.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  if (!write) {
    console.log("\n[kuru] hiçbir şey yazılmadı. Yazmak için: --confirm=import-blog --operator=<ad>");
    return;
  }

  const changes = plan.posts.some((p) => p.action !== "atla") || plan.categories.some((c) => c.action !== "atla");
  if (!changes) {
    console.log("\n[bilgi] Yapılacak değişiklik yok.");
    return;
  }
  const backup = await writeBackup(plan, path.resolve(backupDir ?? "storage/backups"), operator!.trim());
  console.log(`\n[yedek] ${backup}`);
  const counts = await applyPlan(plan, operator!.trim(), path.basename(backup));
  console.log(`[yazıldı] ${JSON.stringify(counts)}`);
  console.log(`[geri al] npx tsx scripts/import-blog-posts.ts --restore=${backup} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
  if (revalidate) await triggerTagRevalidation(appLike(), [CACHE_TAGS.blog]);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
