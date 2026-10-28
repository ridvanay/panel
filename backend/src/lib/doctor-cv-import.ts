/**
 * Paket L (2026-10-23) — Vahit Mutlu CV'sinin (pandoc düz metni) doktor profiline aktarımı.
 * Saf ayrıştırma (`parseCvText`) + planlama/yazma/geri dönüş (`applyDoctorCvImport`,
 * `restoreDoctorProfile`). Script: `scripts/update-vahit-mutlu-profile.ts`. Rapor:
 * `docs/prompts/2026-10-23-L-RAPOR.md`.
 *
 * Güvenlik deseni `legal-pages-publisher.ts` ile aynı: varsayılan kuru çalışma, `--confirm` +
 * `--operator`, yazmadan önce JSON yedek, tek transaction, audit kaydı, `--restore`.
 *
 * Gizlilik: CV'deki kişisel telefon/e-posta ve doğum yılı/yeri cümlesi profile GİRMEZ;
 * `findPrivateInfo` yazılacak tüm metni tarar, bulursa yazma reddedilir.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeRichHtml } from "./html-sanitize";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";
import {
  DoctorCvEntrySchema,
  DoctorPublicationSchema,
  DoctorSocialLinkSchema,
  type DoctorCvEntryDto,
  type DoctorPublicationDto,
} from "../schemas/entities";

export const IMPORT_CONFIRM_KEY = "update-vahit";
export const RESTORE_CONFIRM_KEY = "restore-vahit";
export const IMPORT_AUDIT_ACTION = "doctor.profile.imported";
export const RESTORE_AUDIT_ACTION = "doctor.profile.restored";
export const MAX_CV_ENTRIES = 60;
export const MAX_PUBLICATIONS = 200;

export class DoctorImportError extends Error {}

/* ------------------------------------------------------------------ */
/* Ayrıştırma                                                          */
/* ------------------------------------------------------------------ */

const SECTION_HEADINGS = [
  "PROFESSIONAL PROFILE",
  "CORE CLINICAL & ACADEMIC FOCUS",
  "EDUCATION & SPECIALTY TRAINING",
  "PROFESSIONAL EXPERIENCE",
  "PROFESSIONAL MEMBERSHIPS & SCIENTIFIC ROLES",
  "LANGUAGES",
  "SELECTED INTERNATIONAL PEER-REVIEWED PUBLICATIONS",
  "NATIONAL PEER-REVIEWED PUBLICATIONS",
  "BOOK EDITORSHIP & BOOK CHAPTERS",
  "ORAL & POSTER PRESENTATIONS",
  "PROFESSIONAL BIOGRAPHY",
] as const;
type SectionHeading = (typeof SECTION_HEADINGS)[number];

/** CV'de bölüm sonuna sızmış başlık kalıntıları (docx'teki gizli başlık). */
const STRAY_LINES = new Set(["Mesleki Özgeçmiş"]);

export function splitSections(text: string): Map<SectionHeading, string[]> {
  const sections = new Map<SectionHeading, string[]>();
  let current: SectionHeading | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = SECTION_HEADINGS.find((h) => line.trim() === h);
    if (heading) {
      current = heading;
      sections.set(heading, []);
      continue;
    }
    if (current && !STRAY_LINES.has(line.trim())) sections.get(current)!.push(line);
  }
  return sections;
}

/** Boş satırla ayrılmış blokları döndürür (satırlar kırpılmış, boşlar atılmış). */
function blocks(lines: string[]): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) result.push(current);
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) result.push(current);
  return result;
}

const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s,;]+)/i;
const URL_PATTERN = /https:\/\/[^\s]+/gi;

function trimTrailing(value: string): string {
  return value.replace(/[\s.,;|:]+$/u, "").replace(/^[\s.,;|:]+/u, "");
}

export function extractDoi(text: string): string | null {
  const match = text.match(DOI_PATTERN);
  return match ? trimTrailing(match[1]!) : null;
}

/** DOI ve URL'ler çıkarıldıktan sonra kalan metindeki ilk 1950–(bu yıl+1) yılı. */
export function extractYear(text: string, now = new Date()): number | null {
  const cleaned = text.replace(URL_PATTERN, " ").replace(/\b10\.\d{4,9}\/[^\s,;]+/gi, " ");
  const max = now.getUTCFullYear() + 1;
  for (const match of cleaned.matchAll(/(?<![\d.])(19[5-9]\d|20\d\d)(?![\d])/g)) {
    const year = Number(match[1]);
    if (year >= 1950 && year <= max) return year;
  }
  return null;
}

/** Yazar satırı: dipnot rakamları ("Burak Barutcu 2" → "Burak Barutcu"), BÜYÜK soyad, boşluk/virgül düzeltmesi. */
export function cleanAuthors(line: string): string {
  return line
    .replace(/(\p{L}[\p{L}.'-]*)\s+\d{1,2}(?=\s*(,|$))/gu, "$1")
    .replace(/\bMUTLU\b/g, "Mutlu")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",")
    .replace(/,(?=\S)/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,]+$/u, "")
    .trim();
}

function cleanVenue(text: string): string {
  return trimTrailing(
    text
      .replace(URL_PATTERN, " ")
      .replace(/\bdoi\s*:\s*/gi, " ")
      .replace(/\b10\.\d{4,9}\/[^\s,;]+/gi, " ")
      .replace(/\bPMC?ID:\s*\S+/gi, " ")
      .replace(/^v\s+/, "")
      .replace(/\s+([.,;])/g, "$1")
      .replace(/\s{2,}/g, " ")
  );
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Başlık satırı bir bağlaçla bitiyorsa sonraki satır başlığın devamıdır. */
const CONTINUATION_END = /\b(in|of|and|the|for|with|on|to|a|an|after|before)$/i;

export interface SkippedItem {
  section: string;
  title: string;
  reason: string;
}

export interface ParsedPublication {
  publication: DoctorPublicationDto;
  sourceVenue: string;
}

type PublicationKind = DoctorPublicationDto["kind"];

function buildPublication(kind: PublicationKind, authorsLine: string, title: string, venueRaw: string, venueOverride?: string) {
  const doi = extractDoi(venueRaw);
  const url = (venueRaw.match(URL_PATTERN) ?? []).map(trimTrailing).find((u) => !/^https:\/\/doi\.org\//i.test(u)) ?? null;
  const year = extractYear(venueRaw);
  const venue = clamp(venueOverride ?? cleanVenue(venueRaw), 200);
  return {
    year,
    publication: {
      kind,
      title: clamp(trimTrailing(title), 300),
      venue,
      authors: clamp(cleanAuthors(authorsLine), 300),
      year: year ?? 0,
      doi: doi ? clamp(doi, 120) : null,
      url,
    } satisfies DoctorPublicationDto,
  };
}

export function parseArticleBlock(kind: PublicationKind, lines: string[]) {
  const [authors = "", ...rest] = lines;
  let titleEnd = 0;
  while (titleEnd < rest.length - 2 && CONTINUATION_END.test(rest[titleEnd]!)) titleEnd++;
  const title = rest.slice(0, titleEnd + 1).join(" ");
  const venueRaw = rest.slice(titleEnd + 1).join(" ");
  return buildPublication(kind, authors, title, venueRaw);
}

/** Kitap bölümü/editörlük: iki düzen var — "Publisher •" satırlı ve "Yayınevi:" satırlı. */
export function parseBookBlock(lines: string[]) {
  const [authors = "", ...rest] = lines;
  const publisherIndex = rest.findIndex((l) => /^Publisher\s*•/i.test(l));
  if (publisherIndex >= 0) {
    const book = rest[0] ?? "";
    const second = rest[1] ?? "";
    const isEditor = /^ED[İI]T[ÖO]R$/i.test(second);
    const publisher = rest[publisherIndex]!.replace(/^Publisher\s*•\s*/i, "");
    const firstPublished = rest.find((l) => /^First Published\s*•/i.test(l)) ?? "";
    const city = firstPublished.split(",").slice(1).join(",").trim();
    const venueParts = isEditor ? ["Editor", book, publisher] : [book, publisher];
    if (city) venueParts.push(city);
    return buildPublication("BOOK_CHAPTER", authors, isEditor ? book : second, firstPublished, venueParts.join(" · "));
  }
  // "Yayınevi:" düzeni: [başlık, (kitap), yayınevi satırı]. Başlık ve kitap tek satırda
  // "Bölüm. Kitap" biçiminde de gelebilir.
  let title = rest[0] ?? "";
  let venueLines = rest.slice(1);
  if (venueLines.length === 1 && /^Yayınevi/i.test(venueLines[0]!) && /\.\s/.test(title)) {
    const dot = title.indexOf(". ");
    venueLines = [title.slice(dot + 2), ...venueLines];
    title = title.slice(0, dot);
  }
  const venueRaw = venueLines.join(" ");
  const venue = cleanVenue(venueLines.map(trimTrailing).join(" · ").replace(/Yayınevi:\s*/gi, ""));
  return buildPublication("BOOK_CHAPTER", authors, title, venueRaw, venue);
}

function parseTableRows(lines: string[]): { years: string; lines: string[] }[] {
  const rows: { years: string; lines: string[] }[] = [];
  let current: { years: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (/^\+[-=+]+\+$/.test(line.trim())) {
      if (current) rows.push(current);
      current = null;
      continue;
    }
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    current ??= { years: "", lines: [] };
    if (cells[0]) current.years = cells[0];
    if (cells[1]) current.lines.push(cells[1]);
  }
  if (current) rows.push(current);
  return rows;
}

function parseYearRange(value: string): { startYear: number; endYear: number | null } | null {
  const match = value.match(/(\d{4})\s*[–-]\s*(\d{4}|Present)/i);
  if (!match) return null;
  return { startYear: Number(match[1]), endYear: /present/i.test(match[2]!) ? null : Number(match[2]) };
}

/** Üyelik satırı: "SSAT – Türkiye Council Member" → kurum SSAT, rol "Türkiye Council Member"; aksi halde rol "Member". */
export function parseMembership(line: string): DoctorCvEntryDto {
  const text = line.replace(/^•\s*/, "").trim();
  const [left, right] = text.split(/\s+–\s+/, 2);
  const roleLike = right && /member$/i.test(right);
  return {
    kind: "MEMBERSHIP",
    title: roleLike ? right! : "Member",
    organization: clamp(roleLike ? left! : text, 160),
    startYear: null,
    endYear: null,
  };
}

/** Sertifika — PDF'ten okunan bilgi (Wiley Reviewer Certificate, Ekim 2026 tarihli, 2025 hakemliği). */
export const WILEY_CERTIFICATE: DoctorCvEntryDto = {
  kind: "CERTIFICATE",
  title: "Wiley Reviewer Certificate — Journal of Obesity",
  organization: "Wiley",
  startYear: 2025,
  endYear: 2025,
  description: "Reviewer for Journal of Obesity — 1 manuscript reviewed in 2025.",
};

function sentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?]+(?:[.!?](?!\d)|$)+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/** Doğum yılı/yeri cümlesi profile girmez. */
function isBirthSentence(sentence: string): boolean {
  return /\bborn\b/i.test(sentence);
}

export interface ParsedCv {
  cvEntries: DoctorCvEntryDto[];
  publications: DoctorPublicationDto[];
  skipped: SkippedItem[];
  bio: string;
  aboutHtml: string;
}

export function parseCvText(text: string): ParsedCv {
  const sections = splitSections(text);
  const section = (name: SectionHeading) => sections.get(name) ?? [];
  const skipped: SkippedItem[] = [];

  const cvEntries: DoctorCvEntryDto[] = [];
  for (const row of parseTableRows(section("EDUCATION & SPECIALTY TRAINING"))) {
    const range = parseYearRange(row.years);
    const [title = "", organization = ""] = row.lines;
    if (/secondary education|high school/i.test(`${title} ${organization}`)) {
      skipped.push({ section: "EDUCATION", title, reason: "Lise kaydı bilerek eklenmedi (görev dosyası)." });
      continue;
    }
    if (!range) {
      skipped.push({ section: "EDUCATION", title, reason: "Yıl aralığı bulunamadı." });
      continue;
    }
    cvEntries.push({ kind: "EDUCATION", title: clamp(title, 160), organization: clamp(organization, 160), ...range });
  }
  for (const row of parseTableRows(section("PROFESSIONAL EXPERIENCE"))) {
    const range = parseYearRange(row.years);
    const [title = "", organization = ""] = row.lines;
    if (!range) {
      skipped.push({ section: "EXPERIENCE", title, reason: "Yıl aralığı bulunamadı." });
      continue;
    }
    cvEntries.push({ kind: "EXPERIENCE", title: clamp(title, 160), organization: clamp(organization, 160), ...range });
  }
  for (const line of section("PROFESSIONAL MEMBERSHIPS & SCIENTIFIC ROLES")) {
    if (line.trim().startsWith("•")) cvEntries.push(parseMembership(line));
  }
  cvEntries.push({ ...WILEY_CERTIFICATE });

  const publications: DoctorPublicationDto[] = [];
  const addPublication = (sectionName: string, parsed: ReturnType<typeof buildPublication>) => {
    if (parsed.year == null) {
      skipped.push({ section: sectionName, title: parsed.publication.title, reason: "Yıl bulunamadı (DOI içindeki sayılar yıl sayılmaz)." });
      return;
    }
    publications.push(parsed.publication);
  };
  for (const block of blocks(section("SELECTED INTERNATIONAL PEER-REVIEWED PUBLICATIONS"))) {
    addPublication("INTERNATIONAL_ARTICLE", parseArticleBlock("INTERNATIONAL_ARTICLE", block));
  }
  for (const block of blocks(section("NATIONAL PEER-REVIEWED PUBLICATIONS"))) {
    addPublication("NATIONAL_ARTICLE", parseArticleBlock("NATIONAL_ARTICLE", block));
  }
  for (const block of blocks(section("BOOK EDITORSHIP & BOOK CHAPTERS"))) {
    addPublication("BOOK_CHAPTER", parseBookBlock(block));
  }
  for (const block of blocks(section("ORAL & POSTER PRESENTATIONS"))) {
    addPublication("PROCEEDING", parseArticleBlock("PROCEEDING", block));
  }

  const profile = section("PROFESSIONAL PROFILE").join(" ").replace(/\s+/g, " ").trim();
  const bio = sentences(profile).slice(0, 2).join(" ");

  const biography = section("PROFESSIONAL BIOGRAPHY")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((paragraph) => sentences(paragraph).filter((s) => !isBirthSentence(s)).join(" "))
    .filter(Boolean);
  // Doğum cümlesi çıkınca biyografi "He studied…" diye başlar; özne ilk cümlede isimle verilir.
  if (biography[0]) biography[0] = biography[0].replace(/^He\b/, "Dr. Vahit Mutlu");
  const aboutHtml = sanitizeRichHtml(biography.map((p) => `<p>${escapeHtml(p)}</p>`).join(""));

  return { cvEntries, publications, skipped, bio, aboutHtml };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Yayımlanmaması gereken kişisel bilgi kalıpları (telefon, e-posta, doğum yılı/yeri). */
const PRIVATE_PATTERNS: { label: string; pattern: RegExp }[] = [
  // Uluslararası (+ önekli) ve 0 ile başlayan yerel numaralar (cep/sabit). Yayın künyelerindeki
  // sayfa/cilt/DOI/ISBN dizileri bu kalıplara uymaz (+ ya da baştaki tek 0 + 10 hane yok).
  { label: "telefon", pattern: /\+\d{1,3}(?:[\s().-]*\d){6,12}|(?<![\w/.-])0\s?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/ },
  { label: "e-posta", pattern: /[\w.+-]+@[\w-]+\.[\w.]+|mailto:/i },
  { label: "doğum bilgisi", pattern: /\bborn\b|\bdate of birth\b|\bDOB\b|\bdoğum (tarihi|yeri|yılı)\b|\bdoğdu\b/i },
];

export function findPrivateInfo(values: unknown): string[] {
  const text = JSON.stringify(values);
  return PRIVATE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

/* ------------------------------------------------------------------ */
/* Plan / yazma / geri dönüş                                           */
/* ------------------------------------------------------------------ */

export const DOCTOR_SLUG = "vahit-mutlu";
const DOCTOR_NAME_NEEDLE = "Vahit Mutlu";
export const TARGET_TITLE = "Assoc. Prof. Dr.";
/**
 * Uzmanlıklar önce slug ile, bulunamazsa adla (büyük/küçük harf ve "&"/"and" farkı yok sayılarak)
 * aranır. Canlıda ad "Obesity and Metabolic Surgery" (2026-10-23 deneme çalışması). Bulunamazsa
 * uzmanlık adımı uyarıyla ATLANIR, CV aktarımı sürer; script uzmanlık OLUŞTURMAZ.
 */
export const PRIMARY_SPECIALTY = { slug: "obesity-and-metabolic-surgery", name: "Obesity & Metabolic Surgery" } as const;
export const SECONDARY_SPECIALTY = { slug: "surgical-oncology", name: "Surgical Oncology" } as const;

export function normalizeSpecialtyName(value: string): string {
  return value.toLocaleLowerCase("en").replace(/&/g, " and ").replace(/\s+/g, " ").trim();
}

async function findSpecialty(db: Db, target: { slug: string; name: string }): Promise<{ id: string; name: string } | null> {
  const bySlug = await db.specialty.findUnique({ where: { slug: target.slug }, select: { id: true, name: true } });
  if (bySlug) return bySlug;
  const wanted = normalizeSpecialtyName(target.name);
  const all = await db.specialty.findMany({ select: { id: true, name: true } });
  return all.find((s) => normalizeSpecialtyName(s.name) === wanted) ?? null;
}
export const CV_FILE = "vahitcv.txt";
export const CERTIFICATE_FILE = "wiley-reviewer-certificate-2025.pdf";
const CERTIFICATE_ALT_TEXT = "Wiley Reviewer Certificate — Journal of Obesity";

// WhatsApp YOK (bilerek) — sitenin kendi WhatsApp hattıyla karışmasın (2026-10-02 görev dosyası).
export const TARGET_SOCIAL_LINKS = [
  { platform: "instagram", url: "https://www.instagram.com/doc.dr.vahitmutlu/", label: "Instagram (TR)" },
  { platform: "instagram", url: "https://www.instagram.com/docdrvahitmutlu/", label: "Instagram (EN)" },
  { platform: "facebook", url: "https://www.facebook.com/profile.php?id=100090827795012" },
  { platform: "youtube", url: "https://www.youtube.com/@doc.dr.vahitmutlu" },
];

export type Db = Pick<PrismaClient, "doctorProfile" | "doctorAdditionalSpecialty" | "specialty" | "media" | "auditLog" | "$transaction">;

export interface OperatorInfo {
  operator: string;
  osUser: string;
  hostname: string;
}

export interface CertificateFile {
  filename: string;
  buffer: Buffer;
}

export interface ImportPlan {
  doctor: { id: string; slug: string; fullName: string; updatedAt: Date };
  parsed: ParsedCv;
  current: { cvEntries: number; publications: number; bioLength: number; aboutLength: number; title: string };
  certificate: CertificateFile;
  existingMediaId: string | null;
  primarySpecialtyId: string | null;
  primarySpecialtyName: string | null;
  additionalSpecialtyIds: string[];
  willConnectPrimary: boolean;
  /** Bulunamayan uzmanlıklar — adım atlanır, aktarım sürer. */
  specialtyWarnings: string[];
}

export async function loadSources(dir: string): Promise<{ text: string; certificate: CertificateFile }> {
  const text = await fs.readFile(path.join(dir, CV_FILE), "utf8");
  const buffer = await fs.readFile(path.join(dir, CERTIFICATE_FILE));
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new DoctorImportError(`${CERTIFICATE_FILE} bir PDF değil.`);
  return { text, certificate: { filename: CERTIFICATE_FILE, buffer } };
}

/** Ayrıştırılan veriyi API ile aynı Zod şemalarından geçirir; gizli bilgi taraması yapar. */
export function validateParsed(parsed: ParsedCv): void {
  if (parsed.cvEntries.length > MAX_CV_ENTRIES) throw new DoctorImportError(`CV kalemi ${parsed.cvEntries.length} > ${MAX_CV_ENTRIES}.`);
  if (parsed.publications.length > MAX_PUBLICATIONS) throw new DoctorImportError(`Yayın ${parsed.publications.length} > ${MAX_PUBLICATIONS}.`);
  parsed.cvEntries.forEach((entry, i) => {
    const result = DoctorCvEntrySchema.safeParse(entry);
    if (!result.success) throw new DoctorImportError(`cvEntries[${i}] geçersiz: ${result.error.issues.map((x) => x.message).join("; ")}`);
  });
  parsed.publications.forEach((pub, i) => {
    const result = DoctorPublicationSchema.safeParse(pub);
    if (!result.success) throw new DoctorImportError(`publications[${i}] "${pub.title}" geçersiz: ${result.error.issues.map((x) => x.message).join("; ")}`);
  });
  if (!parsed.bio || parsed.bio.length > 5000) throw new DoctorImportError("bio boş ya da 5000 karakterden uzun.");
  const leaks = findPrivateInfo({ cv: parsed.cvEntries, pubs: parsed.publications, bio: parsed.bio, about: parsed.aboutHtml });
  if (leaks.length) throw new DoctorImportError(`Yayımlanmaması gereken bilgi bulundu: ${leaks.join(", ")}.`);
}

export async function buildImportPlan(db: Db, dir: string): Promise<ImportPlan> {
  const { text, certificate } = await loadSources(dir);
  const parsed = parseCvText(text);
  validateParsed(parsed);

  const doctor = await db.doctorProfile.findFirst({
    where: { OR: [{ slug: DOCTOR_SLUG }, { fullName: { contains: DOCTOR_NAME_NEEDLE, mode: "insensitive" } }] },
  });
  if (!doctor) {
    throw new DoctorImportError(
      `Doktor profili bulunamadı (slug="${DOCTOR_SLUG}" ya da adında "${DOCTOR_NAME_NEEDLE}"). Bu script doktor OLUŞTURMAZ.`
    );
  }
  const specialtyWarnings: string[] = [];
  const primary = await findSpecialty(db, PRIMARY_SPECIALTY);
  const secondary = await findSpecialty(db, SECONDARY_SPECIALTY);
  for (const [target, found] of [[PRIMARY_SPECIALTY, primary], [SECONDARY_SPECIALTY, secondary]] as const) {
    if (!found) {
      specialtyWarnings.push(
        `Uzmanlık bulunamadı (slug="${target.slug}", ad≈"${target.name}"); bu uzmanlık adımı atlandı, script uzmanlık OLUŞTURMAZ.`
      );
    }
  }
  const finalPrimary = doctor.specialtyId ?? primary?.id ?? null;

  // Yeniden kullanım: bu aracın yüklediği kayıt (dosya adı + boyut + tür + sabit alt metin).
  const existingMedia = await db.media.findFirst({
    where: { filename: certificate.filename, sizeBytes: certificate.buffer.byteLength, mimeType: "application/pdf", altText: CERTIFICATE_ALT_TEXT },
    select: { id: true },
  });

  return {
    doctor: { id: doctor.id, slug: doctor.slug, fullName: doctor.fullName, updatedAt: doctor.updatedAt },
    parsed,
    current: {
      cvEntries: Array.isArray(doctor.cvEntries) ? doctor.cvEntries.length : 0,
      publications: Array.isArray(doctor.publications) ? doctor.publications.length : 0,
      bioLength: doctor.bio.length,
      aboutLength: (doctor.aboutHtml ?? "").length,
      title: doctor.title,
    },
    certificate,
    existingMediaId: existingMedia?.id ?? null,
    primarySpecialtyId: primary?.id ?? null,
    primarySpecialtyName: primary?.name ?? null,
    additionalSpecialtyIds: [primary?.id, secondary?.id].filter((id): id is string => Boolean(id) && id !== finalPrimary),
    // `specialtyId` doluysa EZİLMEZ; boşsa yalnızca birincil uzmanlık bulunduysa bağlanır.
    willConnectPrimary: doctor.specialtyId === null && primary !== null,
    specialtyWarnings,
  };
}

export function formatImportPlan(plan: ImportPlan): string {
  const { parsed, current } = plan;
  const count = (kind: string, list: { kind: string }[]) => list.filter((x) => x.kind === kind).length;
  const lines = [
    `Doktor: ${plan.doctor.fullName} (${plan.doctor.slug}, id=${plan.doctor.id})`,
    `  title: ${JSON.stringify(current.title)} → ${JSON.stringify(TARGET_TITLE)}`,
    `  cvEntries: ${current.cvEntries} → ${parsed.cvEntries.length} (EDUCATION ${count("EDUCATION", parsed.cvEntries)}, EXPERIENCE ${count("EXPERIENCE", parsed.cvEntries)}, MEMBERSHIP ${count("MEMBERSHIP", parsed.cvEntries)}, CERTIFICATE ${count("CERTIFICATE", parsed.cvEntries)})`,
    `  publications: ${current.publications} → ${parsed.publications.length} (INTERNATIONAL ${count("INTERNATIONAL_ARTICLE", parsed.publications)}, NATIONAL ${count("NATIONAL_ARTICLE", parsed.publications)}, BOOK_CHAPTER ${count("BOOK_CHAPTER", parsed.publications)}, PROCEEDING ${count("PROCEEDING", parsed.publications)})`,
    `  bio uzunluğu: ${current.bioLength} → ${parsed.bio.length}`,
    `  aboutHtml uzunluğu: ${current.aboutLength} → ${parsed.aboutHtml.length}`,
    `  socialLinks: ${TARGET_SOCIAL_LINKS.length} bağlantı (WhatsApp yok)`,
    `  birincil uzmanlık: ${plan.willConnectPrimary ? `boş → ${plan.primarySpecialtyName} bağlanacak` : "değişmeyecek"}; ek uzmanlık (upsert, silme yok): ${plan.additionalSpecialtyIds.length}`,
    ...plan.specialtyWarnings.map((w) => `  UYARI: ${w}`),
    "  gizli bilgi taraması (telefon, e-posta, doğum bilgisi): temiz",
    `  sertifika: ${plan.certificate.filename} (${plan.certificate.buffer.byteLength} bayt) — ${plan.existingMediaId ? `mevcut medya kullanılacak (${plan.existingMediaId})` : "medya olarak YÜKLENECEK (public)"}`,
  ];
  if (parsed.skipped.length) {
    lines.push(`Eklenmeyen kalemler (${parsed.skipped.length}):`);
    for (const s of parsed.skipped) lines.push(`  - [${s.section}] ${s.title} — ${s.reason}`);
  }
  return lines.join("\n");
}

export interface DoctorBackup {
  kind: "doctor-profile-backup";
  createdAt: string;
  doctorId: string;
  slug: string;
  fields: {
    title: string;
    bio: string;
    aboutHtml: string | null;
    cvEntries: unknown;
    publications: unknown;
    socialLinks: unknown;
    specialtyId: string | null;
  };
  additionalSpecialtyIds: string[];
}

export function assertOperator(info: OperatorInfo) {
  const op = info.operator?.trim() ?? "";
  // eslint-disable-next-line no-control-regex
  if (op.length < 3 || op.length > 100 || /[\u0000-\u001f\u007f]/.test(op)) {
    throw new DoctorImportError("--operator zorunlu (3–100 karakter, kontrol karakteri yok; kim çalıştırıyor?).");
  }
}

/** Paket U — genel `import-doctor-cv` de kullanır; dosya adı doktorun kendi slug'ı (Vahit için değişmedi). */
export async function writeBackup(db: Db, backupDir: string, doctorId: string, now: Date): Promise<string> {
  const doctor = await db.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
  const additional = await db.doctorAdditionalSpecialty.findMany({ where: { doctorId }, select: { specialtyId: true } });
  const backup: DoctorBackup = {
    kind: "doctor-profile-backup",
    createdAt: now.toISOString(),
    doctorId,
    slug: doctor.slug,
    fields: {
      title: doctor.title,
      bio: doctor.bio,
      aboutHtml: doctor.aboutHtml,
      cvEntries: doctor.cvEntries,
      publications: doctor.publications,
      socialLinks: doctor.socialLinks,
      specialtyId: doctor.specialtyId,
    },
    additionalSpecialtyIds: additional.map((a) => a.specialtyId),
  };
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const file = path.join(backupDir, `${doctor.slug}-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(backup, null, 2), { encoding: "utf8", mode: 0o600 });
  return file;
}

export function appLike(db: Db): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

export interface MediaSaver {
  save(input: { buffer: Buffer; filename: string; mimeType: string }): Promise<{ path: string; url: string }>;
}

export async function applyDoctorCvImport(
  db: Db,
  plan: ImportPlan,
  options: OperatorInfo & { confirm?: string; backupDir: string; storage: MediaSaver; now?: Date; revalidate?: boolean }
): Promise<{ backupFile: string; mediaId: string }> {
  if (options.confirm !== IMPORT_CONFIRM_KEY) throw new DoctorImportError(`Gerçek yazma için --confirm=${IMPORT_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const now = options.now ?? new Date();
  const backupFile = await writeBackup(db, options.backupDir, plan.doctor.id, now);

  // Dosya depolama transaction'a girmez: yazma başarısız olursa yüklenen PDF sahipsiz kalır
  // (zararsız, medya kütüphanesinden silinebilir). Tekrar çalıştırmada aynı dosya yeniden kullanılır.
  const stored = plan.existingMediaId
    ? null
    : await options.storage.save({ buffer: plan.certificate.buffer, filename: plan.certificate.filename, mimeType: "application/pdf" });

  const mediaId = await db.$transaction(async (tx) => {
    const current = await tx.doctorProfile.findUnique({ where: { id: plan.doctor.id } });
    if (!current || current.updatedAt.getTime() !== plan.doctor.updatedAt.getTime()) {
      throw new DoctorImportError("Doktor kaydı plan alındıktan sonra değişmiş; işlem geri alındı. Kuru çalışmayı yeniden yapın.");
    }
    const media = plan.existingMediaId
      ? await tx.media.findUniqueOrThrow({ where: { id: plan.existingMediaId } })
      : await tx.media.create({
          data: {
            path: stored!.path,
            url: stored!.url,
            filename: plan.certificate.filename,
            mimeType: "application/pdf",
            sizeBytes: plan.certificate.buffer.byteLength,
            altText: CERTIFICATE_ALT_TEXT,
          },
        });
    const cvEntries = plan.parsed.cvEntries.map((entry) => (entry.kind === "CERTIFICATE" ? { ...entry, mediaId: media.id, url: media.url } : entry));
    DoctorCvEntrySchema.array().parse(cvEntries);
    DoctorSocialLinkSchema.array().parse(TARGET_SOCIAL_LINKS);

    await tx.doctorProfile.update({
      where: { id: plan.doctor.id },
      data: {
        title: TARGET_TITLE,
        bio: plan.parsed.bio,
        aboutHtml: plan.parsed.aboutHtml || null,
        cvEntries: cvEntries as Prisma.InputJsonValue,
        publications: plan.parsed.publications as Prisma.InputJsonValue,
        socialLinks: TARGET_SOCIAL_LINKS as Prisma.InputJsonValue,
        ...(plan.willConnectPrimary && plan.primarySpecialtyId ? { specialty: { connect: { id: plan.primarySpecialtyId } } } : {}),
      },
    });
    for (const specialtyId of plan.additionalSpecialtyIds) {
      await tx.doctorAdditionalSpecialty.upsert({
        where: { doctorId_specialtyId: { doctorId: plan.doctor.id, specialtyId } },
        create: { doctorId: plan.doctor.id, specialtyId },
        update: {},
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: IMPORT_AUDIT_ACTION,
        targetType: "DoctorProfile",
        targetId: plan.doctor.id,
        metadata: {
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          backupFile: path.basename(backupFile),
          cvEntries: cvEntries.length,
          publications: plan.parsed.publications.length,
          certificateMediaId: media.id,
        },
      },
    });
    return media.id;
  });

  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.doctors]);
  return { backupFile, mediaId };
}

/** Yedek operatör girdisidir: yalnızca bu araçla yönetilen doktora ve geçerli şemaya izin verilir. */
export async function readDoctorBackup(file: string, expectedSlug: string = DOCTOR_SLUG): Promise<DoctorBackup> {
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as DoctorBackup;
  if (parsed?.kind !== "doctor-profile-backup" || typeof parsed.doctorId !== "string" || !parsed.fields) {
    throw new DoctorImportError("Geçerli bir doktor profili yedeği değil.");
  }
  if (parsed.slug !== expectedSlug) throw new DoctorImportError(`Yedek bu araçla yönetilmeyen bir doktora ait: "${parsed.slug}".`);
  const { fields } = parsed;
  if (typeof fields.title !== "string" || typeof fields.bio !== "string") throw new DoctorImportError("Yedekte title/bio eksik.");
  if (!DoctorCvEntrySchema.array().max(MAX_CV_ENTRIES).safeParse(fields.cvEntries).success) throw new DoctorImportError("Yedekteki cvEntries geçersiz.");
  if (!DoctorPublicationSchema.array().max(MAX_PUBLICATIONS).safeParse(fields.publications).success) {
    throw new DoctorImportError("Yedekteki publications geçersiz.");
  }
  if (!DoctorSocialLinkSchema.array().safeParse(fields.socialLinks).success) throw new DoctorImportError("Yedekteki socialLinks geçersiz.");
  return {
    ...parsed,
    fields: { ...fields, aboutHtml: fields.aboutHtml ? sanitizeRichHtml(fields.aboutHtml) : null },
    additionalSpecialtyIds: Array.isArray(parsed.additionalSpecialtyIds) ? parsed.additionalSpecialtyIds.filter((x) => typeof x === "string") : [],
  };
}

export async function restoreDoctorProfile(
  db: Db,
  backupFile: string,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ preRestoreBackup: string }> {
  if (options.confirm !== RESTORE_CONFIRM_KEY) throw new DoctorImportError(`Geri dönüş için --confirm=${RESTORE_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const backup = await readDoctorBackup(backupFile);
  const doctor = await db.doctorProfile.findUnique({ where: { id: backup.doctorId }, select: { id: true, slug: true } });
  if (!doctor || doctor.slug !== backup.slug) throw new DoctorImportError("Yedekteki doktor bulunamadı ya da slug değişmiş.");
  const preRestoreBackup = await writeBackup(db, options.backupDir, doctor.id, options.now ?? new Date());

  await db.$transaction(async (tx) => {
    const { fields } = backup;
    await tx.doctorProfile.update({
      where: { id: doctor.id },
      data: {
        title: fields.title,
        bio: fields.bio,
        aboutHtml: fields.aboutHtml,
        cvEntries: fields.cvEntries as Prisma.InputJsonValue,
        publications: fields.publications as Prisma.InputJsonValue,
        socialLinks: fields.socialLinks as Prisma.InputJsonValue,
        specialty: fields.specialtyId ? { connect: { id: fields.specialtyId } } : { disconnect: true },
      },
    });
    await tx.doctorAdditionalSpecialty.deleteMany({ where: { doctorId: doctor.id, specialtyId: { notIn: backup.additionalSpecialtyIds } } });
    for (const specialtyId of backup.additionalSpecialtyIds) {
      await tx.doctorAdditionalSpecialty.upsert({
        where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId } },
        create: { doctorId: doctor.id, specialtyId },
        update: {},
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: RESTORE_AUDIT_ACTION,
        targetType: "DoctorProfile",
        targetId: doctor.id,
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

  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.doctors]);
  return { preRestoreBackup };
}
