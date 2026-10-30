import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CARE_TOPIC_CATALOG, type CatalogTopic } from "./catalog";
import legacySeedHashes from "./legacy-seed-hashes.json";
import en from "./i18n/en.json";
import tr from "./i18n/tr.json";
import de from "./i18n/de.json";
import fr from "./i18n/fr.json";
import es from "./i18n/es.json";
import ru from "./i18n/ru.json";
import ar from "./i18n/ar.json";
import ro from "./i18n/ro.json";
import srLatn from "./i18n/sr-latn.json";

/**
 * Paket W / W-ek — `seed-care-topics` mantığı (script: `backend/scripts/seed-care-topics.ts`).
 *
 * - Varsayılan: YALNIZCA yeni konular eklenir; var olan konuya dokunulmaz (admin düzenlemiş olabilir).
 * - `--update-existing`: var olan konu, seed'in son yazdığı içerikten bu yana DEĞİŞMEMİŞSE güncellenir.
 *   "Değişmemiş" = kaydın şimdiki içerik özeti (bölge, metinler, kırmızı bayrak, ipucu, ağırlıklar)
 *   `seedHash` ile aynı. Paket W ile yazılmış (`seedHash` boş) kayıtlar için karşılaştırma
 *   `legacy-seed-hashes.json`'a göre yapılır: ağırlıksız içerik özeti aynı VE ağırlıklar, Paket W
 *   ağırlıklarının bu veritabanında var olan uzmanlıklara süzülmüş hâli (o seed de olmayanı atlamıştı).
 *   `isActive` ve `sortOrder` hiçbir zaman değiştirilmez.
 * - Veritabanında olmayan uzmanlık slug'ının ağırlığı atlanır ve planda raporlanır.
 */
export const SEED_CARE_TOPICS_CONFIRM_KEY = "seed-care-topics";

type TopicText = { label: string; description: string; synonyms: string[] };
type TopicTexts = Record<string, TopicText>;
export const CARE_TOPIC_TEXTS: Record<string, TopicTexts> = { en, tr, de, fr, es, ru, ar, ro, "sr-latn": srLatn };
/** Paket W seed içeriği: ağırlıksız içerik özeti + o seed'in ağırlıkları (uzmanlık slug'ı → ağırlık). */
const LEGACY_SEED: Record<string, { hash: string; weights: Record<string, number> }> = legacySeedHashes;

/** Özeti alınan içerik — admin'in değiştirebildiği ve seed'in yazdığı alanlar. */
export interface CareTopicSeedContent {
  bodyArea: string;
  translations: unknown;
  isRedFlag: boolean;
  targetSpecialtyHint: string | null;
  /** Uzmanlık slug'ı → ağırlık. */
  weights: Record<string, number>;
}

/** Anahtar sırasından bağımsız JSON (Postgres jsonb anahtarları yeniden sıralar). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function careTopicContentHash(content: CareTopicSeedContent): string {
  const canonical = stableStringify({
    bodyArea: content.bodyArea,
    translations: content.translations ?? {},
    isRedFlag: content.isRedFlag,
    targetSpecialtyHint: content.targetSpecialtyHint ?? null,
    weights: content.weights,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function translationsFor(slug: string): { translations: Record<string, TopicText>; missing: string[] } {
  const translations: Record<string, TopicText> = {};
  const missing: string[] = [];
  for (const [lang, texts] of Object.entries(CARE_TOPIC_TEXTS)) {
    const text = texts[slug];
    if (text && text.label) translations[lang] = { label: text.label, description: text.description ?? "", synonyms: text.synonyms ?? [] };
    else missing.push(`${slug}:${lang}`);
  }
  return { translations, missing };
}

interface PlannedTopic {
  topic: CatalogTopic;
  translations: Prisma.InputJsonObject;
  weights: { specialtyId: string; slug: string; weight: number }[];
  hash: string;
}

export interface SeedCareTopicsPlan {
  toCreate: (PlannedTopic & { sortOrder: number })[];
  /** Değişmemiş ve seed içeriği farklı — `--update-existing` ile güncellenir. */
  toUpdate: (PlannedTopic & { id: string; expectedHash: string })[];
  /** Admin (ya da başka biri) değiştirmiş — dokunulmaz. */
  skippedModified: string[];
  /** Zaten seed'deki içerikle aynı. */
  upToDate: string[];
  updateExisting: boolean;
  missingSpecialties: string[];
  missingTexts: string[];
}

export async function buildSeedCareTopicsPlan(db: PrismaClient, opts: { updateExisting?: boolean } = {}): Promise<SeedCareTopicsPlan> {
  const rows = await db.careTopic.findMany({
    select: { id: true, slug: true, bodyArea: true, translations: true, isRedFlag: true, targetSpecialtyHint: true, seedHash: true, specialties: { select: { specialtyId: true, weight: true } } },
  });
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const allSpecialties = await db.specialty.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(allSpecialties.map((s) => [s.slug, s.id]));
  const slugById = new Map(allSpecialties.map((s) => [s.id, s.slug]));
  const catalogSpecialtySlugs = [...new Set(CARE_TOPIC_CATALOG.flatMap((t) => Object.keys(t.weights)))];
  const plan: SeedCareTopicsPlan = {
    toCreate: [],
    toUpdate: [],
    skippedModified: [],
    upToDate: [],
    updateExisting: opts.updateExisting ?? false,
    missingSpecialties: catalogSpecialtySlugs.filter((s) => !idBySlug.has(s)),
    missingTexts: [],
  };

  CARE_TOPIC_CATALOG.forEach((topic, index) => {
    const { translations, missing } = translationsFor(topic.slug);
    plan.missingTexts.push(...missing);
    const weights = Object.entries(topic.weights)
      .filter(([slug]) => idBySlug.has(slug))
      .map(([slug, weight]) => ({ specialtyId: idBySlug.get(slug)!, slug, weight }));
    const hash = careTopicContentHash({
      bodyArea: topic.bodyArea,
      translations,
      isRedFlag: topic.isRedFlag ?? false,
      targetSpecialtyHint: topic.targetSpecialtyHint ?? null,
      weights: Object.fromEntries(weights.map((w) => [w.slug, w.weight])),
    });
    const planned: PlannedTopic = { topic, translations: translations as Prisma.InputJsonObject, weights, hash };

    const row = bySlug.get(topic.slug);
    if (!row) {
      plan.toCreate.push({ ...planned, sortOrder: (index + 1) * 10 });
      return;
    }
    const rowContent = {
      bodyArea: row.bodyArea,
      translations: row.translations,
      isRedFlag: row.isRedFlag,
      targetSpecialtyHint: row.targetSpecialtyHint,
      weights: Object.fromEntries(row.specialties.map((s) => [slugById.get(s.specialtyId) ?? s.specialtyId, s.weight])),
    };
    const currentHash = careTopicContentHash(rowContent);
    if (currentHash === hash) {
      plan.upToDate.push(topic.slug);
      return;
    }
    if (!isUnchangedSinceSeed(row.seedHash, currentHash, rowContent, LEGACY_SEED[topic.slug], idBySlug)) {
      plan.skippedModified.push(topic.slug);
      return;
    }
    plan.toUpdate.push({ ...planned, id: row.id, expectedHash: currentHash });
  });
  return plan;
}

/** Seed'den beri değişmemiş mi: `seedHash` varsa ona, yoksa Paket W içeriğine (legacy) göre. */
export function isUnchangedSinceSeed(
  seedHash: string | null,
  currentHash: string,
  current: CareTopicSeedContent,
  legacy: { hash: string; weights: Record<string, number> } | undefined,
  existingSpecialties: Map<string, string>
): boolean {
  if (seedHash) return seedHash === currentHash;
  if (!legacy) return false;
  if (careTopicContentHash({ ...current, weights: {} }) !== legacy.hash) return false;
  const expected = Object.fromEntries(Object.entries(legacy.weights).filter(([slug]) => existingSpecialties.has(slug)));
  return stableStringify(expected) === stableStringify(current.weights);
}

function weightText(c: PlannedTopic): string {
  return c.weights.map((x) => `${x.slug} ${x.weight}`).join(" · ") || (c.topic.isRedFlag ? "KIRMIZI BAYRAK" : `KOORD${c.topic.targetSpecialtyHint ? ` (${c.topic.targetSpecialtyHint})` : ""}`);
}

export function formatSeedCareTopicsPlan(plan: SeedCareTopicsPlan): string {
  const lines = [
    `Eklenecek: ${plan.toCreate.length} (kırmızı bayrak: ${plan.toCreate.filter((c) => c.topic.isRedFlag).length})`,
    plan.updateExisting
      ? `Güncellenecek (değişmemiş kayıt): ${plan.toUpdate.length}`
      : `Güncellenebilir (değişmemiş kayıt; yalnızca --update-existing ile): ${plan.toUpdate.length}`,
    `Atlanacak — admin değiştirmiş: ${plan.skippedModified.length}`,
    `Zaten güncel: ${plan.upToDate.length}`,
  ];
  if (plan.missingSpecialties.length) lines.push(`UYARI — veritabanında olmayan uzmanlık (ağırlıkları atlanır): ${plan.missingSpecialties.join(", ")}`);
  if (plan.missingTexts.length) lines.push(`UYARI — eksik çeviri: ${plan.missingTexts.join(", ")}`);
  if (plan.toCreate.length) lines.push("", "EKLENECEK:");
  for (const c of plan.toCreate) lines.push(`  + ${c.topic.slug} [${c.topic.bodyArea}] → ${weightText(c)}`);
  if (plan.toUpdate.length) lines.push("", plan.updateExisting ? "GÜNCELLENECEK:" : "GÜNCELLENEBİLİR (--update-existing):");
  for (const c of plan.toUpdate) lines.push(`  ~ ${c.topic.slug} [${c.topic.bodyArea}] → ${weightText(c)}`);
  if (plan.skippedModified.length) lines.push("", "ATLANACAK (admin değiştirmiş, dokunulmaz):", ...plan.skippedModified.map((s) => `  = ${s}`));
  return lines.join("\n");
}

export async function applySeedCareTopicsPlan(db: PrismaClient, plan: SeedCareTopicsPlan, opts: { confirm: string; operator: string; osUser: string; hostname: string }) {
  if (opts.confirm !== SEED_CARE_TOPICS_CONFIRM_KEY) throw new Error(`Onay anahtarı yanlış: --confirm=${SEED_CARE_TOPICS_CONFIRM_KEY} olmalı.`);
  if (!opts.operator.trim()) throw new Error('--operator="Ad Soyad" gerekli.');
  const created: string[] = [];
  const updated: string[] = [];
  const skippedChanged: string[] = [];
  await db.$transaction(
    async (tx) => {
      for (const c of plan.toCreate) {
        if (await tx.careTopic.findUnique({ where: { slug: c.topic.slug }, select: { id: true } })) continue;
        const row = await tx.careTopic.create({
          data: {
            slug: c.topic.slug,
            bodyArea: c.topic.bodyArea,
            translations: c.translations,
            isRedFlag: c.topic.isRedFlag ?? false,
            isActive: true,
            sortOrder: c.sortOrder,
            targetSpecialtyHint: c.topic.targetSpecialtyHint ?? null,
            seedHash: c.hash,
          },
        });
        if (c.weights.length) await tx.careTopicSpecialty.createMany({ data: c.weights.map((w) => ({ topicId: row.id, specialtyId: w.specialtyId, weight: w.weight })) });
        created.push(c.topic.slug);
      }
      if (plan.updateExisting) {
        const slugById = new Map((await tx.specialty.findMany({ select: { id: true, slug: true } })).map((s) => [s.id, s.slug]));
        for (const c of plan.toUpdate) {
          // Plan ile yazım arasında biri değiştirdiyse dokunma.
          const row = await tx.careTopic.findUnique({
            where: { id: c.id },
            select: { bodyArea: true, translations: true, isRedFlag: true, targetSpecialtyHint: true, specialties: { select: { specialtyId: true, weight: true } } },
          });
          const now = row
            ? careTopicContentHash({
                bodyArea: row.bodyArea,
                translations: row.translations,
                isRedFlag: row.isRedFlag,
                targetSpecialtyHint: row.targetSpecialtyHint,
                weights: Object.fromEntries(row.specialties.map((s) => [slugById.get(s.specialtyId) ?? s.specialtyId, s.weight])),
              })
            : null;
          if (now !== c.expectedHash) {
            skippedChanged.push(c.topic.slug);
            continue;
          }
          await tx.careTopic.update({
            where: { id: c.id },
            data: { bodyArea: c.topic.bodyArea, translations: c.translations, isRedFlag: c.topic.isRedFlag ?? false, targetSpecialtyHint: c.topic.targetSpecialtyHint ?? null, seedHash: c.hash },
          });
          await tx.careTopicSpecialty.deleteMany({ where: { topicId: c.id } });
          if (c.weights.length) await tx.careTopicSpecialty.createMany({ data: c.weights.map((w) => ({ topicId: c.id, specialtyId: w.specialtyId, weight: w.weight })) });
          updated.push(c.topic.slug);
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorEmail: null,
          action: "matcher.topics_seeded",
          targetType: "CareTopic",
          targetId: null,
          metadata: {
            created: created.length,
            updated: updated.length,
            skippedModified: plan.skippedModified.length + skippedChanged.length,
            operator: opts.operator,
            osUser: opts.osUser,
            hostname: opts.hostname,
          },
        },
      });
    },
    { timeout: 120_000 }
  );
  return { created, updated, skippedChanged };
}
