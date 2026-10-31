import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { getLocaleSet } from "../../lib/localization";
import { resolveContentLocaleCode } from "../../lib/entity-translations";
import { CACHE_TAGS, revalidateTagsOnWrite, triggerTagRevalidation } from "../../lib/revalidate";
import { absolutizeMediaUrl } from "../../mappers";
import { PUBLIC_DOCTOR_WHERE } from "./lib/archive-filters";
import { importVideoThumbnail } from "../../lib/video-thumbnail";
import { mergeTelehealthSettings } from "./lib/emergency-notice";
import {
  DoctorMediaBodySchema,
  DoctorMediaSettingsUpdateSchema,
  GALLERY_IMAGE_MIME_TYPES,
  type DoctorMediaSettings,
  ProcedureBodySchema,
  parseDoctorMediaSettings,
  requiresPatientConsent,
  toPublicMediaDto,
  toPublicProcedureDto,
} from "./lib/doctor-showcase";

/**
 * Paket Y — hekim "vitrini": işlemler + foto/video galerisi.
 * Herkese açık: `GET /doctors/:slug/showcase` (yalnızca yayınlanmış; hasta içeriği onaysızsa ve
 * before-after ayarı kapalıyken HİÇ dönmez — kontrol sunucuda, ikinci kez de okuma anında).
 * Admin: `/admin/telehealth/doctors/:doctorId/procedures|media` ve `/admin/telehealth/settings/doctor-media`.
 */
export async function telehealthShowcasePublicRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));

  server.get(
    "/doctors/:slug/showcase",
    { schema: { params: z.object({ slug: z.string().min(1).max(80) }), querystring: z.object({ locale: z.string().max(12).optional() }) } },
    async (request, reply) => {
      const doctor = await app.prisma.doctorProfile.findFirst({ where: { slug: request.params.slug, ...PUBLIC_DOCTOR_WHERE }, select: { id: true } });
      if (!doctor) throw new NotFoundError("Doktor bulunamadı.");
      const { locale } = request.query;
      const contentLocale = locale ? (resolveContentLocaleCode(await getLocaleSet(app), locale) ?? locale) : undefined;
      const settingsRow = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
      const { beforeAfterEnabled } = parseDoctorMediaSettings(settingsRow?.settings);
      const [procedures, media] = await Promise.all([
        app.prisma.doctorProcedure.findMany({ where: { doctorId: doctor.id, isPublished: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
        app.prisma.doctorMedia.findMany({
          where: {
            doctorId: doctor.id,
            isPublished: true,
            ...(beforeAfterEnabled ? {} : { category: { not: "before-after" } }),
          },
          include: MEDIA_INCLUDE,
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        }),
      ]);
      return reply.send(
        ok({
          procedures: procedures.map((p) => toPublicProcedureDto(p, contentLocale)).filter((p) => p !== null),
          media: media
            // Savunma: onaysız hasta içeriği yazma kuralına rağmen yayında kalmışsa da gösterilmez.
            .filter((m) => !requiresPatientConsent(m) || m.patientConsentConfirmed)
            .map((m) => toPublicMediaDto(m, contentLocale))
            .filter((m) => m !== null),
        })
      );
    }
  );
}

const MEDIA_INCLUDE = { media: true, thumbnailMedia: true, captionsMedia: true } as const;

function adminProcedureDto(row: Prisma.DoctorProcedureGetPayload<object>) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function adminMediaDto(row: Prisma.DoctorMediaGetPayload<{ include: typeof MEDIA_INCLUDE }>) {
  const { media, thumbnailMedia, captionsMedia, ...rest } = row;
  const isUpload = row.videoProvider === "upload" && media;
  return {
    ...rest,
    media: media ? { id: media.id, url: absolutizeMediaUrl(media.url), width: media.width, height: media.height, filename: media.filename, mimeType: media.mimeType } : null,
    thumbnailUrl: thumbnailMedia ? absolutizeMediaUrl(thumbnailMedia.url) : null,
    captionsUrl: captionsMedia ? absolutizeMediaUrl(captionsMedia.url) : null,
    video: isUpload ? { codec: media.videoCodec, faststart: media.videoFaststart, durationSec: media.durationSec } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function adminTelehealthShowcaseRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  revalidateTagsOnWrite(app, () => [CACHE_TAGS.doctors]);
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  const DoctorParams = z.object({ doctorId: z.string().uuid() });
  const ItemParams = z.object({ doctorId: z.string().uuid(), id: z.string().uuid() });

  async function assertDoctor(doctorId: string) {
    if (!(await app.prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true } }))) throw new NotFoundError("Doktor bulunamadı.");
  }

  async function assertCareTopics(ids: string[]) {
    if (ids.length === 0) return;
    const found = await app.prisma.careTopic.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new ValidationError("Bilinmeyen eşleştirme konusu.", { relatedCareTopicIds: ["Konu bulunamadı."] });
  }

  async function assertPhoto(mediaId: string | null | undefined) {
    if (!mediaId) return;
    const media = await app.prisma.media.findUnique({ where: { id: mediaId }, select: { mimeType: true } });
    if (!media) throw new ValidationError("Medya bulunamadı.", { mediaId: ["Bilinmeyen medya."] });
    if (!GALLERY_IMAGE_MIME_TYPES.has(media.mimeType)) throw new ValidationError("Galeri için yalnızca JPEG, PNG, WebP, AVIF ya da GIF görsel seçilebilir.", { mediaId: ["Desteklenmeyen tür."] });
  }

  /** Paket AE — yüklenen video: MP4 olmalı; poster görsel, altyazı WebVTT olmalı. */
  async function assertUploadedVideo(body: z.infer<typeof DoctorMediaBodySchema>) {
    if (body.kind !== "video" || body.videoProvider !== "upload") return;
    const ids = [body.mediaId, body.posterMediaId, body.captionsMediaId].filter((id): id is string => Boolean(id));
    const rows = new Map((await app.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true, mimeType: true } })).map((m) => [m.id, m.mimeType]));
    if (rows.get(body.mediaId!) !== "video/mp4") throw new ValidationError("Yüklenen MP4 video bulunamadı.", { mediaId: ["MP4 video seçin."] });
    if (body.posterMediaId && !GALLERY_IMAGE_MIME_TYPES.has(rows.get(body.posterMediaId) ?? "")) throw new ValidationError("Poster bir görsel olmalı.", { posterMediaId: ["Desteklenmeyen tür."] });
    if (body.captionsMediaId && rows.get(body.captionsMediaId) !== "text/vtt") throw new ValidationError("Altyazı WebVTT (.vtt) olmalı.", { captionsMediaId: ["Desteklenmeyen tür."] });
  }

  // --- işlemler ------------------------------------------------------------------------------
  server.get("/:doctorId/procedures", { schema: { params: DoctorParams } }, async (request, reply) => {
    await assertDoctor(request.params.doctorId);
    const rows = await app.prisma.doctorProcedure.findMany({ where: { doctorId: request.params.doctorId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return reply.send(ok(rows.map(adminProcedureDto)));
  });

  server.post("/:doctorId/procedures", { schema: { params: DoctorParams, body: ProcedureBodySchema } }, async (request, reply) => {
    await assertDoctor(request.params.doctorId);
    await assertCareTopics(request.body.relatedCareTopicIds);
    const row = await app.prisma.doctorProcedure.create({ data: { ...request.body, translations: request.body.translations as Prisma.InputJsonValue, doctorId: request.params.doctorId } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "doctor.procedure_created", targetType: "DoctorProcedure", targetId: row.id, ipAddress: request.ip });
    return reply.status(201).send(ok(adminProcedureDto(row)));
  });

  server.put("/:doctorId/procedures/:id", { schema: { params: ItemParams, body: ProcedureBodySchema } }, async (request, reply) => {
    const existing = await app.prisma.doctorProcedure.findFirst({ where: { id: request.params.id, doctorId: request.params.doctorId } });
    if (!existing) throw new NotFoundError("İşlem bulunamadı.");
    await assertCareTopics(request.body.relatedCareTopicIds);
    const row = await app.prisma.doctorProcedure.update({ where: { id: existing.id }, data: { ...request.body, translations: request.body.translations as Prisma.InputJsonValue } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "doctor.procedure_updated", targetType: "DoctorProcedure", targetId: row.id, ipAddress: request.ip });
    return reply.send(ok(adminProcedureDto(row)));
  });

  server.delete("/:doctorId/procedures/:id", { schema: { params: ItemParams, response: { 204: z.undefined() } } }, async (request, reply) => {
    const existing = await app.prisma.doctorProcedure.findFirst({ where: { id: request.params.id, doctorId: request.params.doctorId }, select: { id: true } });
    if (!existing) throw new NotFoundError("İşlem bulunamadı.");
    await app.prisma.doctorProcedure.delete({ where: { id: existing.id } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "doctor.procedure_deleted", targetType: "DoctorProcedure", targetId: existing.id, ipAddress: request.ip });
    return reply.code(204).send();
  });

  // --- medya ---------------------------------------------------------------------------------
  server.get("/:doctorId/media", { schema: { params: DoctorParams } }, async (request, reply) => {
    await assertDoctor(request.params.doctorId);
    const rows = await app.prisma.doctorMedia.findMany({ where: { doctorId: request.params.doctorId }, include: MEDIA_INCLUDE, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return reply.send(ok(rows.map(adminMediaDto)));
  });

  function mediaData(body: z.infer<typeof DoctorMediaBodySchema>) {
    const photo = body.kind === "photo";
    const upload = !photo && body.videoProvider === "upload";
    return {
      kind: body.kind,
      mediaId: photo || upload ? (body.mediaId ?? null) : null,
      videoProvider: photo ? null : (body.videoProvider ?? null),
      videoId: photo || upload ? null : (body.videoId ?? null),
      captionsMediaId: upload ? (body.captionsMediaId ?? null) : null,
      captionsLang: upload && body.captionsMediaId ? (body.captionsLang ?? null) : null,
      category: body.category,
      translations: body.translations as Prisma.InputJsonValue,
      showsPatient: body.showsPatient,
      patientConsentConfirmed: body.patientConsentConfirmed,
      consentNote: body.consentNote?.trim() || null,
      isPublished: body.isPublished,
      sortOrder: body.sortOrder,
    };
  }

  /** Video küçük resmi: yeni video ya da kimlik/sağlayıcı değiştiyse (ya da önceki indirme başarısızsa) bir kez indirilir. */
  async function thumbnailFor(body: z.infer<typeof DoctorMediaBodySchema>, existing?: { videoProvider: string | null; videoId: string | null; thumbnailMediaId: string | null }) {
    if (body.kind === "video" && body.videoProvider === "upload") return { thumbnailMediaId: body.posterMediaId ?? null };
    if (body.kind !== "video" || !body.videoProvider || !body.videoId) return { thumbnailMediaId: null };
    if (existing && existing.videoProvider === body.videoProvider && existing.videoId === body.videoId && existing.thumbnailMediaId) return {};
    return { thumbnailMediaId: await importVideoThumbnail(app, body.videoProvider, body.videoId) };
  }

  async function auditMedia(request: { user?: { id: string; email: string } | null; ip: string }, action: string, row: { id: string; category: string; isPublished: boolean; patientConsentConfirmed: boolean }) {
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action,
      targetType: "DoctorMedia",
      targetId: row.id,
      metadata: { category: row.category, isPublished: row.isPublished, patientConsentConfirmed: row.patientConsentConfirmed },
      ipAddress: request.ip,
    });
  }

  server.post("/:doctorId/media", { schema: { params: DoctorParams, body: DoctorMediaBodySchema } }, async (request, reply) => {
    await assertDoctor(request.params.doctorId);
    await assertPhoto(request.body.kind === "photo" ? request.body.mediaId : null);
    await assertUploadedVideo(request.body);
    const consent = request.body.patientConsentConfirmed ? { consentRecordedAt: new Date(), consentRecordedById: request.user!.id } : {};
    const thumb = await thumbnailFor(request.body);
    const row = await app.prisma.doctorMedia.create({ data: { ...mediaData(request.body), ...consent, ...thumb, doctorId: request.params.doctorId }, include: MEDIA_INCLUDE });
    await auditMedia(request, "doctor.media_created", row);
    return reply.status(201).send(ok(adminMediaDto(row)));
  });

  server.put("/:doctorId/media/:id", { schema: { params: ItemParams, body: DoctorMediaBodySchema } }, async (request, reply) => {
    const existing = await app.prisma.doctorMedia.findFirst({
      where: { id: request.params.id, doctorId: request.params.doctorId },
      select: { id: true, patientConsentConfirmed: true, videoProvider: true, videoId: true, thumbnailMediaId: true },
    });
    if (!existing) throw new NotFoundError("Medya öğesi bulunamadı.");
    await assertPhoto(request.body.kind === "photo" ? request.body.mediaId : null);
    await assertUploadedVideo(request.body);
    // Onay ilk kez işaretlenince kim/ne zaman yazılır; onay kaldırılınca boşalır.
    const consent = !request.body.patientConsentConfirmed
      ? { consentRecordedAt: null, consentRecordedById: null }
      : !existing.patientConsentConfirmed
        ? { consentRecordedAt: new Date(), consentRecordedById: request.user!.id }
        : {};
    const thumb = await thumbnailFor(request.body, existing);
    const row = await app.prisma.doctorMedia.update({ where: { id: existing.id }, data: { ...mediaData(request.body), ...consent, ...thumb }, include: MEDIA_INCLUDE });
    await auditMedia(request, "doctor.media_updated", row);
    return reply.send(ok(adminMediaDto(row)));
  });

  server.delete("/:doctorId/media/:id", { schema: { params: ItemParams, response: { 204: z.undefined() } } }, async (request, reply) => {
    const existing = await app.prisma.doctorMedia.findFirst({ where: { id: request.params.id, doctorId: request.params.doctorId }, select: { id: true } });
    if (!existing) throw new NotFoundError("Medya öğesi bulunamadı.");
    await app.prisma.doctorMedia.delete({ where: { id: existing.id } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "doctor.media_deleted", targetType: "DoctorMedia", targetId: existing.id, ipAddress: request.ip });
    return reply.code(204).send();
  });
}

/** `/admin/telehealth/settings/doctor-media` — önce/sonra kategorisi (varsayılan kapalı; yalnızca ADMIN). */
export async function adminDoctorMediaSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get("/", { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER) }, async (_request, reply) => {
    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
    return reply.send(ok(parseDoctorMediaSettings(row?.settings)));
  });

  server.put("/", { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: DoctorMediaSettingsUpdateSchema } }, async (request, reply) => {
    const existing = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    const before = parseDoctorMediaSettings(existing?.settings);
    const after: DoctorMediaSettings = { ...before, ...request.body };
    const merged = mergeTelehealthSettings(existing?.settings, { doctorMedia: after });
    await app.prisma.siteModule.upsert({
      where: { key: "telehealth" },
      create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
      update: { settings: merged, updatedById: request.user!.id },
    });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "telehealth.doctor_media_settings.update", targetType: "SiteModule", targetId: "telehealth", metadata: { before, after }, ipAddress: request.ip });
    await triggerTagRevalidation(app, [CACHE_TAGS.doctors]);
    return reply.send(ok(after));
  });
}
