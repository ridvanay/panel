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
import { foldTerm, matchScore } from "../../lib/matcher-text";
import { BODY_AREAS } from "../../lib/care-topics/catalog";
import { PUBLIC_DOCTOR_WHERE } from "../telehealth/lib/archive-filters";
import { mergeTelehealthSettings } from "../telehealth/lib/emergency-notice";
import { requireCrmAccess } from "../crm/crm.access";
import { registerCrmRetentionStep } from "../crm/crm.rollup";
import {
  MATCHER_RETENTION_MAX,
  MATCHER_RETENTION_MIN,
  MATCHER_SCORE_THRESHOLD,
  invalidateMatcherTopicCache,
  parseMatcherSettings,
  purgeOldMatcherStats,
  readTelehealthSettingsRaw,
  readTopicTranslations,
  scoreSpecialties,
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
    weights: z
      .array(z.object({ specialtyId: z.string().uuid(), weight: z.number().int().min(1).max(100) }))
      .max(20)
      .default([])
      .refine((w) => new Set(w.map((x) => x.specialtyId)).size === w.length, "Aynı uzmanlık iki kez eklenemez."),
  })
  .strict()
  .refine((b) => !b.isRedFlag || b.weights.length === 0, { message: "Kırmızı bayrak konuları uzmanlığa eşlenmez.", path: ["weights"] });

const SettingsSchema = z.object({ contactRequired: z.boolean(), retentionDays: z.number().int().min(MATCHER_RETENTION_MIN).max(MATCHER_RETENTION_MAX) }).strict();

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
    const data = { slug: body.slug, bodyArea: body.bodyArea, translations: body.translations, isRedFlag: body.isRedFlag, isActive: body.isActive, sortOrder: body.sortOrder };
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
      const q = foldTerm(request.query.q);
      const rows = await app.prisma.careTopic.findMany({ where: { isActive: true }, include: { specialties: { select: { specialtyId: true, weight: true } } } });
      const matches = rows
        .map((row) => {
          const translations = readTopicTranslations(row.translations);
          const own = translations[request.query.lang];
          const en = translations.en;
          const terms = [own, en].filter(Boolean).flatMap((t) => [t!.label, ...t!.synonyms]);
          const score = Math.max(0, ...terms.map((term) => matchScore(q, foldTerm(term))));
          return { row, translations, score };
        })
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      const top = matches.slice(0, 1);
      const scores = scoreSpecialties(top.map((m) => ({ weights: m.row.specialties })));
      const specialtyRows = await app.prisma.specialty.findMany({ where: { id: { in: [...scores.keys()] } }, select: { id: true, slug: true, name: true, isActive: true } });
      const staffed = await app.prisma.doctorProfile.findMany({
        where: { ...PUBLIC_DOCTOR_WHERE, OR: [{ specialtyId: { in: [...scores.keys()] } }, { additionalSpecialties: { some: { specialtyId: { in: [...scores.keys()] } } } }] },
        select: { specialtyId: true, additionalSpecialties: { select: { specialtyId: true } } },
      });
      const staffedIds = new Set(staffed.flatMap((d) => [d.specialtyId, ...d.additionalSpecialties.map((a) => a.specialtyId)]).filter(Boolean));
      return reply.send(
        ok({
          topics: matches.map((m) => ({ id: m.row.id, slug: m.row.slug, label: topicTextFor(m.translations, request.query.lang).label, isRedFlag: m.row.isRedFlag, score: m.score })),
          specialties: specialtyRows
            .map((s) => ({ ...s, score: scores.get(s.id) ?? 0, hasDoctors: staffedIds.has(s.id), passesThreshold: (scores.get(s.id) ?? 0) >= MATCHER_SCORE_THRESHOLD }))
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
            .filter((t) => t.count >= 3)
            .sort((a, b) => b.count - a.count)
            .slice(0, 30),
          funnel,
          redFlags: of("red_flag"),
        })
      );
    }
  );

  server.get("/settings", { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER) }, async (_request, reply) => reply.send(ok(parseMatcherSettings(await readTelehealthSettingsRaw(app)))));

  server.put("/settings", { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: SettingsSchema } }, async (request, reply) => {
    const raw = await readTelehealthSettingsRaw(app);
    const before = parseMatcherSettings(raw);
    const merged = mergeTelehealthSettings(raw, { matcherContactRequired: request.body.contactRequired, matcherRetentionDays: request.body.retentionDays });
    const row = await app.prisma.siteModule.upsert({
      where: { key: "telehealth" },
      create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
      update: { settings: merged, updatedById: request.user!.id },
    });
    const after = parseMatcherSettings(row.settings);
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
    app.prisma.crmLead.updateMany({
      where: { id: { in: expired.map((e) => e.leadId) }, channel: "MATCHER" },
      data: { specialtyId: null, specialtyName: null, doctorId: null, doctorName: null },
    }),
  ]);
  await logAudit(app, { actorId: null, actorEmail: null, action: "matcher.anonymized", targetType: "MatcherSubmission", targetId: null, metadata: { count: expired.length, retentionDays: settings.retentionDays } });
  return expired.length;
}

// Tek kayıt (modül yüklenirken): CRM saatlik saklama zincirine eklenir.
registerCrmRetentionStep((app, now) => anonymizeExpiredMatcherSubmissions(app, now));
registerCrmRetentionStep((app, now) => purgeOldMatcherStats(app, now));
