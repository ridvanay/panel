import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { foldTerm, textContainsTerm } from "../../lib/matcher-text";
import { fuzzyMatchScore } from "../../lib/matcher-fuzzy";
import { PUBLIC_DOCTOR_WHERE } from "../telehealth/lib/archive-filters";
import { computeEarliestAvailability } from "../telehealth/lib/earliest-availability";
import { generateAvailableSlots } from "../telehealth/lib/availability";
import { findTimeOffInWindow, subtractTimeOff } from "../telehealth/lib/time-off";
import { localizeDoctor, localizeDoctorSpecialties, localizeSpecialty } from "../telehealth/lib/doctor-localization";
import { parseLanguageSupport } from "../telehealth/lib/language-support";
import { toDoctorProfileDto } from "../../mappers";

/**
 * Paket W — "Find my physician" kural tabanlı eşleştirme. TANI KOYMAZ: hastalık adı, olasılık ya da
 * tedavi önerisi üretmez; yalnızca katalogdaki konu → uzmanlık ağırlıklarından uzmanlık ve hekim önerir.
 * Yapay zekâ / dış API YOK.
 *
 * SIRALAMA KURALI (şeffaf; kurucu önceliği YOK):
 *  1. Uzmanlık puanı = seçilen konulardaki ağırlıkların toplamı. Yayında ve aktif hekimi OLMAYAN
 *     uzmanlık puanlamadan düşülür. Puanı ≥ 40 olanlardan en yüksek 2'si önerilir (eşitlikte ad sırası).
 *     Kalmazsa koordinatör yolu.
 *  2. Hekimler (önerilen uzmanlıklarda birincil ya da ek uzmanlığı olanlar) şu sırayla dizilir:
 *     a) birincil uzmanlık eşleşmesi, ek uzmanlık eşleşmesinden önce;
 *     b) hastanın seçtiği görüşme dilini konuşan önce;
 *     c) en yakın müsait slot önce (müsaitliği olmayan en sona);
 *     d) eşitlikte birincil uzmanlığın öneri sırası (ilk önerilen uzmanlığın hekimi önce), sonra görünen ad.
 *     İlk 3 hekim gösterilir; her biri için en yakın 3 müsait slot (14 gün).
 */

/** Varsayılanlar — Tele-Sağlık → Ayarlar → "Eşleştirme sihirbazı" kartından değiştirilebilir (audit'li). */
export const MATCHER_SCORE_THRESHOLD = 40;
export const MATCHER_MAX_SPECIALTIES = 2;
export const MATCHER_MAX_DOCTORS = 3;
export const MATCHER_MAX_TOPICS = 3;
export const MATCHER_SLOT_WINDOW_DAYS = 14;
export const MATCHER_FREE_TEXT_MAX = 500;

// ------------------------------------------------------------------------------------------------
// Ayarlar — `SiteModule(telehealth).settings` (Paket V/AA deseni).
// ------------------------------------------------------------------------------------------------
export interface MatcherSettings {
  /** true (varsayılan): iletişim adımı sonuçtan ÖNCE ve zorunlu; false: sonuçlardan sonra opsiyonel. */
  contactRequired: boolean;
  /** Sihirbaz taleplerinin sağlık VE kişi alanlarının anonimleştirilmesine kadar gün (varsayılan 365). */
  retentionDays: number;
  /** Uzmanlık önerisi için en düşük puan (varsayılan 40). */
  scoreThreshold: number;
  /** En çok önerilecek uzmanlık sayısı (varsayılan 2). */
  maxSpecialties: number;
}

export const MATCHER_THRESHOLD_MIN = 1;
export const MATCHER_THRESHOLD_MAX = 300;
export const MATCHER_MAX_SPECIALTIES_LIMIT = 5;

export const MATCHER_RETENTION_MIN = 30;
export const MATCHER_RETENTION_MAX = 3650;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseMatcherSettings(rawSettings: unknown): MatcherSettings {
  const raw = asRecord(rawSettings);
  const days = raw.matcherRetentionDays;
  const intIn = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback);
  return {
    contactRequired: raw.matcherContactRequired !== false,
    retentionDays: intIn(days, MATCHER_RETENTION_MIN, MATCHER_RETENTION_MAX, 365),
    scoreThreshold: intIn(raw.matcherScoreThreshold, MATCHER_THRESHOLD_MIN, MATCHER_THRESHOLD_MAX, MATCHER_SCORE_THRESHOLD),
    maxSpecialties: intIn(raw.matcherMaxSpecialties, 1, MATCHER_MAX_SPECIALTIES_LIMIT, MATCHER_MAX_SPECIALTIES),
  };
}

export async function readTelehealthSettingsRaw(app: FastifyInstance): Promise<unknown> {
  return (await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } }))?.settings ?? null;
}

// ------------------------------------------------------------------------------------------------
// Katalog metinleri
// ------------------------------------------------------------------------------------------------
export interface TopicText {
  label: string;
  description: string;
  synonyms: string[];
}

export function readTopicTranslations(raw: unknown): Record<string, TopicText> {
  const out: Record<string, TopicText> = {};
  for (const [lang, value] of Object.entries(asRecord(raw))) {
    const v = asRecord(value);
    if (typeof v.label !== "string" || !v.label.trim()) continue;
    out[lang] = {
      label: v.label,
      description: typeof v.description === "string" ? v.description : "",
      synonyms: Array.isArray(v.synonyms) ? v.synonyms.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [],
    };
  }
  return out;
}

/** Aktif dil yoksa EN, o da yoksa ilk dil. */
export function topicTextFor(translations: Record<string, TopicText>, lang: string): TopicText {
  return translations[lang] ?? translations.en ?? Object.values(translations)[0] ?? { label: "", description: "", synonyms: [] };
}

interface CachedTopic {
  id: string;
  slug: string;
  bodyArea: string;
  isRedFlag: boolean;
  sortOrder: number;
  targetSpecialtyHint: string | null;
  translations: Record<string, TopicText>;
  weights: { specialtyId: string; weight: number }[];
  /** Paket W-ek — arama için katlanmış terimler (tüm diller; etiketler işaretli). */
  searchTerms: { term: string; lang: string; isLabel: boolean }[];
}

function buildSearchTerms(translations: Record<string, TopicText>): CachedTopic["searchTerms"] {
  const seen = new Set<string>();
  const out: CachedTopic["searchTerms"] = [];
  for (const [lang, text] of Object.entries(translations)) {
    for (const [i, raw] of [text.label, ...text.synonyms].entries()) {
      const term = foldTerm(raw);
      const key = `${lang}|${term}`;
      if (!term || seen.has(key)) continue;
      seen.add(key);
      out.push({ term, lang, isLabel: i === 0 });
    }
  }
  return out;
}

let topicCache: { at: number; topics: CachedTopic[] } | null = null;
const TOPIC_CACHE_MS = 5 * 60 * 1000;

export function invalidateMatcherTopicCache(): void {
  topicCache = null;
  searchCache.clear();
  recommendCache.clear();
}

export async function loadActiveTopics(app: FastifyInstance): Promise<CachedTopic[]> {
  if (topicCache && Date.now() - topicCache.at < TOPIC_CACHE_MS) return topicCache.topics;
  const rows = await app.prisma.careTopic.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
    include: { specialties: { select: { specialtyId: true, weight: true } } },
  });
  const topics = rows.map((row) => {
    const translations = readTopicTranslations(row.translations);
    return {
      id: row.id,
      slug: row.slug,
      bodyArea: row.bodyArea,
      isRedFlag: row.isRedFlag,
      sortOrder: row.sortOrder,
      targetSpecialtyHint: row.targetSpecialtyHint,
      translations,
      weights: row.specialties,
      searchTerms: buildSearchTerms(translations),
    };
  });
  topicCache = { at: Date.now(), topics };
  return topics;
}

/** Bir konunun aranabilir terimleri (tüm diller: etiket + eş anlamlılar), katlanmış. */
function foldedTermsOf(topic: CachedTopic): string[] {
  const terms = new Set<string>();
  for (const text of Object.values(topic.translations)) {
    for (const term of [text.label, ...text.synonyms]) {
      const folded = foldTerm(term);
      if (folded) terms.add(folded);
    }
  }
  return [...terms];
}

/** Serbest metinde geçen kırmızı bayrak konularının slug'ları (tüm dillerin eş anlamlıları). */
export async function detectRedFlagsInText(app: FastifyInstance, text: string): Promise<string[]> {
  const folded = foldTerm(text);
  if (!folded) return [];
  const topics = await loadActiveTopics(app);
  return topics.filter((topic) => topic.isRedFlag && foldedTermsOf(topic).some((term) => textContainsTerm(folded, term))).map((topic) => topic.slug);
}

/**
 * Hiçbir konuyla eşleşmeyen serbest metin terimleri (rapor için anonim sıklık). Yalnızca harften
 * oluşan, ≥ 4 harfli kelimeler; en çok 5. Kişi adı riskine karşı raporda yalnızca sıklığı ≥ 3 olanlar
 * gösterilir (bkz. admin raporu).
 */
export async function unmatchedTerms(app: FastifyInstance, text: string): Promise<string[]> {
  const folded = foldTerm(text);
  if (!folded) return [];
  const topics = await loadActiveTopics(app);
  const known = new Set<string>();
  for (const topic of topics) for (const term of foldedTermsOf(topic)) for (const word of term.split(" ")) known.add(word);
  const words = [...new Set(folded.split(" "))].filter((w) => w.length >= 4 && /^\p{L}+$/u.test(w) && !known.has(w));
  return words.slice(0, 5);
}

// ------------------------------------------------------------------------------------------------
// Paket W-ek — arama (9 dil, yazım hatası toleranslı) ve popülerlik
// ------------------------------------------------------------------------------------------------
export const MATCHER_SEARCH_LIMIT = 8;
/** Güvenlik incelemesi — sorguda en çok bu kadar sözcük; aynı (dil, sorgu) 60 sn bellekte (en çok 500). */
const MATCHER_SEARCH_MAX_WORDS = 6;
const SEARCH_CACHE_MS = 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const searchCache = new Map<string, { at: number; hits: TopicSearchHit[] }>();
/** Aramadan seçim sayacı: konu başına günlük üst sınır (bot şişirmesine karşı; rapor yaklaşık değerdir). */
export const MATCHER_SEARCH_PICK_DAILY_CAP = 1000;

export interface TopicSearchHit {
  id: string;
  slug: string;
  bodyArea: string;
  isRedFlag: boolean;
  label: string;
  description: string;
  /** Eşleşen terim etiket değilse hastaya "… olarak da bilinir" göstermek için (aktif dil/EN dışı olabilir). */
  matched: string | null;
  score: number;
}

/**
 * Bütün konuları 9 dilin etiket + eş anlamlılarında arar. Puan: `fuzzyMatchScore` (tam > önek > içerir >
 * yazım hatası); aktif dilde eşleşme küçük bir öncelik alır, eşitlikte `sortOrder`.
 */
export async function searchTopics(app: FastifyInstance, query: string, lang: string, limit = MATCHER_SEARCH_LIMIT): Promise<TopicSearchHit[]> {
  const q = foldTerm(query).split(" ").slice(0, MATCHER_SEARCH_MAX_WORDS).join(" ");
  if (q.length < 2) return [];
  const cacheKey = `${lang}|${limit}|${q}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.hits;
  const topics = await loadActiveTopics(app);
  const hits: (TopicSearchHit & { sortOrder: number })[] = [];
  for (const topic of topics) {
    let best = 0;
    let bestTerm: CachedTopic["searchTerms"][number] | null = null;
    for (const term of topic.searchTerms) {
      const base = fuzzyMatchScore(q, term.term);
      if (!base) continue;
      const score = base * 10 + (term.lang === lang ? 3 : term.lang === "en" ? 1 : 0) + (term.isLabel ? 1 : 0);
      if (score > best) {
        best = score;
        bestTerm = term;
      }
    }
    if (!best || !bestTerm) continue;
    const text = topicTextFor(topic.translations, lang);
    // Eşleşen terim etiketin içinde zaten geçiyorsa ayrıca gösterilmez.
    const own = foldTerm(text.label).includes(bestTerm.term);
    // KVKK incelemesi — kırmızı bayrakta "… ile eşleşti" (tanı çağrıştıran terim) gösterilmez.
    const original = own || topic.isRedFlag ? null : findOriginalTerm(topic.translations, bestTerm);
    hits.push({ id: topic.id, slug: topic.slug, bodyArea: topic.bodyArea, isRedFlag: topic.isRedFlag, label: text.label, description: text.description, matched: original, score: best, sortOrder: topic.sortOrder });
  }
  const result = hits
    .sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder)
    .slice(0, limit)
    .map(({ sortOrder: _sortOrder, ...hit }) => hit);
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value!);
  searchCache.set(cacheKey, { at: Date.now(), hits: result });
  return result;
}

/** Aramadan seçim: konu başına günlük üst sınır dolmadıysa artar. */
export async function incrementSearchPick(app: FastifyInstance, slug: string, now = new Date()): Promise<void> {
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const row = await app.prisma.matcherStat.findUnique({ where: { day_kind_key: { day, kind: "search_pick", key: slug } }, select: { count: true } });
  if (row && row.count >= MATCHER_SEARCH_PICK_DAILY_CAP) return;
  await incrementMatcherStat(app, "search_pick", slug, now);
}

function findOriginalTerm(translations: Record<string, TopicText>, term: { term: string; lang: string }): string | null {
  const text = translations[term.lang];
  if (!text) return null;
  return [text.label, ...text.synonyms].find((raw) => foldTerm(raw) === term.term) ?? null;
}

let popularityCache: { at: number; counts: Map<string, number> } | null = null;
const POPULARITY_CACHE_MS = 10 * 60 * 1000;
export const MATCHER_POPULARITY_DAYS = 90;

/** Son 90 günde konu başına seçim + aramadan seçim sayısı (anonim sayaçlardan). 10 dk önbellek. */
export async function topicPopularity(app: FastifyInstance, now = new Date()): Promise<Map<string, number>> {
  if (popularityCache && Date.now() - popularityCache.at < POPULARITY_CACHE_MS) return popularityCache.counts;
  const since = new Date(now.getTime() - MATCHER_POPULARITY_DAYS * 86_400_000);
  const grouped = await app.prisma.matcherStat.groupBy({ by: ["key"], where: { kind: { in: ["topic", "search_pick"] }, day: { gte: since } }, _sum: { count: true } });
  const counts = new Map(grouped.map((g) => [g.key, g._sum.count ?? 0]));
  popularityCache = { at: Date.now(), counts };
  return counts;
}

export function clearTopicPopularityCache(): void {
  popularityCache = null;
}

// ------------------------------------------------------------------------------------------------
// Anonim sayaçlar
// ------------------------------------------------------------------------------------------------
export type MatcherStatKind = "step" | "topic" | "unmatched_term" | "red_flag" | "submit" | "search_pick";

/** Güvenlik/uyumluluk incelemesi — günde en çok bu kadar farklı eşleşmeyen terim; sayaç satırları 90 günde silinir. */
export const MATCHER_UNMATCHED_DAILY_CAP = 500;
export const MATCHER_STAT_RETENTION_DAYS = 90;

/** Eşleşmeyen terim: mevcut anahtar artar; yeni anahtar yalnızca günlük üst sınır dolmadıysa açılır. */
export async function incrementUnmatchedTerm(app: FastifyInstance, term: string, now = new Date()): Promise<void> {
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const exists = await app.prisma.matcherStat.findUnique({ where: { day_kind_key: { day, kind: "unmatched_term", key: term } }, select: { count: true } });
  if (!exists && (await app.prisma.matcherStat.count({ where: { day, kind: "unmatched_term" } })) >= MATCHER_UNMATCHED_DAILY_CAP) return;
  await incrementMatcherStat(app, "unmatched_term", term, now);
}

/** Saklama: 90 günden eski anonim sayaç satırları silinir (eşleşmeyen ham terimler dahil). */
export async function purgeOldMatcherStats(app: FastifyInstance, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MATCHER_STAT_RETENTION_DAYS * 86_400_000);
  return (await app.prisma.matcherStat.deleteMany({ where: { day: { lt: cutoff } } })).count;
}

export async function incrementMatcherStat(app: FastifyInstance, kind: MatcherStatKind, key: string, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  try {
    await app.prisma.$executeRaw`INSERT INTO "matcher_stats" ("day", "kind", "key", "count") VALUES (${day}::date, ${kind}, ${key.slice(0, 120)}, 1)
      ON CONFLICT ("day", "kind", "key") DO UPDATE SET "count" = "matcher_stats"."count" + 1`;
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, "Eşleştirme sayacı yazılamadı (best-effort).");
  }
}

// ------------------------------------------------------------------------------------------------
// Öneri
// ------------------------------------------------------------------------------------------------
export interface RecommendInput {
  topicIds: string[];
  preferredLanguage: string;
  locale: string;
}

export interface RecommendedSpecialty {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  score: number;
}

export interface RecommendedDoctor {
  id: string;
  slug: string;
  displayName: string;
  title: string;
  avatarUrl: string | null;
  specialtyName: string | null;
  /** Randevu bağlantısı için: hekimin önerilen uzmanlıklardan eşleşen uzmanlığının slug'ı (birincil öncelikli). */
  matchedSpecialtySlug: string;
  languages: string[];
  primaryMatch: boolean;
  speaksLanguage: boolean;
  slots: { startsAt: string; endsAt: string }[];
}

export interface RecommendResult {
  redFlag: boolean;
  redFlagTopicSlugs: string[];
  coordinator: boolean;
  specialties: RecommendedSpecialty[];
  doctors: RecommendedDoctor[];
  /** Paket AA — "Ücretsiz tercüman desteği" rozeti (`languageSupport.interpreterIncluded`). */
  interpreterIncluded: boolean;
  topicSlugs: string[];
}

const DOCTOR_INCLUDE = {
  specialty: true,
  avatarMedia: true,
  availability: true,
  additionalSpecialties: { include: { specialty: true } },
} satisfies Prisma.DoctorProfileInclude;

/** Uzmanlık puanları — saf fonksiyon (test edilebilir). */
export function scoreSpecialties(topics: readonly { weights: readonly { specialtyId: string; weight: number }[] }[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const topic of topics) for (const w of topic.weights) scores.set(w.specialtyId, (scores.get(w.specialtyId) ?? 0) + w.weight);
  return scores;
}

/** Hekim sıralaması — saf fonksiyon (kural yukarıda). */
export function rankDoctors<T extends { primaryMatch: boolean; speaksLanguage: boolean; earliestAt: string | null; specialtyRank: number; displayName: string }>(doctors: T[]): T[] {
  return [...doctors].sort((a, b) => {
    if (a.primaryMatch !== b.primaryMatch) return a.primaryMatch ? -1 : 1;
    if (a.speaksLanguage !== b.speaksLanguage) return a.speaksLanguage ? -1 : 1;
    const ea = a.earliestAt ? Date.parse(a.earliestAt) : Number.POSITIVE_INFINITY;
    const eb = b.earliestAt ? Date.parse(b.earliestAt) : Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea - eb;
    if (a.specialtyRank !== b.specialtyRank) return a.specialtyRank - b.specialtyRank;
    return a.displayName.localeCompare(b.displayName, "en");
  });
}

async function nextSlots(app: FastifyInstance, doctor: { id: string; timeZone: string; sessionDurationMin: number; availability: Parameters<typeof generateAvailableSlots>[0]["rules"] }, now: Date, count: number) {
  const from = new Date(now.getTime());
  const to = new Date(now.getTime() + MATCHER_SLOT_WINDOW_DAYS * 86_400_000);
  const cal = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  const rangeStart = new Date(from.getTime() - 86_400_000);
  const rangeEnd = new Date(to.getTime() + 2 * 86_400_000);
  const booked = await app.prisma.appointment.findMany({
    where: { doctorId: doctor.id, startsAt: { gte: rangeStart, lte: rangeEnd } },
    select: { startsAt: true },
  });
  const generated = generateAvailableSlots({
    timeZone: doctor.timeZone,
    sessionDurationMin: doctor.sessionDurationMin,
    rules: doctor.availability,
    fromDate: cal(from),
    toDate: cal(to),
    now,
    bookedStartTimesMs: new Set(booked.map((b) => b.startsAt.getTime())),
  });
  const timeOff = await findTimeOffInWindow(app, doctor.id, rangeStart, rangeEnd);
  return subtractTimeOff(generated, timeOff)
    .filter((slot) => slot.available && slot.startsAt.getTime() > now.getTime())
    .slice(0, count)
    .map((slot) => ({ startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() }));
}

/**
 * Güvenlik incelemesi — herkese açık `/recommend` her çağrıda hekim/slot hesabı yaptığı için sonuç
 * `konular + dil + yerel` anahtarıyla 60 sn bellekte tutulur (anonim; kişi verisi yok).
 */
const RECOMMEND_CACHE_MS = 60 * 1000;
const recommendCache = new Map<string, { at: number; result: RecommendResult }>();

export function recommendCacheKey(input: RecommendInput): string {
  return `${[...input.topicIds].sort().join(",")}|${input.preferredLanguage}|${input.locale}`;
}

export async function recommendCached(app: FastifyInstance, input: RecommendInput): Promise<{ result: RecommendResult; cached: boolean }> {
  const key = recommendCacheKey(input);
  const hit = recommendCache.get(key);
  if (hit && Date.now() - hit.at < RECOMMEND_CACHE_MS) return { result: hit.result, cached: true };
  const result = await recommend(app, input);
  if (recommendCache.size > 500) recommendCache.clear();
  recommendCache.set(key, { at: Date.now(), result });
  return { result, cached: false };
}

export function clearRecommendCache(): void {
  recommendCache.clear();
}

export async function recommend(app: FastifyInstance, input: RecommendInput, now = new Date()): Promise<RecommendResult> {
  const all = await loadActiveTopics(app);
  const selected = all.filter((topic) => input.topicIds.includes(topic.id));
  const rawSettings = await readTelehealthSettingsRaw(app);
  const support = parseLanguageSupport(rawSettings);
  const { scoreThreshold, maxSpecialties } = parseMatcherSettings(rawSettings);
  const base = { interpreterIncluded: support.interpreterIncluded, topicSlugs: selected.map((t) => t.slug) };

  const redFlags = selected.filter((t) => t.isRedFlag).map((t) => t.slug);
  if (redFlags.length > 0) {
    return { ...base, redFlag: true, redFlagTopicSlugs: redFlags, coordinator: false, specialties: [], doctors: [] };
  }

  const scores = scoreSpecialties(selected);
  const scoredIds = [...scores.keys()];
  const empty = { ...base, redFlag: false, redFlagTopicSlugs: [], coordinator: true, specialties: [], doctors: [] };
  if (scoredIds.length === 0) return empty;

  // Yayında ve aktif hekimi olan (birincil ya da ek) uzmanlıklar — olmayan puanlamadan düşülür.
  const doctors = await app.prisma.doctorProfile.findMany({
    where: {
      ...PUBLIC_DOCTOR_WHERE,
      OR: [{ specialtyId: { in: scoredIds } }, { additionalSpecialties: { some: { specialtyId: { in: scoredIds } } } }],
    },
    include: DOCTOR_INCLUDE,
  });
  const staffed = new Set<string>();
  for (const d of doctors) {
    if (d.specialtyId) staffed.add(d.specialtyId);
    for (const link of d.additionalSpecialties) staffed.add(link.specialtyId);
  }
  const specialtyRows = await app.prisma.specialty.findMany({ where: { id: { in: scoredIds }, isActive: true } });
  const locale = input.locale;
  const ranked = specialtyRows
    .filter((s) => staffed.has(s.id) && (scores.get(s.id) ?? 0) >= scoreThreshold)
    .map((s) => ({ row: s, score: scores.get(s.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name, "en"))
    .slice(0, maxSpecialties);
  if (ranked.length === 0) return empty;

  const recIds = ranked.map((r) => r.row.id);
  const candidates = doctors.filter((d) => (d.specialtyId && recIds.includes(d.specialtyId)) || d.additionalSpecialties.some((l) => recIds.includes(l.specialtyId)));
  const earliest = await computeEarliestAvailability(app, candidates, now);
  const prepared = candidates.map((d) => {
    const dto = toDoctorProfileDto(localizeDoctorSpecialties(localizeDoctor(d, locale), locale));
    const primaryMatch = d.specialtyId !== null && recIds.includes(d.specialtyId);
    const matchedIds = [d.specialtyId, ...d.additionalSpecialties.map((l) => l.specialtyId)].filter((id): id is string => !!id && recIds.includes(id));
    return {
      row: d,
      dto,
      primaryMatch,
      speaksLanguage: d.languages.includes(input.preferredLanguage),
      earliestAt: earliest.get(d.id) ?? null,
      // Eşitlikte birincil uzmanlığın öneri sırası (birincil > ek kuralı); birincil önerilmiyorsa ek uzmanlığın sırası + 10.
      specialtyRank: primaryMatch ? recIds.indexOf(d.specialtyId!) : 10 + Math.min(...matchedIds.map((id) => recIds.indexOf(id))),
      displayName: dto.displayName ?? dto.fullName,
    };
  });
  const top = rankDoctors(prepared).slice(0, MATCHER_MAX_DOCTORS);
  const result: RecommendedDoctor[] = [];
  for (const d of top) {
    result.push({
      id: d.row.id,
      slug: d.row.slug,
      displayName: d.displayName,
      title: d.dto.title,
      avatarUrl: d.dto.avatarMedia?.url ?? null,
      specialtyName: d.dto.specialty?.name ?? null,
      matchedSpecialtySlug: (() => {
        const id = d.primaryMatch ? d.row.specialtyId! : d.row.additionalSpecialties.map((l) => l.specialtyId).find((sid) => recIds.includes(sid))!;
        return ranked.find((r) => r.row.id === id)?.row.slug ?? ranked[0]!.row.slug;
      })(),
      languages: d.row.languages,
      primaryMatch: d.primaryMatch,
      speaksLanguage: d.speaksLanguage,
      slots: await nextSlots(app, d.row, now, 3),
    });
  }

  return {
    ...base,
    redFlag: false,
    redFlagTopicSlugs: [],
    coordinator: false,
    specialties: ranked.map(({ row, score }) => {
      const localized = localizeSpecialty(row, locale);
      return { id: row.id, slug: row.slug, name: localized.name, description: localized.description, score };
    }),
    doctors: result,
  };
}
