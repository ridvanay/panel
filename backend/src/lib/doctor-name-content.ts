/**
 * Paket U sonrası (2026-10-28) — kurucu dışındaki doktorların `bio` / `aboutHtml` / `subSpecialty`
 * metinlerinde (kanonik EN + `translations.<tüm diller>`) geçen TAM adı, Bölüm C'deki görünen adla
 * (`publicName` ya da otomatik kısaltma) değiştirir. Script: `scripts/shorten-doctor-names-in-content.ts`.
 *
 * Kurallar:
 *  - Yalnızca TAM ad (tüm kelimeler, sırayla) eşleşir; büyük/küçük harf ve Türkçe karakter duyarsız
 *    ("Hakan Sofu" = "HAKAN SOFU" = "Hakan SOFU"; "Dogukan Yildirim" = "Doğukan Yıldırım").
 *    Tek başına ad ya da soyad ("Dr. Sofu") DEĞİŞMEZ. Unvan önekleri metinde kalır.
 *  - Ekler korunur: "Hakan Sofu'nun" → "H. Sofu'nun", "Hakan Sofu’s" → "H. Sofu’s".
 *  - HTML'de yalnızca metin düğümleri değişir; etiket ve öznitelik içlerine dokunulmaz.
 *  - Başka alfabeyle yazılmış adlar (Rusça Kiril, Arapça) otomatik DEĞİŞTİRİLMEZ, aday olarak listelenir.
 *
 * Güvenlik deseni diğer içerik scriptleriyle aynı: varsayılan kuru çalışma, `--confirm` + `--operator`,
 * yazmadan önce JSON yedek, tek transaction (plan sonrası değişmiş kayıt varsa geri alınır), audit,
 * `--restore`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { doctorDisplayName } from "./doctor-display-name";
import { CACHE_TAGS, triggerTagRevalidation } from "./revalidate";
import type { FastifyInstance } from "fastify";

export const SHORTEN_CONFIRM_KEY = "shorten-names";
export const SHORTEN_RESTORE_CONFIRM_KEY = "restore-names";
export const SHORTEN_AUDIT_ACTION = "doctor.content.names_shortened";
export const SHORTEN_RESTORE_AUDIT_ACTION = "doctor.content.names_restored";
export const CONTENT_FIELDS = ["bio", "aboutHtml", "subSpecialty"] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];

export class NameShortenError extends Error {}

/* ------------------------------------------------------------------ */
/* Eşleşme                                                             */
/* ------------------------------------------------------------------ */

/** Türkçe karakter + büyük/küçük harf duyarsız eşdeğer harf kümeleri. */
const FOLD_GROUPS = ["aâAÂ", "cçCÇ", "gğGĞ", "iıİIîÎ", "oöOÖ", "sşSŞ", "uüûUÜÛ"];

function charClass(ch: string): string {
  const group = FOLD_GROUPS.find((g) => g.includes(ch));
  const chars = new Set(group ? [...group] : [ch, ch.toLocaleLowerCase("tr"), ch.toLocaleUpperCase("tr"), ch.toLowerCase(), ch.toUpperCase()]);
  const escaped = [...chars].map((c) => c.replace(/[\\\]^-]/g, "\\$&"));
  return escaped.length === 1 ? escaped[0]! : `[${escaped.join("")}]`;
}

/** Tam ad için regex: kelimeler arası boşluk esnek; öncesinde/sonrasında harf yok (ekler kesme işaretiyle gelir). */
export function fullNamePattern(fullName: string): RegExp {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const body = words.map((w) => [...w].map((c) => (/[\p{L}]/u.test(c) ? charClass(c) : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("")).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{M}])${body}(?![\\p{L}\\p{M}])`, "gu");
}

/** Yalnızca metin düğümlerinde değiştirir; `<...>` etiketleri (öznitelikler dahil) olduğu gibi kalır. */
export function replaceNameInContent(content: string, fullName: string, displayName: string): { value: string; count: number } {
  const pattern = fullNamePattern(fullName);
  let count = 0;
  const value = content
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) return part;
      return part.replace(pattern, () => {
        count++;
        return displayName;
      });
    })
    .join("");
  return { value, count };
}

/* --- Başka alfabe adayları (yalnızca rapor) --- */

const CYRILLIC: Record<string, string> = {
  a: "а", b: "б", c: "дж", ç: "ч", d: "д", e: "е", f: "ф", g: "г", ğ: "", h: "х", ı: "ы", i: "и", j: "ж", k: "к", l: "л", m: "м",
  n: "н", o: "о", ö: "ё", p: "п", r: "р", s: "с", ş: "ш", t: "т", u: "у", ü: "ю", v: "в", y: "й", z: "з",
};
const CYRILLIC_ALT: Record<string, string> = { ı: "[ыи]", ö: "[ёоэ]", ü: "[юу]", ğ: "г?", e: "[еэ]", c: "(дж|ж)" };

/** Harf başına transliterasyon birimi — grup/küme bütün kalır; kısaltma birim bazında yapılır, desen ortadan kesilmez. */
/** "y" + ünlü tek Kiril harfine de yazılabilir (Kaya → Кая, Yusuf → Юсуф). */
const CYRILLIC_Y_DIGRAPH: Record<string, string> = { a: "(?:я|йа)", u: "(?:ю|йу)", ü: "(?:ю|йу)", o: "(?:ё|йо)", ö: "(?:ё|йо)", e: "(?:е|йе)" };

function cyrillicUnits(word: string): string[] {
  const letters = [...word.toLocaleLowerCase("tr")];
  const units: string[] = [];
  for (let i = 0; i < letters.length; i++) {
    const c = letters[i]!;
    const next = letters[i + 1];
    if (c === "y" && next && CYRILLIC_Y_DIGRAPH[next]) {
      units.push(CYRILLIC_Y_DIGRAPH[next]!);
      i++;
      continue;
    }
    const unit = CYRILLIC_ALT[c] ?? CYRILLIC[c] ?? "";
    if (unit) units.push(unit);
  }
  return units;
}

function cyrillicPattern(word: string, maxLetters?: number): string {
  const units = cyrillicUnits(word);
  return (maxLetters ? units.slice(0, maxLetters) : units).join("");
}

const ARABIC: Record<string, string> = {
  // Türkçe sondaki t çoğu zaman Arapça kökenli d'dir (Vahit → وحيد); ğ Arapça yazımda غ ya da hiç.
  b: "ب", c: "(?:ج|جه)", ç: "تش", d: "[دض]", f: "ف", g: "[غج]", ğ: "غ?", h: "[هح]", j: "ج", k: "[كق]", l: "ل", m: "م", n: "ن",
  p: "ب", r: "ر", s: "[سص]", ş: "ش", t: "[تطد]", v: "[فو]", y: "[يئ]", z: "[زظ]",
};
/** Ünlü konumu: 0–2 harf (ا أ إ آ ي ئ و ى ع ة ه + fetha) — "Ali" = علي, "Ayşe" = آيشه/عائشة, "Özdemir" = أوزدمير. */
const ARABIC_VOWEL = "[اأإآيئوىعةهَ]{0,2}";

/** Arapça iskelet: ünsüzler sırayla, ünlüler isteğe bağlı (ا/ي/و/ى). */
function arabicPattern(word: string): string {
  // Birimler arası isteğe bağlı boşluk: bileşik soyadlar Arapçada ayrı yazılabilir (Kolcuoğlu → كولجو أوغلو).
  return [...word.toLocaleLowerCase("tr")]
    .map((c) => ("aâeıiîoöuüû".includes(c) ? ARABIC_VOWEL : ARABIC[c] ?? ""))
    .filter(Boolean)
    .join("\\s?");
}

/** Rusça/Arapça metinde ad + soyadın başka alfabedeki yazımı (ör. "Хакан Софу") — otomatik değiştirilmez. */
export function findOtherScriptCandidates(content: string, fullName: string): string[] {
  const { patterns, surnamePatterns, errors } = buildOtherScriptPatterns(fullName);
  const text = content.replace(/<[^>]*>/g, " ");
  const out: string[] = errors.map((e) => `(${e})`);
  const covered: [number, number][] = [];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      out.push(m[0]);
      covered.push([m.index!, m.index! + m[0].length]);
    }
  }
  // Yalnızca soyad (başka alfabede) — tam ad eşleşmesinin parçası değilse ayrıca listelenir.
  for (const re of surnamePatterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      if (!covered.some(([a, b]) => start >= a && start < b)) out.push(m[0]);
    }
  }
  return out;
}

/**
 * Kiril ve Arapça aday desenleri. Kurulamayan desen script'i ÇÖKERTMEZ: hata mesajı döner ve aday
 * listesine "desen kurulamadı" notu olarak düşer. Kiril soyad toleranslı (ilk 4 harfin birimleri).
 */
export function buildOtherScriptPatterns(fullName: string): { patterns: RegExp[]; surnamePatterns: RegExp[]; errors: string[] } {
  const words = fullName.trim().split(/\s+/);
  if (words.length < 2) return { patterns: [], surnamePatterns: [], errors: [] };
  const first = words[0]!;
  const last = words[words.length - 1]!;
  const sources: [string, string, string, "full" | "surname"][] = [
    ["Kiril", `(?<![\\p{L}])${cyrillicPattern(first)}[\\p{L}]*\\s+(?:[\\p{L}.-]+\\s+){0,2}${cyrillicPattern(last, 4)}[\\p{L}]*`, "giu", "full"],
    ["Arapça", `(?<![\\p{L}])${arabicPattern(first)}\\s+(?:[\\p{L}]+\\s+){0,2}${arabicPattern(last)}(?![\\p{L}])`, "gu", "full"],
    ["Arapça soyad", `(?<![\\p{L}])${arabicPattern(last)}(?![\\p{L}])`, "gu", "surname"],
  ];
  const patterns: RegExp[] = [];
  const surnamePatterns: RegExp[] = [];
  const errors: string[] = [];
  for (const [label, source, flags, kind] of sources) {
    try {
      (kind === "full" ? patterns : surnamePatterns).push(new RegExp(source, flags));
    } catch (err) {
      errors.push(`${label} desen kurulamadı: ${(err as Error).message}`);
    }
  }
  return { patterns, surnamePatterns, errors };
}

/** Önce/sonra örneği: ilk eşleşmenin çevresi (HTML'siz). */
function sampleAround(content: string, fullName: string, displayName: string): { before: string; after: string } | null {
  const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const m = fullNamePattern(fullName).exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - 50);
  const end = Math.min(text.length, m.index + m[0].length + 50);
  const before = text.slice(start, end);
  return { before, after: before.replace(fullNamePattern(fullName), displayName) };
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

type Db = Pick<PrismaClient, "doctorProfile" | "auditLog" | "$transaction">;

export interface FieldChange {
  doctorId: string;
  slug: string;
  locale: string; // "en" = kanonik kolon
  field: ContentField;
  count: number;
  sample: { before: string; after: string } | null;
}

export interface ShortenPlan {
  doctors: {
    id: string;
    slug: string;
    fullName: string;
    displayName: string;
    updatedAt: Date;
    next: { bio: string; aboutHtml: string | null; subSpecialty: string | null; translations: Record<string, unknown> };
  }[];
  changes: FieldChange[];
  otherScriptCandidates: { slug: string; locale: string; field: ContentField; text: string }[];
  /** Görünen adı tam adı zaten içeren doktorlar (ör. `publicName` = "Hakan Sofu") — değiştirilmez (yineleme önlenir). */
  skipped: { slug: string; displayName: string; reason?: string }[];
}

function asTranslations(value: unknown): Record<string, Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Record<string, unknown>>) : {};
}

export async function buildShortenPlan(db: Pick<PrismaClient, "doctorProfile">): Promise<ShortenPlan> {
  const rows = await db.doctorProfile.findMany({ where: { isFounder: false }, orderBy: { seq: "asc" } });
  const plan: ShortenPlan = { doctors: [], changes: [], otherScriptCandidates: [], skipped: [] };
  for (const d of rows) {
    const displayName = doctorDisplayName(d);
    const fullName = d.fullName.trim().replace(/\s+/g, " ");
    if (displayName === fullName) continue;
    // Dinamik ad deseni kurulamazsa (beklenmeyen karakter) bu doktor atlanır; script çökmez.
    try {
      fullNamePattern(fullName);
    } catch (err) {
      plan.skipped.push({ slug: d.slug, displayName, reason: `ad deseni kurulamadı: ${(err as Error).message}` });
      continue;
    }
    // Görünen ad tam adı içeriyorsa (elle `publicName`) değiştirme hem anlamsız hem tekrar çalıştırmada birikir.
    if (fullNamePattern(fullName).test(displayName)) {
      plan.skipped.push({ slug: d.slug, displayName });
      continue;
    }
    const changesForDoctor: FieldChange[] = [];

    const apply = (locale: string, field: ContentField, value: unknown): unknown => {
      if (typeof value !== "string" || !value) return value;
      if (locale === "ru" || locale === "ar") {
        for (const text of findOtherScriptCandidates(value, fullName)) plan.otherScriptCandidates.push({ slug: d.slug, locale, field, text });
      }
      const { value: next, count } = replaceNameInContent(value, fullName, displayName);
      if (count > 0) changesForDoctor.push({ doctorId: d.id, slug: d.slug, locale, field, count, sample: sampleAround(value, fullName, displayName) });
      return next;
    };

    const next = {
      bio: apply("en", "bio", d.bio) as string,
      aboutHtml: apply("en", "aboutHtml", d.aboutHtml) as string | null,
      subSpecialty: apply("en", "subSpecialty", d.subSpecialty) as string | null,
      translations: {} as Record<string, unknown>,
    };
    const translations = asTranslations(d.translations);
    for (const [locale, entry] of Object.entries(translations)) {
      if (!entry || typeof entry !== "object") {
        next.translations[locale] = entry;
        continue;
      }
      const copy: Record<string, unknown> = { ...entry };
      for (const field of CONTENT_FIELDS) if (field in copy) copy[field] = apply(locale, field, copy[field]);
      next.translations[locale] = copy;
    }

    if (changesForDoctor.length > 0) {
      plan.changes.push(...changesForDoctor);
      plan.doctors.push({ id: d.id, slug: d.slug, fullName, displayName, updatedAt: d.updatedAt, next });
    }
  }
  return plan;
}

export function formatShortenPlan(plan: ShortenPlan): string {
  const lines: string[] = [];
  if (plan.doctors.length === 0) lines.push("Değiştirilecek tam ad bulunamadı.");
  for (const d of plan.doctors) {
    const changes = plan.changes.filter((c) => c.doctorId === d.id);
    lines.push(`${d.slug}: "${d.fullName}" → "${d.displayName}" — toplam ${changes.reduce((a, c) => a + c.count, 0)} değişiklik`);
    for (const c of changes) {
      lines.push(`  [${c.locale}] ${c.field}: ${c.count}`);
      if (c.sample) {
        lines.push(`    önce:  …${c.sample.before}…`);
        lines.push(`    sonra: …${c.sample.after}…`);
      }
    }
  }
  if (plan.otherScriptCandidates.length) {
    lines.push(`Başka alfabeyle yazılmış ad adayları (OTOMATİK DEĞİŞTİRİLMEZ, elle kontrol edin) — ${plan.otherScriptCandidates.length}:`);
    for (const c of plan.otherScriptCandidates) lines.push(`  - ${c.slug} [${c.locale}] ${c.field}: "${c.text}"`);
  }
  for (const s of plan.skipped) lines.push(`Atlandı: ${s.slug} — ${s.reason ?? `görünen ad ("${s.displayName}") tam adı zaten içeriyor.`}`);
  lines.push("Kurucu doktor ve tek başına geçen ad/soyad değiştirilmez; HTML etiket/öznitelik içlerine dokunulmaz.");
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

interface NamesBackup {
  kind: "doctor-names-backup";
  createdAt: string;
  doctors: { id: string; slug: string; bio: string; aboutHtml: string | null; subSpecialty: string | null; translations: unknown }[];
}

function assertOperator(info: OperatorInfo) {
  const op = info.operator?.trim() ?? "";
  // eslint-disable-next-line no-control-regex
  if (op.length < 3 || op.length > 100 || /[\u0000-\u001f\u007f]/.test(op)) {
    throw new NameShortenError("--operator zorunlu (3–100 karakter, kontrol karakteri yok).");
  }
}

async function writeBackup(db: Pick<PrismaClient, "doctorProfile">, backupDir: string, ids: string[], now: Date): Promise<string> {
  const rows = await db.doctorProfile.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, bio: true, aboutHtml: true, subSpecialty: true, translations: true } });
  const backup: NamesBackup = { kind: "doctor-names-backup", createdAt: now.toISOString(), doctors: rows };
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const file = path.join(backupDir, `names-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(backup, null, 2), { encoding: "utf8", mode: 0o600 });
  return file;
}

function appLike(db: unknown): FastifyInstance {
  const log = { warn: (...a: unknown[]) => console.warn(...a), info: () => {}, error: (...a: unknown[]) => console.error(...a) };
  return { prisma: db, log } as unknown as FastifyInstance;
}

export async function applyShortenPlan(
  db: Db,
  plan: ShortenPlan,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ backupFile: string; doctors: number; replacements: number }> {
  if (options.confirm !== SHORTEN_CONFIRM_KEY) throw new NameShortenError(`Gerçek yazma için --confirm=${SHORTEN_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  if (plan.doctors.length === 0) throw new NameShortenError("Yazılacak değişiklik yok.");
  const backupFile = await writeBackup(db, options.backupDir, plan.doctors.map((d) => d.id), options.now ?? new Date());
  const replacements = plan.changes.reduce((a, c) => a + c.count, 0);

  await db.$transaction(async (tx) => {
    for (const d of plan.doctors) {
      const current = await tx.doctorProfile.findUnique({ where: { id: d.id }, select: { updatedAt: true } });
      if (!current || current.updatedAt.getTime() !== d.updatedAt.getTime()) {
        throw new NameShortenError(`"${d.slug}" plan alındıktan sonra değişmiş; işlem geri alındı. Kuru çalışmayı yeniden yapın.`);
      }
      await tx.doctorProfile.update({
        where: { id: d.id },
        data: { bio: d.next.bio, aboutHtml: d.next.aboutHtml, subSpecialty: d.next.subSpecialty, translations: d.next.translations as Prisma.InputJsonValue },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: SHORTEN_AUDIT_ACTION,
        targetType: "DoctorProfile",
        targetId: null,
        metadata: {
          operator: options.operator,
          osUser: options.osUser,
          hostname: options.hostname,
          backupFile: path.basename(backupFile),
          doctors: plan.doctors.map((d) => d.slug),
          replacements,
        },
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.doctors]);
  return { backupFile, doctors: plan.doctors.length, replacements };
}

export async function restoreShortenBackup(
  db: Db,
  backupFile: string,
  options: OperatorInfo & { confirm?: string; backupDir: string; now?: Date; revalidate?: boolean }
): Promise<{ preRestoreBackup: string; doctors: number }> {
  if (options.confirm !== SHORTEN_RESTORE_CONFIRM_KEY) throw new NameShortenError(`Geri dönüş için --confirm=${SHORTEN_RESTORE_CONFIRM_KEY} gerekir.`);
  assertOperator(options);
  const backup = JSON.parse(await fs.readFile(backupFile, "utf8")) as NamesBackup;
  if (backup?.kind !== "doctor-names-backup" || !Array.isArray(backup.doctors)) throw new NameShortenError("Geçerli bir ad yedeği değil.");
  for (const d of backup.doctors) {
    if (typeof d.id !== "string" || typeof d.bio !== "string" || !(d.translations && typeof d.translations === "object" && !Array.isArray(d.translations))) {
      throw new NameShortenError("Yedekte geçersiz kayıt var.");
    }
  }
  const preRestoreBackup = await writeBackup(db, options.backupDir, backup.doctors.map((d) => d.id), options.now ?? new Date());
  await db.$transaction(async (tx) => {
    for (const d of backup.doctors) {
      const current = await tx.doctorProfile.findUnique({ where: { id: d.id }, select: { slug: true } });
      if (!current || current.slug !== d.slug) throw new NameShortenError(`Yedekteki doktor bulunamadı ya da slug değişmiş (${d.slug}).`);
      await tx.doctorProfile.update({
        where: { id: d.id },
        data: { bio: d.bio, aboutHtml: d.aboutHtml, subSpecialty: d.subSpecialty, translations: d.translations as Prisma.InputJsonValue },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: SHORTEN_RESTORE_AUDIT_ACTION,
        targetType: "DoctorProfile",
        targetId: null,
        metadata: { operator: options.operator, osUser: options.osUser, hostname: options.hostname, backupFile: path.basename(backupFile), preRestoreBackup: path.basename(preRestoreBackup) },
      },
    });
  });
  if (options.revalidate !== false) await triggerTagRevalidation(appLike(db), [CACHE_TAGS.doctors]);
  return { preRestoreBackup, doctors: backup.doctors.length };
}
