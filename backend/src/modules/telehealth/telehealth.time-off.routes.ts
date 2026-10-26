import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { DoctorAvailabilityRuleSchema } from "../../schemas/entities";
import { NotFoundError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { CACHE_TAGS, triggerTagRevalidation } from "../../lib/revalidate";
import { DoctorIdParamSchema, SetDoctorAvailabilityRequestSchema } from "./telehealth.schemas";
import { requireDoctorPortalAccess } from "./telehealth.portal.routes";
import { CreateTimeOffRequestSchema, TimeOffIdParamSchema, TimeOffSchema, createTimeOff, listTimeOff } from "./lib/time-off";

/**
 * Paket P (İş 2) — doktor müsaitliği tek ekranda: haftalık çalışma saatleri + izin/istisna günleri.
 *  - Doktor portalı (`/doctor/...`): doktor KENDİ saatlerini ve izinlerini yönetir (portal erişim
 *    kapısı: doktor ilişkisi + 2FA, `requireDoctorPortalAccess`).
 *  - Admin (`/admin/telehealth/doctors/:doctorId/time-off`): doktor adına izin ekler (ADMIN/MANAGER).
 * İzin eklenirken onaylı randevu çakışırsa kayıt ENGELLENMEZ; yanıtta `conflicts` listelenir.
 */

const RuleListSchema = z.array(DoctorAvailabilityRuleSchema);

function toRuleDto(rule: { id: string; dayOfWeek: number; startMinute: number; endMinute: number; isActive: boolean }) {
  return { id: rule.id, dayOfWeek: rule.dayOfWeek, startMinute: rule.startMinute, endMinute: rule.endMinute, isActive: rule.isActive };
}

async function revalidateDoctorSlots(app: FastifyInstance) {
  // Slotlar istemciden `no-store` çekilir; doktor kartlarındaki "en erken" bilgisi doktor listesi önbelleğindedir.
  await triggerTagRevalidation(app, [CACHE_TAGS.doctors]);
}

/** `/doctor` prefix'i altında (portal). */
export async function doctorScheduleRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);

  server.get("/availability", { schema: { response: { 200: ApiSuccessSchema(RuleListSchema) } } }, async (request, reply) => {
    const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
    const rules = await app.prisma.doctorAvailability.findMany({ where: { doctorId: doctorProfileId }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] });
    return reply.send(ok(rules.map(toRuleDto)));
  });

  // Admin `PUT /admin/telehealth/doctors/:id/availability` ile AYNI tam-değiştirme semantiği.
  server.put(
    "/availability",
    { schema: { body: SetDoctorAvailabilityRequestSchema, response: { 200: ApiSuccessSchema(RuleListSchema) } } },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
      const rules = await app.prisma.$transaction(async (tx) => {
        await tx.doctorAvailability.deleteMany({ where: { doctorId: doctorProfileId } });
        if (request.body.rules.length > 0) {
          await tx.doctorAvailability.createMany({
            data: request.body.rules.map((rule) => ({
              doctorId: doctorProfileId,
              dayOfWeek: rule.dayOfWeek,
              startMinute: rule.startMinute,
              endMinute: rule.endMinute,
              isActive: rule.isActive ?? true,
            })),
          });
        }
        return tx.doctorAvailability.findMany({ where: { doctorId: doctorProfileId }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] });
      });
      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "telehealth.doctor.availability_updated",
        targetType: "DoctorProfile",
        targetId: doctorProfileId,
        metadata: { ruleCount: rules.length, by: "doctor" },
        ipAddress: request.ip,
      });
      await revalidateDoctorSlots(app);
      return reply.send(ok(rules.map(toRuleDto)));
    }
  );

  server.get("/time-off", { schema: { response: { 200: ApiSuccessSchema(z.array(TimeOffSchema)) } } }, async (request, reply) => {
    const { doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
    return reply.send(ok(await listTimeOff(app, doctorProfileId)));
  });

  server.post(
    "/time-off",
    { schema: { body: CreateTimeOffRequestSchema, response: { 201: ApiSuccessSchema(TimeOffSchema) } } },
    async (request, reply) => {
      const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
      const created = await createTimeOff(app, doctorProfileId, request.body, user.id);
      await logAudit(app, {
        actorId: user.id,
        actorEmail: user.email,
        action: "telehealth.doctor.time_off_created",
        targetType: "DoctorTimeOff",
        targetId: created.id,
        // İç not denetim kaydına YAZILMAZ (yalnızca tür ve çakışma sayısı).
        metadata: { doctorId: doctorProfileId, kind: created.kind, conflictCount: created.conflicts.length, by: "doctor" },
        ipAddress: request.ip,
      });
      await revalidateDoctorSlots(app);
      return reply.code(201).send(ok(created));
    }
  );

  server.delete("/time-off/:timeOffId", { schema: { params: TimeOffIdParamSchema } }, async (request, reply) => {
    const { user, doctorProfileId } = await requireDoctorPortalAccess(app, request.user!.id);
    const row = await app.prisma.doctorTimeOff.findUnique({ where: { id: request.params.timeOffId } });
    // Başka doktorun kaydı varlığı sızdırılmadan 404.
    if (!row || row.doctorId !== doctorProfileId) throw new NotFoundError("İzin kaydı bulunamadı.");
    await app.prisma.doctorTimeOff.delete({ where: { id: row.id } });
    await logAudit(app, {
      actorId: user.id,
      actorEmail: user.email,
      action: "telehealth.doctor.time_off_deleted",
      targetType: "DoctorTimeOff",
      targetId: row.id,
      metadata: { doctorId: doctorProfileId, by: "doctor" },
      ipAddress: request.ip,
    });
    await revalidateDoctorSlots(app);
    return reply.code(204).send();
  });
}

const AdminTimeOffParamSchema = DoctorIdParamSchema.merge(TimeOffIdParamSchema);

/** `/admin/telehealth/doctors` prefix'i altında — doktor adına izin yönetimi. */
export async function adminDoctorTimeOffRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  async function assertDoctor(doctorId: string) {
    const doctor = await app.prisma.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true } });
    if (!doctor) throw new NotFoundError("Doktor bulunamadı.");
  }

  server.get(
    "/:doctorId/time-off",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: DoctorIdParamSchema, response: { 200: ApiSuccessSchema(z.array(TimeOffSchema)) } },
    },
    async (request, reply) => {
      await assertDoctor(request.params.doctorId);
      return reply.send(ok(await listTimeOff(app, request.params.doctorId)));
    }
  );

  server.post(
    "/:doctorId/time-off",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: DoctorIdParamSchema, body: CreateTimeOffRequestSchema, response: { 201: ApiSuccessSchema(TimeOffSchema) } },
    },
    async (request, reply) => {
      await assertDoctor(request.params.doctorId);
      const created = await createTimeOff(app, request.params.doctorId, request.body, request.user!.id);
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor.time_off_created",
        targetType: "DoctorTimeOff",
        targetId: created.id,
        metadata: { doctorId: request.params.doctorId, kind: created.kind, conflictCount: created.conflicts.length, by: "admin" },
        ipAddress: request.ip,
      });
      await revalidateDoctorSlots(app);
      return reply.code(201).send(ok(created));
    }
  );

  server.delete(
    "/:doctorId/time-off/:timeOffId",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { params: AdminTimeOffParamSchema } },
    async (request, reply) => {
      const row = await app.prisma.doctorTimeOff.findUnique({ where: { id: request.params.timeOffId } });
      if (!row || row.doctorId !== request.params.doctorId) throw new NotFoundError("İzin kaydı bulunamadı.");
      await app.prisma.doctorTimeOff.delete({ where: { id: row.id } });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.doctor.time_off_deleted",
        targetType: "DoctorTimeOff",
        targetId: row.id,
        metadata: { doctorId: row.doctorId, by: "admin" },
        ipAddress: request.ip,
      });
      await revalidateDoctorSlots(app);
      return reply.code(204).send();
    }
  );
}
