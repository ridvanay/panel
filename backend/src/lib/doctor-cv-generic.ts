/**
 * Paket U (2026-10-28) — genel doktor CV aktarımı (`scripts/import-doctor-cv.ts`).
 *
 * Kaynak: düz anlatı CV metni (docx → txt). Biçim Vahit Mutlu CV'sinden (tablolu, pandoc) farklıdır:
 *  - Bölüm başlıkları ayrı satırda ("Education and Career Background", "MEMBERSHIPS",
 *    "INTERNATIONAL PUBLICATIONS" …). Aynı başlık birden çok kez geçebilir; kalemler TEKİLLEŞTİRİLİR.
 *  - CV kalemleri anlatı cümlelerinden kurallarla çıkarılır (`NARRATIVE_RULES`). Eşleşmeyen madde
 *    "anlatıda kalır" diye listelenir; yıl uydurulmaz.
 *  - Yayınlar Vancouver künyesinden ayrıştırılır; künyede yıl yoksa kayıt EKLENMEZ ve listelenir.
 *
 * Güvenlik deseni `doctor-cv-import.ts` ile aynı: varsayılan kuru çalışma, `--confirm` + `--operator`,
 * yazmadan önce JSON yedek, tek transaction, audit kaydı, `--restore`. Doktor OLUŞTURMAZ; `id`, `slug`,
 * `userId`, `fullName`, `avatarMediaId`, uzmanlık ilişkileri, `title` ve `bio` DEĞİŞMEZ; `aboutHtml`
 * yalnızca `--with-about` ile yeniden üretilir.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { sanitizeRichHtml } from "./html-sanitize";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";
import { DoctorCvEntrySchema, DoctorPublicationSchema, type DoctorCvEntryDto, type DoctorPublicationDto } from "../schemas/entities";
import {
  DoctorImportError,
  IMPORT_AUDIT_ACTION,
  MAX_CV_ENTRIES,
  MAX_PUBLICATIONS,
  RESTORE_AUDIT_ACTION,
  appLike,
  assertOperator,
  cleanAuthors,
  extractDoi,
  extractYear,
  findPrivateInfo,
  readDoctorBackup,
  writeBackup,
  type Db,
  type OperatorInfo,
  type SkippedItem,
} from "./doctor-cv-import";

export const CV_IMPORT_CONFIRM_KEY = "import-cv";
export const CV_RESTORE_CONFIRM_KEY = "restore-cv";
export const CV_IMPORT_TOOL = "import-doctor-cv";

/* ------------------------------------------------------------------ */
/* Bölümler                                                            */
/* ------------------------------------------------------------------ */

type SectionKind = "CAREER" | "MEMBERSHIP" | "INTERNATIONAL_ARTICLE" | "NATIONAL_ARTICLE" | "BOOK_CHAPTER" | "PROCEEDING";

/** Başlık satırı → bölüm türü (büyük/küçük harf duyarsız, tam satır). */
const SECTION_PATTERNS: { kind: SectionKind; pattern: RegExp }[] = [
  { kind: "CAREER", pattern: /^(education and career background|education|career|professional experience)$/i },
  { kind: "MEMBERSHIP", pattern: /^(memberships?|professional memberships?)$/i },
  { kind: "INTERNATIONAL_ARTICLE", pattern: /^international (publications|articles)$/i },
  { kind: "NATIONAL_ARTICLE", pattern: /^national (publications|articles)$/i },
  { kind: "BOOK_CHAPTER", pattern: /^book chapters?$/i },
  { kind: "PROCEEDING", pattern: /^(international|national) (conference|congress) (presentations|proceedings|papers)$/i },
];

export interface NarrativeSections {
  /** Başlıktan önceki paragraflar (ad/unvan satırı hariç anlatı). */
  intro: string[];
  /** Bölüm türü → tekilleştirilmiş kalemler (madde/numara işaretleri atılmış, boşluklar sadeleşmiş). */
  items: Map<SectionKind, string[]>;
  /** Bölüm türü → kaç kez başlık olarak geçtiği (tekrar raporu için). */
  headingCounts: Map<SectionKind, number>;
  /** Aynı bölümde ikinci kez geçtiği için atılan kalem sayısı. */
  duplicatesRemoved: number;
}

const normalizeSpace = (value: string) => value.replace(/\s+/g, " ").trim();
const LIST_MARKER = /^(?:[-•–]\s+|\d{1,3}\.\s+)/;

export function splitNarrativeSections(text: string): NarrativeSections {
  const intro: string[] = [];
  const items = new Map<SectionKind, string[]>();
  const headingCounts = new Map<SectionKind, number>();
  const seen = new Map<SectionKind, Set<string>>();
  let duplicatesRemoved = 0;
  let current: SectionKind | null = null;
  // Paragraflar boş satırla ayrılır; çok satırlı kalemler birleştirilir.
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).join(" "))
    .map((p) => p.trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) {
    const heading = SECTION_PATTERNS.find(({ pattern }) => pattern.test(paragraph));
    if (heading) {
      current = heading.kind;
      headingCounts.set(current, (headingCounts.get(current) ?? 0) + 1);
      if (!items.has(current)) items.set(current, []);
      continue;
    }
    if (!current) {
      intro.push(normalizeSpace(paragraph));
      continue;
    }
    const item = normalizeSpace(paragraph.replace(LIST_MARKER, ""));
    const key = item.toLocaleLowerCase("en");
    const bucket = seen.get(current) ?? new Set<string>();
    seen.set(current, bucket);
    if (bucket.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    bucket.add(key);
    items.get(current)!.push(item);
  }
  return { intro, items, headingCounts, duplicatesRemoved };
}

/* ------------------------------------------------------------------ */
/* Yayınlar (Vancouver künyesi)                                        */
/* ------------------------------------------------------------------ */

const DATE_LIKE = /^(?:\d|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b)/;
const YEAR_IN_SEGMENT = /(?<![\d.])(?:19[5-9]\d|20\d\d)(?!\d)/;

function stripDoiAndUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, " ").replace(/\bdoi\s*:\s*/gi, " ").replace(/\b10\.\d{4,9}\/[^\s,;]+/gi, " ");
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

const trimPunct = (value: string) => value.replace(/[\s.,;:]+$/u, "").replace(/^[\s.,;:]+/u, "");

/**
 * "Yazarlar. Başlık. Dergi/Kongre. Yıl;cilt:sayfa. DOI: …" → yayın. Bölütler `.`/`?` + boşlukla
 * ayrılır; yıl içeren ilk bölüt (yazarlar ve başlıktan sonra) bulunur. O bölüt tarih gibi
 * başlıyorsa ("2003;33(1)…", "June 8–11, 2000") yayın yeri bir önceki bölüttür; değilse ("CIRSE 2003",
 * "TSIR and EVIS 2019 …") yıl yayın yerinin adındadır. Yıl yoksa `null` döner (yıl uydurulmaz).
 */
export function parseVancouver(kind: DoctorPublicationDto["kind"], entry: string): { publication: DoctorPublicationDto | null; title: string } {
  const doi = extractDoi(entry);
  const segments = entry.split(/(?<=[.?])\s+/).map((s) => s.trim()).filter(Boolean);
  const authors = trimPunct(segments[0] ?? "");
  const rest = segments.slice(1);
  let yearIndex = -1;
  for (let i = 1; i < rest.length; i++) {
    if (YEAR_IN_SEGMENT.test(stripDoiAndUrls(rest[i]!))) {
      yearIndex = i;
      break;
    }
  }
  if (yearIndex < 0) {
    // Başlıktan sonra yıl yok → başlık en az ilk bölüttür; kayıt eklenmez.
    return { publication: null, title: trimPunct(rest[0] ?? entry) };
  }
  const venueStart = DATE_LIKE.test(rest[yearIndex]!) && yearIndex - 1 >= 1 ? yearIndex - 1 : yearIndex;
  const title = trimPunct(rest.slice(0, venueStart).join(" "));
  const venue = trimPunct(normalizeSpace(stripDoiAndUrls(rest.slice(venueStart).join(" ")).replace(/\bPMC?ID:\s*\S+/gi, " ")));
  const year = extractYear(rest.slice(venueStart).join(" "));
  if (!title || !venue || year == null) return { publication: null, title: title || trimPunct(rest[0] ?? entry) };
  return {
    title,
    publication: {
      kind,
      title: clamp(title, 300),
      venue: clamp(venue, 200),
      authors: clamp(cleanAuthors(authors), 300),
      year,
      doi: doi ? clamp(doi, 120) : null,
      url: null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Anlatı kuralları (CV kalemleri)                                     */
/* ------------------------------------------------------------------ */

/** Kısaltma noktası için geçici yer tutucu (özel kullanım alanı karakteri). */
const ABBR_DOT = "";

function sentences(paragraph: string): string[] {
  // "Dr." / "Prof." kısaltmalarında cümle bölünmez.
  return (
    paragraph
      .replace(/\b(Dr|Prof|Assoc|Assist|Op)\.\s/g, `$1${ABBR_DOT} `)
      .match(/[^.!?]+(?:[.!?](?!\d)|$)+/g)
      ?.map((s) => s.replaceAll(ABBR_DOT, ".").trim())
      .filter(Boolean) ?? []
  );
}

/** "A, B, C, and D" → ["A", "B", "C", "D"]. */
export function splitList(value: string): string[] {
  return value
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((x) => trimPunct(x.replace(/^the\s+/i, "")))
    .filter(Boolean);
}

const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("en") + value.slice(1);

function degreeTitle(organization: string): string {
  if (/dentistry/i.test(organization)) return "Doctor of Dental Surgery (DDS)";
  if (/medicine|medical/i.test(organization)) return "Doctor of Medicine (MD)";
  return "University Degree";
}

const END_NOT_STATED = "End year not stated in the CV.";

interface RuleContext {
  entries: DoctorCvEntryDto[];
  skipped: SkippedItem[];
  /** Son eğitim kaleminin kurumu ("the same university’s …" çözümü için). */
  lastEducationOrg: string | null;
  lastEducationEnd: number | null;
  /** "Following his specialty training, he worked as … at X." → bitişi sonraki cümleden gelir. */
  pendingExperience: DoctorCvEntryDto | null;
  /** Özel muayenehane dönemi (Kadir Kolcuoğlu) — "currently practices at …" ile birleşir. */
  privatePractice: DoctorCvEntryDto | null;
}

type Rule = { name: string; pattern: RegExp; apply: (m: RegExpMatchArray, ctx: RuleContext) => void };

function addAward(ctx: RuleContext, title: string | undefined, year: string | undefined) {
  if (!title || !year) return;
  ctx.entries.push({ kind: "AWARD", title: clamp(capitalize(trimPunct(title)), 160), organization: "Academic title", startYear: Number(year), endYear: Number(year) });
}

function addEducation(ctx: RuleContext, entry: DoctorCvEntryDto) {
  ctx.entries.push(entry);
  ctx.lastEducationOrg = entry.organization;
  ctx.lastEducationEnd = entry.endYear ?? null;
}

function resolveOrg(org: string, ctx: RuleContext): string {
  const cleaned = trimPunct(org.replace(/^the\s+/i, ""));
  const same = cleaned.match(/^same university[’']s\s+(.+)$/i);
  if (same && ctx.lastEducationOrg) {
    const university = ctx.lastEducationOrg.replace(/\s+Faculty of .+$/i, "");
    return `${university} ${capitalize(same[1]!)}`;
  }
  return cleaned;
}

/** Sıra önemli: ilk eşleşen kural uygulanır. */
const NARRATIVE_RULES: Rule[] = [
  {
    name: "graduation+first-job",
    pattern: /^After graduating from (.+?) in (\d{4}), he began working as an? (.+?) at (.+?) that same year\.?$/i,
    apply: ([, school, year, role, org], ctx) => {
      addEducation(ctx, { kind: "EDUCATION", title: degreeTitle(school!), organization: clamp(trimPunct(school!), 160), startYear: Number(year), endYear: Number(year), description: "Graduation year." });
      ctx.entries.push({ kind: "EXPERIENCE", title: clamp(capitalize(role!), 160), organization: clamp(trimPunct(org!), 160), startYear: Number(year), endYear: Number(year), description: END_NOT_STATED });
    },
  },
  {
    name: "undergraduate",
    pattern: /^He began his undergraduate studies at (.+?) in (\d{4}) and graduated in (\d{4})\.?$/i,
    apply: ([, school, start, end], ctx) =>
      addEducation(ctx, { kind: "EDUCATION", title: degreeTitle(school!), organization: clamp(trimPunct(school!), 160), startYear: Number(start), endYear: Number(end) }),
  },
  {
    name: "residency",
    pattern: /^Between (\d{4}) and (\d{4}), he completed his residency in (.+?) at (.+?)\.?$/i,
    apply: ([, start, end, field, org], ctx) =>
      addEducation(ctx, { kind: "EDUCATION", title: clamp(`Residency in ${capitalize(field!)}`, 160), organization: clamp(trimPunct(org!), 160), startYear: Number(start), endYear: Number(end) }),
  },
  {
    name: "specialty-training-start",
    pattern: /^In (\d{4}), he began his specialty training in the Department of (.+?) at (.+?)\.?$/i,
    apply: ([, start, field, org], ctx) => {
      // Bitiş yılı ve tez sonraki cümleden ("He completed his training in YYYY with his thesis titled …").
      const entry: DoctorCvEntryDto = { kind: "EDUCATION", title: clamp(`Specialty Training in ${capitalize(field!)}`, 160), organization: clamp(resolveOrg(org!, ctx), 160), startYear: Number(start) };
      addEducation(ctx, entry);
    },
  },
  {
    name: "specialty-training-end",
    pattern: /^He completed his training in (\d{4})(?: with his thesis titled [“"](.+?)[,.]?[”"])?/i,
    apply: ([, end, thesis], ctx) => {
      const entry = [...ctx.entries].reverse().find((e) => e.kind === "EDUCATION" && e.endYear === undefined);
      if (!entry) return;
      entry.endYear = Number(end);
      if (thesis) entry.description = clamp(`Thesis: ${trimPunct(thesis)}`, 500);
      ctx.lastEducationEnd = entry.endYear;
    },
  },
  {
    name: "worked-between",
    pattern: /^Between (\d{4}) and (\d{4}), he (?:worked|served) as an? (.+?) (?:in the (.+?) )?at (.+?)(?:,\s*respectively)?(?: and was awarded the title of (.+?) in (\d{4}))?\.?$/i,
    apply: ([, start, end, role, unit, orgs, award, awardYear], ctx) => {
      const list = splitList(orgs!);
      const title = unit ? `${capitalize(role!)}, ${unit}` : capitalize(role!);
      ctx.entries.push({
        kind: "EXPERIENCE",
        title: clamp(title, 160),
        organization: clamp(list.join(", "), 160),
        startYear: Number(start),
        endYear: Number(end),
        // Birden çok kurum tek kalemde: CV yalnızca toplam aralığı veriyor, kurum bazında yıl yok.
        ...(list.length > 1 ? { description: "Served at these hospitals consecutively; individual years are not stated in the CV." } : {}),
      });
      addAward(ctx, award, awardYear);
    },
  },
  {
    name: "worked-in-department",
    pattern: /^Between (\d{4}) and (\d{4}), he worked in the (.+?) at (.+?)\.?$/i,
    apply: ([, start, end, unit, org], ctx) =>
      ctx.entries.push({ kind: "EXPERIENCE", title: clamp(capitalize(unit!), 160), organization: clamp(trimPunct(org!), 160), startYear: Number(start), endYear: Number(end) }),
  },
  {
    name: "joined-current",
    pattern: /^He joined the (.+?) at (.+?) in (\d{4})(?: and was awarded the title of (.+?) in (\d{4}))?\.?$/i,
    apply: ([, unit, org, start, award, awardYear], ctx) => {
      ctx.entries.push({ kind: "EXPERIENCE", title: clamp(capitalize(unit!), 160), organization: clamp(trimPunct(org!), 160), startYear: Number(start), endYear: null });
      addAward(ctx, award, awardYear);
    },
  },
  {
    name: "following-training",
    pattern: /^Following his specialty training, he worked as an? (.+?) at (.+?)\.?$/i,
    apply: ([, role, org], ctx) => {
      if (ctx.lastEducationEnd == null) return;
      const entry: DoctorCvEntryDto = { kind: "EXPERIENCE", title: clamp(capitalize(role!), 160), organization: clamp(trimPunct(org!), 160), startYear: ctx.lastEducationEnd };
      ctx.entries.push(entry);
      ctx.pendingExperience = entry;
    },
  },
  {
    name: "left-public-service",
    pattern: /^In (\d{4}), he left public service and continued .*? at (private .+?)\.?$/i,
    apply: ([, year, where], ctx) => {
      if (ctx.pendingExperience) ctx.pendingExperience.endYear = Number(year);
      ctx.pendingExperience = null;
      const entry: DoctorCvEntryDto = {
        kind: "EXPERIENCE",
        title: ctx.entries.find((e) => e.kind === "EXPERIENCE")?.title ?? "Specialist",
        organization: clamp(capitalize(trimPunct(where!)), 160),
        startYear: Number(year),
        endYear: null,
      };
      ctx.entries.push(entry);
      ctx.privatePractice = entry;
    },
  },
  {
    name: "currently-practices",
    pattern: /^He currently practices at (?:his own clinic,\s*)?(.+?),/i,
    apply: ([, clinic], ctx) => {
      // Muayenehanenin açılış yılı CV'de yok: özel muayenehane dönemiyle (başlangıcı belli) birleştirilir.
      const entry = ctx.privatePractice;
      if (!entry) return;
      const previous = entry.organization;
      entry.organization = clamp(trimPunct(clinic!), 160);
      entry.description = clamp(`${capitalize(previous)} since ${entry.startYear}; currently at his own clinic, ${trimPunct(clinic!)} (the year it opened is not stated in the CV).`, 500);
    },
  },
  {
    name: "member-of",
    pattern: /^He is a member of (.+?)\.?$/i,
    apply: ([, list], ctx) => {
      for (const organization of splitList(list!)) ctx.entries.push({ kind: "MEMBERSHIP", title: "Member", organization: clamp(organization, 160), startYear: null, endYear: null });
    },
  },
];

/** CV kalemi olmayan (bilerek eklenmeyen) anlatı cümleleri. */
const NON_CV_SENTENCES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(aikido|dan rank|coaching certificate)\b/i, reason: "Tıbbi yeterlilik değil (görev dosyası); yalnızca anlatıda kalır." },
  { pattern: /\battended numerous\b.*\bcongresses\b/i, reason: "Genel ifade; CV kalemi değil." },
];

/** Yılı olmayan sertifika: şema `startYear` ister; yıl uydurulmaz → eklenmez, raporlanır. */
const CERTIFICATE_SENTENCE = /^He holds an? ((?:Certificate|Certification) of .+?), awarded (?:through a program organized )?by (.+?)(?: in accordance .*)?\.?$/i;

export interface ParsedNarrativeCv {
  cvEntries: DoctorCvEntryDto[];
  publications: DoctorPublicationDto[];
  skipped: SkippedItem[];
  /** `--with-about` için anlatıdan üretilen biyografi. */
  aboutHtml: string;
  sections: { headingCounts: Record<string, number>; duplicatesRemoved: number };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Ad/unvan satırı ve tek satırlık uzmanlık başlığı anlatıya girmez. */
function isNameOrTagline(paragraph: string): boolean {
  return paragraph.length < 80 && !/[.!?]$/.test(paragraph);
}

export function parseNarrativeCv(text: string): ParsedNarrativeCv {
  const { intro, items, headingCounts, duplicatesRemoved } = splitNarrativeSections(text);
  const ctx: RuleContext = { entries: [], skipped: [], lastEducationOrg: null, lastEducationEnd: null, pendingExperience: null, privatePractice: null };

  // Kariyer cümleleri: "Education and Career Background" maddeleri + (başlıksız CV'lerde) giriş paragrafları.
  const careerSentences = [...(items.get("CAREER") ?? []), ...intro.filter((p) => !isNameOrTagline(p))].flatMap(sentences);
  for (const sentence of careerSentences) {
    const rule = NARRATIVE_RULES.find((r) => r.pattern.test(sentence));
    if (rule) {
      rule.apply(sentence.match(rule.pattern)!, ctx);
      continue;
    }
    const cert = sentence.match(CERTIFICATE_SENTENCE);
    if (cert) {
      ctx.skipped.push({ section: "CERTIFICATE", title: trimPunct(cert[1]!), reason: `Yıl belirtilmemiş (kurum: ${trimPunct(cert[2]!)}); şema yıl ister, yıl uydurulmaz. Anlatıda kalır.` });
      continue;
    }
    const nonCv = NON_CV_SENTENCES.find((n) => n.pattern.test(sentence));
    if (nonCv) {
      ctx.skipped.push({ section: "CAREER", title: clamp(sentence, 120), reason: nonCv.reason });
    }
  }
  for (const item of items.get("MEMBERSHIP") ?? []) {
    ctx.entries.push({ kind: "MEMBERSHIP", title: "Member", organization: clamp(trimPunct(item), 160), startYear: null, endYear: null });
  }

  const publications: DoctorPublicationDto[] = [];
  for (const kind of ["INTERNATIONAL_ARTICLE", "NATIONAL_ARTICLE", "BOOK_CHAPTER", "PROCEEDING"] as const) {
    (items.get(kind) ?? []).forEach((entry, i) => {
      const { publication, title } = parseVancouver(kind, entry);
      if (!publication) {
        ctx.skipped.push({ section: kind, title: clamp(`#${i + 1} ${title}`, 160), reason: "Künyede yıl yok; yıl uydurulmaz." });
        return;
      }
      publications.push(publication);
    });
  }

  // Biyografi (yalnızca --with-about): giriş paragrafları + kariyer maddeleri; üyelik/yayın yok.
  const aboutParagraphs = [...intro.filter((p) => !isNameOrTagline(p)), ...(items.get("CAREER") ?? [])];
  const aboutHtml = sanitizeRichHtml(aboutParagraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(""));

  return {
    cvEntries: ctx.entries,
    publications,
    skipped: ctx.skipped,
    aboutHtml,
    sections: { headingCounts: Object.fromEntries(headingCounts), duplicatesRemoved },
  };
}

/** API ile aynı Zod şemaları + gizli bilgi taraması. */
export function validateNarrative(parsed: ParsedNarrativeCv, withAbout: boolean): void {
  if (parsed.cvEntries.length > MAX_CV_ENTRIES) throw new DoctorImportError(`CV kalemi ${parsed.cvEntries.length} > ${MAX_CV_ENTRIES}.`);
  if (parsed.publications.length > MAX_PUBLICATIONS) throw new DoctorImportError(`Yayın ${parsed.publications.length} > ${MAX_PUBLICATIONS}.`);
  parsed.cvEntries.forEach((entry, i) => {
    const result = DoctorCvEntrySchema.safeParse(entry);
    if (!result.success) throw new DoctorImportError(`cvEntries[${i}] "${entry.title}" geçersiz: ${result.error.issues.map((x) => x.message).join("; ")}`);
  });
  parsed.publications.forEach((pub, i) => {
    const result = DoctorPublicationSchema.safeParse(pub);
    if (!result.success) throw new DoctorImportError(`publications[${i}] "${pub.title}" geçersiz: ${result.error.issues.map((x) => x.message).join("; ")}`);
  });
  const leaks = findPrivateInfo({ cv: parsed.cvEntries, pubs: parsed.publications, ...(withAbout ? { about: parsed.aboutHtml } : {}) });
  if (leaks.length) throw new DoctorImportError(`Yayımlanmaması gereken bilgi bulundu: ${leaks.join(", ")}.`);
}

/* ------------------------------------------------------------------ */
/* Plan / yazma / geri dönüş                                           */
/* ------------------------------------------------------------------ */

export interface GenericImportPlan {
  doctor: { id: string; slug: string; fullName: string; updatedAt: Date };
  parsed: ParsedNarrativeCv;
  withAbout: boolean;
  current: { cvEntries: number; publications: number; aboutLength: number };
}

export async function buildGenericImportPlan(db: Db, slug: string, file: string, options: { withAbout?: boolean } = {}): Promise<GenericImportPlan> {
  if (!/^[a-z0-9-]{2,120}$/.test(slug)) throw new DoctorImportError("--slug geçersiz.");
  const text = await fs.readFile(file, "utf8");
  const parsed = parseNarrativeCv(text);
  const withAbout = options.withAbout === true;
  validateNarrative(parsed, withAbout);
  const doctor = await db.doctorProfile.findUnique({ where: { slug } });
  if (!doctor) throw new DoctorImportError(`Doktor profili bulunamadı (slug="${slug}"). Bu script doktor OLUŞTURMAZ.`);
  return {
    doctor: { id: doctor.id, slug: doctor.slug, fullName: doctor.fullName, updatedAt: doctor.updatedAt },
    parsed,
    withAbout,
    current: {
      cvEntries: Array.isArray(doctor.cvEntries) ? doctor.cvEntries.length : 0,
      publications: Array.isArray(doctor.publications) ? doctor.publications.length : 0,
      aboutLength: (doctor.aboutHtml ?? "").length,
    },
  };
}

export function formatGenericPlan(plan: GenericImportPlan): string {
  const { parsed, current } = plan;
  const count = (kind: string, list: { kind: string }[]) => list.filter((x) => x.kind === kind).length;
  const repeated = Object.entries(parsed.sections.headingCounts).filter(([, n]) => n > 1);
  const lines = [
    `Doktor: ${plan.doctor.fullName} (${plan.doctor.slug}, id=${plan.doctor.id})`,
    "  title, bio, fullName, slug, uzmanlıklar: DEĞİŞMEZ",
    `  cvEntries: ${current.cvEntries} → ${parsed.cvEntries.length} (EDUCATION ${count("EDUCATION", parsed.cvEntries)}, EXPERIENCE ${count("EXPERIENCE", parsed.cvEntries)}, AWARD ${count("AWARD", parsed.cvEntries)}, CERTIFICATE ${count("CERTIFICATE", parsed.cvEntries)}, MEMBERSHIP ${count("MEMBERSHIP", parsed.cvEntries)})`,
    `  publications: ${current.publications} → ${parsed.publications.length} (INTERNATIONAL ${count("INTERNATIONAL_ARTICLE", parsed.publications)}, NATIONAL ${count("NATIONAL_ARTICLE", parsed.publications)}, BOOK_CHAPTER ${count("BOOK_CHAPTER", parsed.publications)}, PROCEEDING ${count("PROCEEDING", parsed.publications)})`,
    plan.withAbout ? `  aboutHtml: ${current.aboutLength} → ${parsed.aboutHtml.length} (--with-about)` : "  aboutHtml: DEĞİŞMEZ (--with-about verilmedi)",
    `  tekrarlanan bölüm başlıkları: ${repeated.length ? repeated.map(([k, n]) => `${k}×${n}`).join(", ") : "yok"}; atılan tekrar kalem: ${parsed.sections.duplicatesRemoved}`,
    "  gizli bilgi taraması (telefon, e-posta, doğum bilgisi): temiz",
  ];
  for (const e of parsed.cvEntries) {
    const years = e.startYear == null ? "" : ` ${e.startYear}–${e.endYear === null ? "devam" : (e.endYear ?? "?")}`;
    lines.push(`    [${e.kind}]${years} ${e.title} — ${e.organization}${e.description ? ` (${e.description})` : ""}`);
  }
  if (parsed.skipped.length) {
    lines.push(`Eklenmeyen kalemler (${parsed.skipped.length}):`);
    for (const s of parsed.skipped) lines.push(`  - [${s.section}] ${s.title} — ${s.reason}`);
  }
  return lines.join("\n");
}

export async function applyGenericCvImport(
  db: Db,
  plan: GenericImportPlan,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ backupFile: string }> {
  if (options.confirm !== CV_IMPORT_CONFIRM_KEY) throw new DoctorImportError(`Gerçek yazma için --confirm=${CV_IMPORT_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const now = options.now ?? new Date();
  const backupFile = await writeBackup(db, options.backupDir, plan.doctor.id, now);

  await db.$transaction(async (tx) => {
    const current = await tx.doctorProfile.findUnique({ where: { id: plan.doctor.id } });
    if (!current || current.updatedAt.getTime() !== plan.doctor.updatedAt.getTime()) {
      throw new DoctorImportError("Doktor kaydı plan alındıktan sonra değişmiş; işlem geri alındı. Kuru çalışmayı yeniden yapın.");
    }
    await tx.doctorProfile.update({
      where: { id: plan.doctor.id },
      data: {
        cvEntries: DoctorCvEntrySchema.array().parse(plan.parsed.cvEntries) as Prisma.InputJsonValue,
        publications: DoctorPublicationSchema.array().parse(plan.parsed.publications) as Prisma.InputJsonValue,
        ...(plan.withAbout ? { aboutHtml: plan.parsed.aboutHtml || null } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: IMPORT_AUDIT_ACTION,
        targetType: "DoctorProfile",
        targetId: plan.doctor.id,
        metadata: {
          tool: CV_IMPORT_TOOL,
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          backupFile: path.basename(backupFile),
          cvEntries: plan.parsed.cvEntries.length,
          publications: plan.parsed.publications.length,
          withAbout: plan.withAbout,
        },
      },
    });
  });

  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.doctors]);
  return { backupFile };
}

/** Yalnızca bu aracın yazdığı alanları (cvEntries, publications, aboutHtml) yedekteki hâline döndürür. */
export async function restoreGenericCvImport(
  db: Db,
  slug: string,
  backupFile: string,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ preRestoreBackup: string }> {
  if (options.confirm !== CV_RESTORE_CONFIRM_KEY) throw new DoctorImportError(`Geri dönüş için --confirm=${CV_RESTORE_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const backup = await readDoctorBackup(backupFile, slug);
  const doctor = await db.doctorProfile.findUnique({ where: { id: backup.doctorId }, select: { id: true, slug: true } });
  if (!doctor || doctor.slug !== backup.slug) throw new DoctorImportError("Yedekteki doktor bulunamadı ya da slug değişmiş.");
  const preRestoreBackup = await writeBackup(db, options.backupDir, doctor.id, options.now ?? new Date());
  await db.$transaction(async (tx) => {
    await tx.doctorProfile.update({
      where: { id: doctor.id },
      data: {
        cvEntries: backup.fields.cvEntries as Prisma.InputJsonValue,
        publications: backup.fields.publications as Prisma.InputJsonValue,
        aboutHtml: backup.fields.aboutHtml,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: RESTORE_AUDIT_ACTION,
        targetType: "DoctorProfile",
        targetId: doctor.id,
        metadata: {
          tool: CV_IMPORT_TOOL,
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          backupFile: path.basename(backupFile),
          preRestoreBackup: path.basename(preRestoreBackup),
        },
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.doctors]);
  return { preRestoreBackup };
}
