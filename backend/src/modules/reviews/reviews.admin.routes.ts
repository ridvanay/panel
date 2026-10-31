import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { LOCALE_CODE_PATTERN } from "../../lib/localization";
import { doctorDisplayName } from "../../lib/doctor-display-name";
import { TESTIMONIAL_STATUSES, anonymizedTestimonialData, maskSnippet, plainText, riskFlags } from "./reviews.service";
import { CACHE_TAGS, revalidateTagsOnWrite } from "../../lib/revalidate";

/**
 * Paket Y — yorum moderasyonu (ADMIN/MANAGER). Admin metni DÜZENLEYEMEZ: başlık/metin yalnızca
 * maskelenebilir (karartma), her maskeleme audit'e yazılır (içerik değil, uzunluk/adet). Onay, red,
 * gizleme, kaldırma (anonimleştirme), öne çıkarma ve hekim yanıtı da audit'lidir.
 * Manuel/içe aktarılan yorumda onay kanıtı notu zorunlu; "Verified patient" rozeti verilmez.
 */
const localeCode = z.string().regex(LOCALE_CODE_PATTERN);

const ManualTestimonialSchema = z
  .object({
    doctorId: z.string().uuid().nullish(),
    specialtyId: z.string().uuid().nullish(),
    authorDisplay: plainText(1, 80),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish(),
    language: localeCode,
    rating: z.number().int().min(1).max(5),
    title: plainText(3, 120),
    body: plainText(30, 1500),
    source: z.enum(["manual_with_consent", "imported"]),
    consentEvidenceNote: plainText(10, 1000),
    consentAt: z.string().datetime().optional(),
  })
  .strict();

const TranslationsSchema = z.record(localeCode, z.object({ title: plainText(0, 120).default(""), body: plainText(1, 3000) }).strict()).refine((t) => Object.keys(t).length <= 20);

const UpdateSchema = z
  .object({
    translations: TranslationsSchema.optional(),
    featuredOnHome: z.boolean().optional(),
    doctorReply: plainText(0, 1500).nullable().optional(),
  })
  .strict();

function adminDto(row: Prisma.TestimonialGetPayload<{ include: { doctor: { select: { title: true; fullName: true; publicName: true; isFounder: true } } } }>) {
  return {
    id: row.id,
    doctorId: row.doctorId,
    doctorName: row.doctor ? `${row.doctor.title} ${doctorDisplayName(row.doctor)}`.trim() : null,
    specialtyId: row.specialtyId,
    bookingId: row.bookingId,
    authorDisplay: row.authorDisplay,
    displayMode: row.displayMode,
    country: row.country,
    language: row.language,
    rating: row.rating,
    title: row.title,
    body: row.body,
    translations: row.translations,
    source: row.source,
    verified: row.source === "verified_booking",
    consentAt: row.consentAt.toISOString(),
    consentEvidenceNote: row.consentEvidenceNote,
    consentTextVersion: row.consentTextVersion,
    /** Moderatöre uyarı (içerik değişmez): metinde e-posta/telefon/bağlantı görülüyor. */
    riskFlags: riskFlags(`${row.title}\n${row.body}`),
    status: row.status,
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
    redactionCount: row.redactionCount,
    featuredOnHome: row.featuredOnHome,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    doctorReply: row.doctorReply,
    anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const INCLUDE = { doctor: { select: { title: true, fullName: true, publicName: true, isFounder: true } } } as const;

export async function reviewsAdminRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  // Yayın durumu değişince hekim sayfaları (yorumlar) yenilensin.
  revalidateTagsOnWrite(app, () => [CACHE_TAGS.doctors]);
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  async function load(id: string) {
    const row = await app.prisma.testimonial.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundError("Yorum bulunamadı.");
    return row;
  }

  server.get(
    "/",
    {
      schema: {
        querystring: z.object({
          status: z.enum(TESTIMONIAL_STATUSES).optional(),
          doctorId: z.string().uuid().optional(),
          page: z.coerce.number().int().min(1).max(1000).default(1),
        }),
      },
    },
    async (request, reply) => {
      const { status, doctorId, page } = request.query;
      const where: Prisma.TestimonialWhereInput = { ...(status ? { status } : {}), ...(doctorId ? { doctorId } : {}) };
      const [total, rows, counts] = await Promise.all([
        app.prisma.testimonial.count({ where }),
        app.prisma.testimonial.findMany({ where, include: INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
        app.prisma.testimonial.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);
      return reply.send(ok({ total, page, pageSize: 25, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), items: rows.map(adminDto) }));
    }
  );

  /** Manuel ekleme: onay kanıtı notu zorunlu; `pending` başlar; doğrulanmış rozet yok. */
  server.post("/", { schema: { body: ManualTestimonialSchema } }, async (request, reply) => {
    const b = request.body;
    if (b.doctorId && !(await app.prisma.doctorProfile.findUnique({ where: { id: b.doctorId }, select: { id: true } }))) throw new ValidationError("Hekim bulunamadı.", { doctorId: ["Bilinmeyen hekim."] });
    const row = await app.prisma.testimonial.create({
      data: {
        doctorId: b.doctorId ?? null,
        specialtyId: b.specialtyId ?? null,
        authorDisplay: b.authorDisplay,
        displayMode: "custom",
        country: b.country ?? null,
        language: b.language,
        rating: b.rating,
        title: b.title,
        body: b.body,
        source: b.source,
        consentAt: b.consentAt ? new Date(b.consentAt) : new Date(),
        consentEvidenceNote: b.consentEvidenceNote,
        status: "pending",
      },
      include: INCLUDE,
    });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "testimonial.created_manual", targetType: "Testimonial", targetId: row.id, metadata: { source: b.source }, ipAddress: request.ip });
    return reply.status(201).send(ok(adminDto(row)));
  });

  /** Onay / red / gizleme. Anonimleştirilmiş yorum yeniden yayınlanamaz. */
  server.post(
    "/:id/status",
    { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(["approved", "rejected", "hidden"]) }).strict() } },
    async (request, reply) => {
      const row = await load(request.params.id);
      const status = request.body.status;
      if (row.anonymizedAt && status === "approved") throw new ConflictError("Kaldırılmış yorum yayınlanamaz.");
      const now = new Date();
      const updated = await app.prisma.testimonial.update({
        where: { id: row.id },
        data: {
          status,
          moderatedById: request.user!.id,
          moderatedAt: now,
          ...(status === "approved" && !row.publishedAt ? { publishedAt: now } : {}),
          ...(status !== "approved" ? { featuredOnHome: false } : {}),
        },
        include: INCLUDE,
      });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: `testimonial.${status}`, targetType: "Testimonial", targetId: row.id, metadata: { from: row.status, to: status }, ipAddress: request.ip });
      return reply.send(ok(adminDto(updated)));
    }
  );

  /** Maskeleme (karartma): yalnızca verilen parça "█" olur; metin başka şekilde değişmez. */
  server.post(
    "/:id/redact",
    { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ field: z.enum(["title", "body"]), snippet: z.string().min(2).max(300) }).strict() } },
    async (request, reply) => {
      const row = await load(request.params.id);
      const { field, snippet } = request.body;
      const result = maskSnippet(row[field], snippet);
      if (result.occurrences === 0) throw new ValidationError("Maskelenecek ifade metinde bulunamadı.", { snippet: ["Metinde yok."] });
      // Aynı parça yönetici çevirilerinde de maskelenir (çeviri yoluyla sızmasın).
      const translations = (row.translations ?? {}) as Record<string, { title?: string; body?: string }>;
      let translationHits = 0;
      const maskedTranslations = Object.fromEntries(
        Object.entries(translations).map(([lang, t]) => {
          const value = t[field];
          if (typeof value !== "string") return [lang, t];
          const r = maskSnippet(value, snippet);
          translationHits += r.occurrences;
          return [lang, { ...t, [field]: r.text }];
        })
      );
      // Eşzamanlı iki maskelemede biri diğerini ezmesin: metin okunduğu gibiyse yaz.
      const written = await app.prisma.testimonial.updateMany({
        where: { id: row.id, [field]: row[field] },
        data: { [field]: result.text, redactionCount: { increment: result.occurrences + translationHits }, ...(translationHits ? { translations: maskedTranslations } : {}) },
      });
      if (written.count === 0) throw new ConflictError("Yorum bu sırada değişti; yeniden deneyin.");
      const updated = await load(row.id);
      // İçerik yazılmaz (kişisel/sağlık verisi olabilir): yalnızca alan, uzunluk ve adet.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "testimonial.redacted",
        targetType: "Testimonial",
        targetId: row.id,
        metadata: { field, maskedLength: snippet.length, occurrences: result.occurrences, ...(translationHits ? { translationOccurrences: translationHits } : {}) },
        ipAddress: request.ip,
      });
      return reply.send(ok(adminDto(updated)));
    }
  );

  /** Yalnızca yönetici çevirisi, öne çıkarma ve hekim yanıtı değişir — başlık/metin DEĞİŞMEZ. */
  server.patch("/:id", { schema: { params: z.object({ id: z.string().uuid() }), body: UpdateSchema } }, async (request, reply) => {
    const row = await load(request.params.id);
    const b = request.body;
    if (row.anonymizedAt) throw new ConflictError("Kaldırılmış yorum düzenlenemez.");
    if (b.featuredOnHome && row.status !== "approved") throw new ValidationError("Yalnızca onaylı yorum anasayfada öne çıkarılabilir.", { featuredOnHome: ["Önce onaylayın."] });
    const updated = await app.prisma.testimonial.update({
      where: { id: row.id },
      data: {
        ...(b.translations !== undefined ? { translations: b.translations } : {}),
        ...(b.featuredOnHome !== undefined ? { featuredOnHome: b.featuredOnHome } : {}),
        ...(b.doctorReply !== undefined ? { doctorReply: b.doctorReply || null } : {}),
      },
      include: INCLUDE,
    });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "testimonial.updated", targetType: "Testimonial", targetId: row.id, metadata: { fields: Object.keys(b), ...(b.translations ? { translationLocales: Object.keys(b.translations) } : {}) }, ipAddress: request.ip });
    return reply.send(ok(adminDto(updated)));
  });

  /** Hastanın kaldırma isteği: yorum anonimleştirilir (metin ve kimlik izleri silinir). */
  server.post("/:id/remove", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
    const row = await load(request.params.id);
    if (row.anonymizedAt) return reply.send(ok(adminDto(row)));
    const updated = await app.prisma.testimonial.update({ where: { id: row.id }, data: anonymizedTestimonialData(new Date()), include: INCLUDE });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "testimonial.removed", targetType: "Testimonial", targetId: row.id, ipAddress: request.ip });
    return reply.send(ok(adminDto(updated)));
  });
}

