import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { CACHE_TAGS, revalidateTagsOnWrite, triggerTagRevalidation } from "../../lib/revalidate";
import { mergeTelehealthSettings } from "../telehealth/lib/emergency-notice";
import {
  ContactChannelsSettingsSchema,
  DestinationBodySchema,
  PackageBodySchema,
  destinationData,
  packageData,
  parseContactChannels,
  toAdminDestinationDto,
  toAdminPackageDto,
} from "./packages.shared";

const IdParams = z.object({ id: z.string().uuid() });

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** `/admin/packages` — paket CRUD (ADMIN/MANAGER). Talepler CRM'de "Package" kanalıyla görünür. */
export async function adminPackagesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  revalidateTagsOnWrite(app, () => [CACHE_TAGS.packages]);
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  async function assertRefs(body: z.infer<typeof PackageBodySchema>) {
    if (body.coverMediaId) {
      const media = await app.prisma.media.findUnique({ where: { id: body.coverMediaId }, select: { mimeType: true } });
      if (!media || !media.mimeType.startsWith("image/")) throw new ValidationError("Kapak görseli bulunamadı ya da görsel değil.", { coverMediaId: ["Görsel seçin."] });
    }
    if (body.relatedDoctorIds.length && (await app.prisma.doctorProfile.count({ where: { id: { in: body.relatedDoctorIds } } })) !== new Set(body.relatedDoctorIds).size) {
      throw new ValidationError("Bilinmeyen hekim.", { relatedDoctorIds: ["Hekim bulunamadı."] });
    }
    if (body.relatedSpecialtyIds.length && (await app.prisma.specialty.count({ where: { id: { in: body.relatedSpecialtyIds } } })) !== new Set(body.relatedSpecialtyIds).size) {
      throw new ValidationError("Bilinmeyen uzmanlık.", { relatedSpecialtyIds: ["Uzmanlık bulunamadı."] });
    }
  }

  const include = { coverMedia: true, _count: { select: { inquiries: true } } } as const;

  server.get("/", async (_request, reply) => {
    const rows = await app.prisma.healthPackage.findMany({ include, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return reply.send(ok(rows.map(toAdminPackageDto)));
  });

  server.get("/:id", { schema: { params: IdParams } }, async (request, reply) => {
    const row = await app.prisma.healthPackage.findUnique({ where: { id: request.params.id }, include });
    if (!row) throw new NotFoundError("Paket bulunamadı.");
    return reply.send(ok(toAdminPackageDto(row)));
  });

  server.post("/", { schema: { body: PackageBodySchema } }, async (request, reply) => {
    await assertRefs(request.body);
    try {
      const row = await app.prisma.healthPackage.create({ data: packageData(request.body), include });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "package.created", targetType: "HealthPackage", targetId: row.id, metadata: { slug: row.slug, isActive: row.isActive }, ipAddress: request.ip });
      return reply.status(201).send(ok(toAdminPackageDto(row)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Bu adres (slug) başka bir pakette kullanılıyor.");
      throw err;
    }
  });

  server.put("/:id", { schema: { params: IdParams, body: PackageBodySchema } }, async (request, reply) => {
    if (!(await app.prisma.healthPackage.findUnique({ where: { id: request.params.id }, select: { id: true } }))) throw new NotFoundError("Paket bulunamadı.");
    await assertRefs(request.body);
    try {
      const row = await app.prisma.healthPackage.update({ where: { id: request.params.id }, data: packageData(request.body), include });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "package.updated", targetType: "HealthPackage", targetId: row.id, metadata: { slug: row.slug, isActive: row.isActive, showPrice: row.showPrice }, ipAddress: request.ip });
      return reply.send(ok(toAdminPackageDto(row)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Bu adres (slug) başka bir pakette kullanılıyor.");
      throw err;
    }
  });

  server.delete("/:id", { schema: { params: IdParams, response: { 204: z.undefined() } } }, async (request, reply) => {
    if (!(await app.prisma.healthPackage.findUnique({ where: { id: request.params.id }, select: { id: true } }))) throw new NotFoundError("Paket bulunamadı.");
    // Talepler silinmez: `packageId` boşa çekilir, talepteki paket adı anlık görüntüsü kalır.
    await app.prisma.healthPackage.delete({ where: { id: request.params.id } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "package.deleted", targetType: "HealthPackage", targetId: request.params.id, ipAddress: request.ip });
    return reply.code(204).send();
  });
}

/** `/admin/destinations` — "Top destinations" CRUD (ADMIN/MANAGER). Seed yok; rakamları yönetici girer. */
export async function adminDestinationsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  revalidateTagsOnWrite(app, () => [CACHE_TAGS.destinations]);
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  async function assertCover(id: string | null | undefined) {
    if (!id) return;
    const media = await app.prisma.media.findUnique({ where: { id }, select: { mimeType: true } });
    if (!media || !media.mimeType.startsWith("image/")) throw new ValidationError("Kapak görseli bulunamadı ya da görsel değil.", { coverMediaId: ["Görsel seçin."] });
  }

  server.get("/", async (_request, reply) => {
    const rows = await app.prisma.destinationHighlight.findMany({ include: { coverMedia: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return reply.send(ok(rows.map(toAdminDestinationDto)));
  });

  server.post("/", { schema: { body: DestinationBodySchema } }, async (request, reply) => {
    await assertCover(request.body.coverMediaId);
    try {
      const row = await app.prisma.destinationHighlight.create({ data: destinationData(request.body), include: { coverMedia: true } });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "destination.created", targetType: "DestinationHighlight", targetId: row.id, ipAddress: request.ip });
      return reply.status(201).send(ok(toAdminDestinationDto(row)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Bu adres (slug) başka bir destinasyonda kullanılıyor.");
      throw err;
    }
  });

  server.put("/:id", { schema: { params: IdParams, body: DestinationBodySchema } }, async (request, reply) => {
    if (!(await app.prisma.destinationHighlight.findUnique({ where: { id: request.params.id }, select: { id: true } }))) throw new NotFoundError("Destinasyon bulunamadı.");
    await assertCover(request.body.coverMediaId);
    try {
      const row = await app.prisma.destinationHighlight.update({ where: { id: request.params.id }, data: destinationData(request.body), include: { coverMedia: true } });
      await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "destination.updated", targetType: "DestinationHighlight", targetId: row.id, metadata: { isActive: row.isActive, showPrices: row.showPrices }, ipAddress: request.ip });
      return reply.send(ok(toAdminDestinationDto(row)));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError("Bu adres (slug) başka bir destinasyonda kullanılıyor.");
      throw err;
    }
  });

  server.delete("/:id", { schema: { params: IdParams, response: { 204: z.undefined() } } }, async (request, reply) => {
    if (!(await app.prisma.destinationHighlight.findUnique({ where: { id: request.params.id }, select: { id: true } }))) throw new NotFoundError("Destinasyon bulunamadı.");
    await app.prisma.destinationHighlight.delete({ where: { id: request.params.id } });
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "destination.deleted", targetType: "DestinationHighlight", targetId: request.params.id, ipAddress: request.ip });
    return reply.code(204).send();
  });
}

/** `/admin/telehealth/settings/contact-channels` — WhatsApp (varsayılan kapalı), koordinatör adresi, hazır mesajlar. */
export async function adminContactChannelsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.get("/", { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER) }, async (_request, reply) => {
    const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
    return reply.send(ok(parseContactChannels(row?.settings)));
  });

  server.put("/", { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: ContactChannelsSettingsSchema } }, async (request, reply) => {
    const existing = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" } });
    const before = parseContactChannels(existing?.settings);
    const merged = mergeTelehealthSettings(existing?.settings, { contactChannels: request.body });
    await app.prisma.siteModule.upsert({
      where: { key: "telehealth" },
      create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
      update: { settings: merged, updatedById: request.user!.id },
    });
    // Denetim izinde e-posta adresi açık yazılmaz (yalnızca dolu/boş).
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action: "telehealth.contact_channels.update",
      targetType: "SiteModule",
      targetId: "telehealth",
      metadata: { whatsappEnabledBefore: before.whatsappEnabled, whatsappEnabledAfter: request.body.whatsappEnabled, coordinatorEmailSet: Boolean(request.body.coordinatorEmail) },
      ipAddress: request.ip,
    });
    await triggerTagRevalidation(app, [CACHE_TAGS.contactChannels]);
    return reply.send(ok(request.body));
  });
}
