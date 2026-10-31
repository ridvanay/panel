import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { BODY_AREAS } from "../../lib/care-topics/catalog";
import { PUBLIC_DOCTOR_WHERE } from "../telehealth/lib/archive-filters";
import { mergeTelehealthSettings } from "../telehealth/lib/emergency-notice";
import { requireCrmAccess } from "../crm/crm.access";
import { registerCrmRetentionStep } from "../crm/crm.rollup";
import {
  MATCHER_MAX_SPECIALTIES_LIMIT,
  MATCHER_POPULARITY_DAYS,
  MATCHER_UNMATCHED_MIN_COUNT,
  MATCHER_RETENTION_MAX,
  MATCHER_RETENTION_MIN,
  MATCHER_THRESHOLD_MAX,
  MATCHER_THRESHOLD_MIN,
  clearRecommendCache,
  invalidateMatcherTopicCache,
  parseMatcherSettings,
  purgeOldMatcherStats,
  readTelehealthSettingsRaw,
  readTopicTranslations,
  scoreSpecialties,
  searchTopics,
  topicTextFor,
} from "./matcher.service";

/**
 * Paket W — admin: "Eşleştirme kataloğu" (konu, dil sekmeleri, eş anlamlılar, uzmanlık ağırlıkları,
 * kırmızı bayrak, aktif/pasif, canlı önizleme), raporlar ve ayarlar. Okuma ADMIN/MANAGER, yazma ADMIN.
 * Lead detayındaki sihirbaz cevapları kartı YALNIZCA CRM yetkisiyle (ADMIN + 2FA) ve audit'le.
 */

const TopicTextSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  synonyms: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
});

const TopicBodySchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Geçersiz slug.").max(80),
    bodyArea: z.enum(BODY_AREAS),
    translations: z
      .record(z.string().regex(LOCALE_CODE_PATTERN), TopicTextSchema)
      .refine((t) => !!t.en, "EN (kanonik) metin zorunlu.")
      .refine((t) => Object.keys(t).length <= 20, "En çok 20 dil."),
    isRedFlag: z.boolean().default(false),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100000).default(0),
    /** Paket W-ek — bizde karşılığı olmayan doğal uzmanlık (hasta görmez). */
    targetSpecialtyHint: z.string().trim().max(120).nullish().transform((v) => (v ? v : null)),
    weights: z
      .array(z.object({ specialtyId: z.string().uuid(), weight: z.number().int().min(1).max(100) }))
      .max(20)
      .default([])
      .refine((w) => new Set(w.map((x) => x.specialtyId)).size === w.length, "Aynı uzmanlık iki kez eklenemez."),
  })
  .strict()
  .refine((b) => !b.isRedFlag || b.weights.length === 0, { message: "Kırmızı bayrak konuları uzmanlığa eşlenmez.", path: ["weights"] });

const SettingsSchema = z
  .object({
    contactRequired: z.boolean(),
    retentionDays: z.number().int().min(MATCHER_RETENTION_MIN).max(MATCHER_RETENTION_MAX),
    scoreThreshold: z.number().int().min(MATCHER_THRESHOLD_MIN).max(MATCHER_THRESHOLD_MAX),
    maxSpecialties: z.number().int().min(1).max(MATCHER_MAX_SPECIALTIES_LIMIT),
  })
  .strict();

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function topicDto(app: FastifyInstance, id: string) {
  const row = await app.prisma.careTopic.findUnique({
    where: { id },
    include: { specialties: { include: { specialty: { select: { id: true, slug: true, name: true } } }, orderBy: { weight: "desc" } } },
  });
  if (!row) throw new NotFoundError("Konu bulunamadı.");
  return toTopicDto(row);
}

function toTopicDto(row: {
  id: string;
  slug: string;
  bodyArea: string;
  translations: unknown;
  isRedFlag: boolean;
  isActive: boolean;
  sortOrder: number;
  targetSpecialtyHint: string | null;
  updatedAt: Date;
  specialties: { weight: number; specialty: { id: string; slug: string; name: string } }[];
}) {
  return {
    id: row.id,
    slug: row.slug,
    bodyArea: row.bodyArea,
    translations: readTopicTranslations(row.translations),
    isRedFlag: row.isRedFlag,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    targetSpecialtyHint: row.targetSpecialtyHint,
    updatedAt: row.updatedAt.toISOString(),
    weights: row.specialties.map((s) => ({ specialtyId: s.specialty.id, specialtySlug: s.specialty.slug, specialtyName: s.specialty.name, weight: s.weight })),
  };
}

export async function matcherAdminRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get("/topics", { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER) }, async (_request, reply) => {
    const rows = await app.prisma.careTopic.findMany({
      orderBy: [{ bodyArea: "asc" }, { sortOrder: "asc" }, { slug: "asc" }],
      include: { specialties: { include: { specialty: { select: { id: true, slug: true, name: true } } }, orderBy: { weight: "desc" } } },
    });
    return reply.send(ok(rows.map(toTopicDto)));
  });

  async function writeTopic(id: string | null, body: z.infer<typeof TopicBodySchema>) {
    const clash = await app.prisma.careTopic.findUnique({ where: { slug: body.slug }, select: { id: true } });
    if (clash && clash.id !== id) throw new ConflictError("Bu slug başka bir konuda kullanılıyor.");
    if (body.weights.length > 0) {
      const found = await app.prisma.specialty.count({ where: { id: { in: body.weights.map((w) => w.specialtyId) } } });
      if (found !== body.weights.length) throw new ValidationError("Uzmanlık bulunamadı.", { weights: ["Bilinmeyen uzmanlık."] });
    }
    const data = {
      slug: body.slug,
      bodyArea: body.bodyArea,
      translations: body.translations,
      isRedFlag: body.isRedFlag,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
      targetSpecialtyHint: body.targetSpecialtyHint ?? null,
    };
    const saved = await app.prisma.$transaction(async (tx) => {
      const topic = id ? await tx.careTopic.update({ where: { id }, data }) : await tx.careTopic.create({ data });
      await tx.careTopicSpecialty.deleteMany({ where: { topicId: topic.id } });
      if (body.weights.length > 0) await tx.careTopicSpecialty.createMany({ data: body.weights.map((w) => ({ topicId: topic.id, specialtyId: w.specialtyId, weight: w.weight })) });
      return topic;
    });
    invalidateMatcherTopicCache();
    return saved;
  }

  server.post("/topics", { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: TopicBodySchema } }, async (request, reply) => {
    const saved = await writeTopic(null, request.body);
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "matcher.topic_created", targetType: "CareTopic", targetId: saved.id, metadata: { slug: saved.slug }, ipAddress: request.ip });
    return reply.status(201).send(ok(await topicDto(app, saved.id)));
  });

  server.put(
    "/topics/:id",
    { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { params: z.object({ id: z.string().uuid() }), body: TopicBodySchema } },
    async (request, reply) => {
      if (!(await app.prisma.careTopic.findUnique({ where: { id: request.params.id }, select: { id: true } }))) throw new NotFoundError("Konu bulunamadı.");
      const saved = await writeTopic(request.params.id, request.body);
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "matcher.topic_updated", targetType: "CareTopic", targetId: saved.id, metadata: { slug: saved.slug }, ipAddress: request.ip });
      return reply.send(ok(await topicDto(app, saved.id)));
    }
  );

  server.delete(
    "/topics/:id",
    { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.undefined() } } },
    async (request, reply) => {
      const row = await app.prisma.careTopic.findUnique({ where: { id: request.params.id }, select: { id: true, slug: true } });
      if (!row) throw new NotFoundError("Konu bulunamadı.");
      await app.prisma.careTopic.delete({ where: { id: row.id } });
      invalidateMatcherTopicCache();
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "matcher.topic_deleted", targetType: "CareTopic", targetId: row.id, metadata: { slug: row.slug }, ipAddress: request.ip });
      return reply.code(204).send();
    }
  );

  /** Canlı önizleme: "Bu terimi yazınca şu konular ve şu uzmanlıklar çıkar" (hekimi olmayanlar işaretli). */
  server.get(
    "/preview",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { querystring: z.object({ q: z.string().trim().min(1).max(80), lang: z.string().regex(LOCALE_CODE_PATTERN).default("tr") }) } },
    async (request, reply) => {
      // Paket W-ek — sihirbazdaki aramayla aynı motor (9 dil, yazım hatası toleranslı).
      const hits = await searchTopics(app, request.query.q, request.query.lang);
      const rows = await app.prisma.careTopic.findMany({ where: { id: { in: hits.map((h) => h.id) } }, include: { specialties: { select: { specialtyId: true, weight: true } } } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const matches = hits.filter((h) => byId.has(h.id)).map((h) => ({ hit: h, row: byId.get(h.id)! }));
      const top = matches.slice(0, 1);
      const scores = scoreSpecialties(top.map((m) => ({ weights: m.row.specialties })));
      const specialtyRows = await app.prisma.specialty.findMany({ where: { id: { in: [...scores.keys()] } }, select: { id: true, slug: true, name: true, isActive: true } });
      const staffed = await app.prisma.doctorProfile.findMany({
        where: { ...PUBLIC_DOCTOR_WHERE, OR: [{ specialtyId: { in: [...scores.keys()] } }, { additionalSpecialties: { some: { specialtyId: { in: [...scores.keys()] } } } }] },
        select: { specialtyId: true, additionalSpecialties: { select: { specialtyId: true } } },
      });
      const staffedIds = new Set(staffed.flatMap((d) => [d.specialtyId, ...d.additionalSpecialties.map((a) => a.specialtyId)]).filter(Boolean));
      const { scoreThreshold } = parseMatcherSettings(await readTelehealthSettingsRaw(app));
      return reply.send(
        ok({
          topics: matches.map((m) => ({ id: m.row.id, slug: m.row.slug, label: m.hit.label, isRedFlag: m.row.isRedFlag, score: m.hit.score })),
          specialties: specialtyRows
            .map((s) => ({ ...s, score: scores.get(s.id) ?? 0, hasDoctors: staffedIds.has(s.id), passesThreshold: (scores.get(s.id) ?? 0) >= scoreThreshold }))
            .sort((a, b) => b.score - a.score),
        })
      );
    }
  );

  /** Raporlar: en çok seçilen konular, eşleşmeyen serbest metin terimleri (yalnızca sıklık ≥ 3), adım bazında erişim/terk. */
  server.get(
    "/report",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { querystring: z.object({ from: dateParam, to: dateParam }) } },
    async (request, reply) => {
      const from = new Date(`${request.query.from}T00:00:00Z`);
      const to = new Date(`${request.query.to}T00:00:00Z`);
      if (!(from <= to)) throw new ValidationError("Geçersiz tarih aralığı.", { from: ["Başlangıç bitişten önce olmalı."] });
      const grouped = await app.prisma.matcherStat.groupBy({ by: ["kind", "key"], where: { day: { gte: from, lte: to } }, _sum: { count: true } });
      const of = (kind: string) => grouped.filter((g) => g.kind === kind).map((g) => ({ key: g.key, count: g._sum.count ?? 0 }));
      const topicLabels = new Map(
        (await app.prisma.careTopic.findMany({ select: { slug: true, translations: true } })).map((t) => [t.slug, topicTextFor(readTopicTranslations(t.translations), "tr").label])
      );
      const steps = ["1", "2", "3", "4", "5"].map((step) => ({ step, reached: of("step").find((s) => s.key === step)?.count ?? 0 }));
      const funnel = steps.map((s, i) => {
        const next = steps[i + 1];
        return { ...s, dropOffRate: next && s.reached > 0 ? Math.max(0, Math.round(((s.reached - next.reached) / s.reached) * 1000) / 10) : null };
      });
      return reply.send(
        ok({
          topTopics: of("topic")
            .sort((a, b) => b.count - a.count)
            .slice(0, 20)
            .map((t) => ({ ...t, label: topicLabels.get(t.key) ?? t.key })),
          // Kişi adı gibi tekil terimler görünmesin diye yalnızca en az 3 kez geçenler.
          unmatchedTerms: of("unmatched_term")
            .filter((t) => t.count >= MATCHER_UNMATCHED_MIN_COUNT)
            .sort((a, b) => b.count - a.count)
            .slice(0, 30),
          // 30 günden sonra silinen seyrek terimlerin adedi (metin yok).
          unmatchedRareCount: of("unmatched_term_rare").reduce((sum, t) => sum + t.count, 0),
          funnel,
          redFlags: of("red_flag"),
          // Gönderim sonucu: "stored" (iletişim izni var → talep kaydedildi) / "not_stored" (izin yok → yalnızca sayaç).
          submissions: of("submit"),
        })
      );
    }
  );

  /**
   * Paket W-ek — "Talep var, hekim yok": son N günde seçilen/aramadan seçilen ama koordinatöre giden
   * (hekimi olan bir uzmanlığa bağlı olmayan) konular, `targetSpecialtyHint`'e göre gruplu. Hangi branşta
   * hekim alınacağına karar vermek için.
   */
  server.get(
    "/demand-report",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { querystring: z.object({ days: z.coerce.number().int().min(1).max(MATCHER_POPULARITY_DAYS).default(MATCHER_POPULARITY_DAYS) }) } },
    async (request, reply) => {
      const since = new Date(Date.now() - request.query.days * 86_400_000);
      const [grouped, topics, staffedIds] = await Promise.all([
        app.prisma.matcherStat.groupBy({ by: ["kind", "key"], where: { kind: { in: ["topic", "search_pick"] }, day: { gte: since } }, _sum: { count: true } }),
        app.prisma.careTopic.findMany({
          where: { isActive: true, isRedFlag: false },
          select: { id: true, slug: true, translations: true, targetSpecialtyHint: true, specialties: { select: { specialtyId: true, specialty: { select: { isActive: true } } } } },
        }),
        staffedSpecialtyIds(),
      ]);
      const selections = new Map<string, number>();
      const searches = new Map<string, number>();
      for (const g of grouped) (g.kind === "topic" ? selections : searches).set(g.key, g._sum.count ?? 0);
      const groups = new Map<string, { hint: string | null; requests: number; topics: { id: string; slug: string; label: string; selections: number; searchPicks: number }[] }>();
      for (const topic of topics) {
        const coordinator = !topic.specialties.some((s) => s.specialty.isActive && staffedIds.has(s.specialtyId));
        if (!coordinator) continue;
        const key = topic.targetSpecialtyHint ?? "";
        const group = groups.get(key) ?? { hint: topic.targetSpecialtyHint, requests: 0, topics: [] };
        const sel = selections.get(topic.slug) ?? 0;
        const sp = searches.get(topic.slug) ?? 0;
        group.requests += sel + sp;
        group.topics.push({ id: topic.id, slug: topic.slug, label: topicTextFor(readTopicTranslations(topic.translations), "tr").label, selections: sel, searchPicks: sp });
        groups.set(key, group);
      }
      const result = [...groups.values()]
        .map((g) => ({ ...g, topics: g.topics.sort((a, b) => b.selections + b.searchPicks - (a.selections + a.searchPicks) || a.label.localeCompare(b.label, "tr")) }))
        .sort((a, b) => b.requests - a.requests || b.topics.length - a.topics.length);
      return reply.send(ok({ days: request.query.days, groups: result }));
    }
  );

  /**
   * Paket W-ek — hekim alındığında: aynı `targetSpecialtyHint`'e sahip (kırmızı bayrak olmayan) konuları
   * tek seferde bir uzmanlığa bağla. `topicIds` verilirse yalnızca onlar (yine o ipucuna ait olmalı).
   * Var olan ağırlık güncellenir. Admin değişikliği sayılır — seed bu konuları artık güncellemez.
   */
  server.post(
    "/topics/bulk-weight",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: {
        body: z
          .object({
            hint: z.string().trim().min(1).max(120),
            specialtyId: z.string().uuid(),
            weight: z.number().int().min(1).max(100),
            topicIds: z.array(z.string().uuid()).max(500).optional(),
          })
          .strict(),
      },
    },
    async (request, reply) => {
      const { hint, specialtyId, weight, topicIds } = request.body;
      const specialty = await app.prisma.specialty.findUnique({ where: { id: specialtyId }, select: { id: true, slug: true, isActive: true } });
      if (!specialty) throw new ValidationError("Uzmanlık bulunamadı.", { specialtyId: ["Bilinmeyen uzmanlık."] });
      if (!specialty.isActive) throw new ValidationError("Pasif uzmanlığa konu bağlanamaz.", { specialtyId: ["Uzmanlık pasif."] });
      const topics = await app.prisma.careTopic.findMany({
        where: { targetSpecialtyHint: hint, isRedFlag: false, ...(topicIds ? { id: { in: topicIds } } : {}) },
        select: { id: true },
      });
      if (topicIds && topics.length !== new Set(topicIds).size) throw new ValidationError("Seçilen konuların hepsi bu ipucuna ait değil.", { topicIds: ["Geçersiz konu."] });
      await app.prisma.$transaction(
        topics.map((t) =>
          app.prisma.careTopicSpecialty.upsert({
            where: { topicId_specialtyId: { topicId: t.id, specialtyId } },
            create: { topicId: t.id, specialtyId, weight },
            update: { weight },
          })
        )
      );
      invalidateMatcherTopicCache();
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "matcher.topics_bulk_weight",
        targetType: "Specialty",
        targetId: specialty.id,
        metadata: { hint, specialty: specialty.slug, weight, count: topics.length },
        ipAddress: request.ip,
      });
      return reply.send(ok({ updated: topics.length }));
    }
  );

  async function staffedSpecialtyIds(): Promise<Set<string>> {
    const doctors = await app.prisma.doctorProfile.findMany({ where: PUBLIC_DOCTOR_WHERE, select: { specialtyId: true, additionalSpecialties: { select: { specialtyId: true } } } });
    return new Set(doctors.flatMap((d) => [d.specialtyId, ...d.additionalSpecialties.map((a) => a.specialtyId)]).filter((id): id is string => !!id));
  }

  server.get("/settings", { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER) }, async (_request, reply) => reply.send(ok(parseMatcherSettings(await readTelehealthSettingsRaw(app)))));

  server.put("/settings", { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: SettingsSchema } }, async (request, reply) => {
    const raw = await readTelehealthSettingsRaw(app);
    const before = parseMatcherSettings(raw);
    const merged = mergeTelehealthSettings(raw, {
      matcherContactRequired: request.body.contactRequired,
      matcherRetentionDays: request.body.retentionDays,
      matcherScoreThreshold: request.body.scoreThreshold,
      matcherMaxSpecialties: request.body.maxSpecialties,
    });
    const row = await app.prisma.siteModule.upsert({
      where: { key: "telehealth" },
      create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
      update: { settings: merged, updatedById: request.user!.id },
    });
    const after = parseMatcherSettings(row.settings);
    // Eşik/sayı değişince önbellekteki öneriler eskir.
    clearRecommendCache();
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "matcher.settings_updated", targetType: "SiteModule", targetId: "telehealth", metadata: { before, after }, ipAddress: request.ip });
    return reply.send(ok(after));
  });

  /** CRM lead detayı — sihirbaz cevapları (sağlık verisi). Yalnızca CRM yetkisi (ADMIN + 2FA); görüntüleme audit'e düşer. */
  server.get(
    "/leads/:leadId",
    { preHandler: requireCrmAccess(), schema: { params: z.object({ leadId: z.string().uuid() }) } },
    async (request, reply) => {
      const submission = await app.prisma.matcherSubmission.findUnique({ where: { leadId: request.params.leadId } });
      if (!submission) throw new NotFoundError("Bu talebin sihirbaz kaydı yok.");
      const [topics, specialties, doctors] = await Promise.all([
        app.prisma.careTopic.findMany({ where: { id: { in: submission.topicIds } }, select: { id: true, slug: true, translations: true, isRedFlag: true } }),
        app.prisma.specialty.findMany({ where: { id: { in: submission.recommendedSpecialtyIds } }, select: { id: true, name: true } }),
        app.prisma.doctorProfile.findMany({ where: { id: { in: submission.recommendedDoctorIds } }, select: { id: true, title: true, fullName: true, slug: true } }),
      ]);
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "crm.lead.matcher_viewed",
        targetType: "CrmLead",
        targetId: request.params.leadId,
        ipAddress: request.ip,
      });
      const byId = <T extends { id: string }>(rows: T[], ids: string[]) => ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => !!r);
      return reply.send(
        ok({
          number: submission.seq,
          createdAt: submission.createdAt.toISOString(),
          topics: byId(topics, submission.topicIds).map((t) => ({ slug: t.slug, label: topicTextFor(readTopicTranslations(t.translations), "tr").label, isRedFlag: t.isRedFlag })),
          freeText: submission.freeText,
          ageBand: submission.ageBand,
          birthYear: submission.birthYear,
          guardianName: submission.guardianName,
          guardianDeclaredAt: submission.guardianDeclaredAt?.toISOString() ?? null,
          forWhom: submission.forWhom,
          duration: submission.duration,
          priorDiagnosis: submission.priorDiagnosis,
          preference: submission.preference,
          preferredLanguage: submission.preferredLanguage,
          country: submission.country,
          timeZone: submission.timeZone,
          recommendedSpecialties: byId(specialties, submission.recommendedSpecialtyIds).map((s) => s.name),
          recommendedDoctors: byId(doctors, submission.recommendedDoctorIds).map((d) => ({ name: `${d.title} ${d.fullName}`.trim(), slug: d.slug })),
          redFlagAcknowledgedAt: submission.redFlagAcknowledgedAt?.toISOString() ?? null,
          consentHealthAt: submission.consentHealthAt?.toISOString() ?? null,
          consentContactAt: submission.consentContactAt?.toISOString() ?? null,
          callbackRequestedAt: submission.callbackRequestedAt?.toISOString() ?? null,
          anonymizedAt: submission.anonymizedAt?.toISOString() ?? null,
        })
      );
    }
  );
}

/**
 * Saklama (gece/saatlik CRM temizlik zinciri — `registerCrmRetentionStep`): `matcherRetentionDays`
 * dolan taleplerin sağlık alanları anonimleştirilir; talebin uzmanlık/hekim alanları (sağlıktan
 * türeyen) da temizlenir. Kişi/iletişim alanları CRM lead saklama kuralına (leadRetentionDays) tabidir.
 */
export async function anonymizeExpiredMatcherSubmissions(app: FastifyInstance, now = new Date()): Promise<number> {
  const settings = parseMatcherSettings(await readTelehealthSettingsRaw(app));
  const cutoff = new Date(now.getTime() - settings.retentionDays * 86_400_000);
  const expired = await app.prisma.matcherSubmission.findMany({ where: { anonymizedAt: null, createdAt: { lt: cutoff } }, select: { id: true, leadId: true }, take: 500 });
  if (expired.length === 0) return 0;
  await app.prisma.$transaction([
    app.prisma.matcherSubmission.updateMany({
      where: { id: { in: expired.map((e) => e.id) } },
      data: {
        topicIds: [],
        freeText: null,
        ageBand: null,
        birthYear: null,
        duration: null,
        priorDiagnosis: null,
        recommendedSpecialtyIds: [],
        recommendedDoctorIds: [],
        // Uyumluluk incelemesi: üçüncü kişi (veli) adı, konum ve acil uyarısı onay zamanı da silinir.
        guardianName: null,
        country: null,
        timeZone: null,
        redFlagAcknowledgedAt: null,
        accessTokenHash: null,
        anonymizedAt: now,
      },
    }),
    // Kullanıcı kararı (2026-10-30): sihirbaz lead'lerinin KİŞİ alanları da sağlık verisiyle aynı sürede
    // (matcherRetentionDays, varsayılan 365) anonimleşir; CRM'in genel 730 günlük kuralını beklemez.
    app.prisma.crmLeadNote.deleteMany({ where: { leadId: { in: expired.map((e) => e.leadId) }, lead: { channel: "MATCHER" } } }),
    app.prisma.crmLead.updateMany({
      where: { id: { in: expired.map((e) => e.leadId) }, channel: "MATCHER" },
      data: {
        specialtyId: null,
        specialtyName: null,
        doctorId: null,
        doctorName: null,
        name: null,
        phone: null,
        email: null,
        country: null,
        visitorId: null,
        refCode: null,
        gclid: null,
        bookingId: null,
        assignedToId: null,
        landingPath: null,
        anonymizedAt: now,
      },
    }),
  ]);
  await logAudit(app, { actorId: null, actorEmail: null, action: "matcher.anonymized", targetType: "MatcherSubmission", targetId: null, metadata: { count: expired.length, retentionDays: settings.retentionDays } });
  return expired.length;
}

// Tek kayıt (modül yüklenirken): CRM saatlik saklama zincirine eklenir.
registerCrmRetentionStep((app, now) => anonymizeExpiredMatcherSubmissions(app, now));
registerCrmRetentionStep((app, now) => purgeOldMatcherStats(app, now));
