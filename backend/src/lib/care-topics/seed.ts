import type { Prisma, PrismaClient } from "@prisma/client";
import { CARE_TOPIC_CATALOG, type CatalogTopic } from "./catalog";
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
 * Paket W — `seed-care-topics` mantığı (script: `backend/scripts/seed-care-topics.ts`).
 * İDEMPOTENT: slug'ı zaten olan konuya DOKUNULMAZ (admin düzenlemiş olabilir); yalnızca eksik konular
 * eklenir. Veritabanında olmayan uzmanlık slug'ının ağırlığı atlanır ve planda raporlanır.
 */
export const SEED_CARE_TOPICS_CONFIRM_KEY = "seed-care-topics";

type TopicTexts = Record<string, { label: string; description: string; synonyms: string[] }>;
export const CARE_TOPIC_TEXTS: Record<string, TopicTexts> = { en, tr, de, fr, es, ru, ar, ro, "sr-latn": srLatn };

export interface SeedCareTopicsPlan {
  toCreate: { topic: CatalogTopic; translations: Prisma.InputJsonObject; weights: { specialtyId: string; slug: string; weight: number }[]; sortOrder: number }[];
  existing: string[];
  missingSpecialties: string[];
  missingTexts: string[];
}

export function translationsFor(slug: string): { translations: Record<string, { label: string; description: string; synonyms: string[] }>; missing: string[] } {
  const translations: Record<string, { label: string; description: string; synonyms: string[] }> = {};
  const missing: string[] = [];
  for (const [lang, texts] of Object.entries(CARE_TOPIC_TEXTS)) {
    const text = texts[slug];
    if (text && text.label) translations[lang] = { label: text.label, description: text.description ?? "", synonyms: text.synonyms ?? [] };
    else missing.push(`${slug}:${lang}`);
  }
  return { translations, missing };
}

export async function buildSeedCareTopicsPlan(db: PrismaClient): Promise<SeedCareTopicsPlan> {
  const existingRows = await db.careTopic.findMany({ select: { slug: true } });
  const existing = new Set(existingRows.map((r) => r.slug));
  const specialtySlugs = [...new Set(CARE_TOPIC_CATALOG.flatMap((t) => Object.keys(t.weights)))];
  const specialties = await db.specialty.findMany({ where: { slug: { in: specialtySlugs } }, select: { id: true, slug: true } });
  const idBySlug = new Map(specialties.map((s) => [s.slug, s.id]));
  const plan: SeedCareTopicsPlan = { toCreate: [], existing: [], missingSpecialties: specialtySlugs.filter((s) => !idBySlug.has(s)), missingTexts: [] };
  CARE_TOPIC_CATALOG.forEach((topic, index) => {
    if (existing.has(topic.slug)) {
      plan.existing.push(topic.slug);
      return;
    }
    const { translations, missing } = translationsFor(topic.slug);
    plan.missingTexts.push(...missing);
    const weights = Object.entries(topic.weights)
      .filter(([slug]) => idBySlug.has(slug))
      .map(([slug, weight]) => ({ specialtyId: idBySlug.get(slug)!, slug, weight }));
    plan.toCreate.push({ topic, translations, weights, sortOrder: (index + 1) * 10 });
  });
  return plan;
}

export function formatSeedCareTopicsPlan(plan: SeedCareTopicsPlan): string {
  const lines = [
    `Eklenecek konu: ${plan.toCreate.length} (kırmızı bayrak: ${plan.toCreate.filter((c) => c.topic.isRedFlag).length})`,
    `Zaten var (dokunulmayacak): ${plan.existing.length}`,
  ];
  if (plan.missingSpecialties.length) lines.push(`UYARI — veritabanında olmayan uzmanlık (ağırlıkları atlanır): ${plan.missingSpecialties.join(", ")}`);
  if (plan.missingTexts.length) lines.push(`UYARI — eksik çeviri: ${plan.missingTexts.join(", ")}`);
  for (const c of plan.toCreate.slice(0, 200)) {
    const w = c.weights.map((x) => `${x.slug} ${x.weight}`).join(" · ") || (c.topic.isRedFlag ? "KIRMIZI BAYRAK" : "KOORD");
    lines.push(`  + ${c.topic.slug} [${c.topic.bodyArea}] → ${w}`);
  }
  return lines.join("\n");
}

export async function applySeedCareTopicsPlan(db: PrismaClient, plan: SeedCareTopicsPlan, opts: { confirm: string; operator: string; osUser: string; hostname: string }) {
  if (opts.confirm !== SEED_CARE_TOPICS_CONFIRM_KEY) throw new Error(`Onay anahtarı yanlış: --confirm=${SEED_CARE_TOPICS_CONFIRM_KEY} olmalı.`);
  if (!opts.operator.trim()) throw new Error('--operator="Ad Soyad" gerekli.');
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    for (const c of plan.toCreate) {
      if (await tx.careTopic.findUnique({ where: { slug: c.topic.slug }, select: { id: true } })) continue;
      const row = await tx.careTopic.create({
        data: { slug: c.topic.slug, bodyArea: c.topic.bodyArea, translations: c.translations, isRedFlag: c.topic.isRedFlag ?? false, isActive: true, sortOrder: c.sortOrder },
      });
      if (c.weights.length) await tx.careTopicSpecialty.createMany({ data: c.weights.map((w) => ({ topicId: row.id, specialtyId: w.specialtyId, weight: w.weight })) });
      created.push(c.topic.slug);
    }
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: "matcher.topics_seeded",
        targetType: "CareTopic",
        targetId: null,
        metadata: { created: created.length, operator: opts.operator, osUser: opts.osUser, hostname: opts.hostname },
      },
    });
  });
  return { created };
}
