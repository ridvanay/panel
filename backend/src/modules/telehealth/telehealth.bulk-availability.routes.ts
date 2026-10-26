import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { BULK_AVAILABILITY_RATE_LIMIT } from "../../lib/rate-limit";
import { AVAILABILITY_RULE_INPUT_SCHEMA } from "./telehealth.schemas";
import { TIME_OFF_KINDS } from "./lib/time-off";
import { normalizeWeeklyRules } from "./lib/weekly-availability";
import { BULK_CSV_MAX_BYTES, buildBulkTemplate, parseBulkCsv, parseDateCell, parseTimeCell } from "./lib/bulk-availability-csv";
import {
  BULK_SOURCES,
  BulkSummarySchema,
  WEEKLY_MODES,
  applyPreview,
  buildInputFromCsv,
  buildInputFromTimeOff,
  buildInputFromWeeklyTemplate,
  changePreviewMode,
  createPreview,
  toOperationDto,
  undoBulkOperation,
} from "./lib/bulk-availability";
import { revalidateDoctorSlots } from "./telehealth.time-off.routes";

/**
 * Paket Q — `/admin/telehealth/bulk-availability` (YALNIZCA ADMIN; personel 2FA kuralı
 * `requireSiteRole` içinde, MANAGER/EDITOR 403). Her uçta route-level hız sınırı.
 * Yüklenen CSV gövdede base64 gelir, bellekte işlenir, diske YAZILMAZ.
 */

const RuleDtoSchema = z.object({ dayOfWeek: z.number(), startMinute: z.number(), endMinute: z.number(), isActive: z.boolean() });
const ConflictDtoSchema = z.object({
  appointmentId: z.string(),
  bookingNumber: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  patientTimeZone: z.string().nullable(),
  reason: z.enum(["TIME_OFF", "REMOVED_HOURS"]),
});
const PreviewDtoSchema = z.object({
  previewId: z.string(),
  expiresAt: z.string(),
  source: z.enum(BULK_SOURCES),
  fileName: z.string().nullable(),
  rowCount: z.number(),
  weeklyMode: z.enum(WEEKLY_MODES),
  doctors: z.array(
    z.object({
      doctorId: z.string(),
      slug: z.string(),
      name: z.string(),
      timeZone: z.string(),
      weekly: z
        .object({
          before: z.array(RuleDtoSchema),
          after: z.array(RuleDtoSchema),
          added: z.array(RuleDtoSchema),
          removed: z.array(RuleDtoSchema),
          unchanged: z.array(RuleDtoSchema),
        })
        .nullable(),
      timeOff: z.object({
        skipped: z.number(),
        toAdd: z.array(z.object({ startsAt: z.string(), endsAt: z.string(), kind: z.enum(TIME_OFF_KINDS), allDay: z.boolean(), hasNote: z.boolean() })),
      }),
      conflicts: z.array(ConflictDtoSchema),
    })
  ),
  untouchedDoctors: z.array(z.object({ doctorId: z.string(), slug: z.string(), name: z.string() })),
  totals: z.object({
    doctors: z.number(),
    rulesAdded: z.number(),
    rulesRemoved: z.number(),
    timeOffAdded: z.number(),
    timeOffSkipped: z.number(),
    conflicts: z.number(),
  }),
});
const PreviewResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ row: z.number().nullable(), message: z.string() })),
  preview: PreviewDtoSchema.nullable(),
});
const OperationDtoSchema = z.object({
  id: z.string(),
  source: z.enum(BULK_SOURCES),
  fileName: z.string().nullable(),
  rowCount: z.number(),
  doctorCount: z.number(),
  summary: BulkSummarySchema,
  actorEmail: z.string().nullable(),
  createdAt: z.string(),
  undoneAt: z.string().nullable(),
});

const DoctorIdsSchema = z.array(z.string().uuid()).min(1).max(500);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const CsvPreviewBodySchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((n) => /\.(csv|txt)$/i.test(n), "Yalnızca .csv ya da .txt dosyası yüklenebilir.")
      .refine((n) => ![...n].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f), "Dosya adında kontrol karakteri olamaz."),
    // 2 MB → base64 en fazla ~2,8 MB.
    contentBase64: z.string().min(1).max(Math.ceil((BULK_CSV_MAX_BYTES * 4) / 3) + 4),
    weeklyMode: z.enum(WEEKLY_MODES).default("replace"),
  })
  .strict();

const TemplatePreviewBodySchema = z
  .object({
    doctorIds: DoctorIdsSchema,
    rules: z.array(AVAILABILITY_RULE_INPUT_SCHEMA).min(1).max(21),
    weeklyMode: z.enum(WEEKLY_MODES).default("replace"),
  })
  .strict();

const TimeOffPreviewBodySchema = z
  .object({
    doctorIds: DoctorIdsSchema,
    startDate: DateSchema,
    endDate: DateSchema,
    startTime: TimeSchema.nullable().optional(),
    endTime: TimeSchema.nullable().optional(),
    kind: z.enum(TIME_OFF_KINDS),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const ModeBodySchema = z.object({ weeklyMode: z.enum(WEEKLY_MODES) }).strict();
const ApplyBodySchema = z.object({ previewId: z.string().uuid(), acknowledgeConflicts: z.boolean().default(false) }).strict();
const PreviewIdParamSchema = z.object({ previewId: z.string().uuid() });
const OperationIdParamSchema = z.object({ operationId: z.string().uuid() });
const TemplateQuerySchema = z.object({ delimiter: z.enum(["semicolon", "comma"]).default("semicolon") });

export async function adminBulkAvailabilityRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));
  const config = { rateLimit: BULK_AVAILABILITY_RATE_LIMIT };
  const actorOf = (request: FastifyRequest) => ({ id: request.user!.id, email: request.user!.email });

  server.get("/template", { config, schema: { querystring: TemplateQuerySchema } }, async (request, reply) => {
    const now = new Date();
    const doctors = await app.prisma.doctorProfile.findMany({
      where: { isActive: true, archivedAt: null },
      orderBy: [{ order: "asc" }, { fullName: "asc" }],
      select: {
        slug: true,
        title: true,
        fullName: true,
        timeZone: true,
        availability: true,
        timeOff: { where: { endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, endsAt: true, kind: true, allDay: true, note: true } },
      },
    });
    const csv = buildBulkTemplate(
      doctors.map((d) => ({ ...d, rules: normalizeWeeklyRules(d.availability) })),
      request.query.delimiter === "comma" ? "," : ";"
    );
    const fileName = `calisma-saatleri-izinler-${now.toISOString().slice(0, 10)}.csv`;
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${fileName}"`)
      .header("Cache-Control", "no-store")
      .send(csv);
  });

  server.post(
    "/preview/csv",
    { config, schema: { body: CsvPreviewBodySchema, response: { 200: ApiSuccessSchema(PreviewResultSchema) } } },
    async (request, reply) => {
      const buffer = Buffer.from(request.body.contentBase64, "base64");
      if (buffer.length === 0) throw new ValidationError("Dosya boş.", { file: ["Dosya boş."] });
      if (buffer.length > BULK_CSV_MAX_BYTES) throw new ValidationError("Dosya en fazla 2 MB olabilir.", { file: ["Dosya en fazla 2 MB olabilir."] });
      const parsed = parseBulkCsv(buffer);
      const built = await buildInputFromCsv(app.prisma, parsed, request.body.fileName);
      built.errors.unshift(...parsed.errors);
      return reply.send(ok(await createPreview(app, request.user!.id, built, request.body.weeklyMode)));
    }
  );

  server.post(
    "/preview/template",
    { config, schema: { body: TemplatePreviewBodySchema, response: { 200: ApiSuccessSchema(PreviewResultSchema) } } },
    async (request, reply) => {
      const built = await buildInputFromWeeklyTemplate(app.prisma, request.body);
      return reply.send(ok(await createPreview(app, request.user!.id, built, request.body.weeklyMode)));
    }
  );

  server.post(
    "/preview/time-off",
    { config, schema: { body: TimeOffPreviewBodySchema, response: { 200: ApiSuccessSchema(PreviewResultSchema) } } },
    async (request, reply) => {
      const body = request.body;
      // Tarih/saat ayrıştırması CSV ile AYNI fonksiyonlardan geçer.
      const startDate = parseDateCell(body.startDate);
      const endDate = parseDateCell(body.endDate);
      const startMinute = parseTimeCell(body.startTime ?? "");
      const endMinute = parseTimeCell(body.endTime ?? "");
      if (!startDate || startDate === "invalid" || !endDate || endDate === "invalid") throw new ValidationError("Geçersiz tarih.", { startDate: ["Geçersiz tarih."] });
      if (startMinute === "invalid" || endMinute === "invalid" || (startMinute === null) !== (endMinute === null)) {
        throw new ValidationError("Saatli izinde başlangıç ve bitiş saati birlikte girilmeli.", { startTime: ["Başlangıç ve bitiş saati birlikte girilmeli."] });
      }
      const built = await buildInputFromTimeOff(app.prisma, {
        doctorIds: body.doctorIds,
        startDate,
        endDate,
        startMinute,
        endMinute,
        kind: body.kind,
        note: body.note?.trim() || null,
      });
      return reply.send(ok(await createPreview(app, request.user!.id, built, "append")));
    }
  );

  server.post(
    "/previews/:previewId/mode",
    { config, schema: { params: PreviewIdParamSchema, body: ModeBodySchema, response: { 200: ApiSuccessSchema(PreviewResultSchema) } } },
    async (request, reply) => reply.send(ok(await changePreviewMode(app, request.user!.id, request.params.previewId, request.body.weeklyMode)))
  );

  server.post("/apply", { config, schema: { body: ApplyBodySchema, response: { 200: ApiSuccessSchema(OperationDtoSchema) } } }, async (request, reply) => {
    const { operation, affectedDoctorIds } = await applyPreview(app, actorOf(request), request.body.previewId, request.body.acknowledgeConflicts);
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action: "telehealth.availability.bulk_import",
      targetType: "DoctorAvailabilityBulkOperation",
      targetId: operation.id,
      metadata: { source: operation.source, fileName: operation.fileName, rowCount: operation.rowCount, doctorCount: affectedDoctorIds.length },
      ipAddress: request.ip,
    });
    await revalidateDoctorSlots(app);
    return reply.send(ok(toOperationDto(operation)));
  });

  server.get("/operations", { config, schema: { response: { 200: ApiSuccessSchema(z.array(OperationDtoSchema)) } } }, async (_request, reply) => {
    const rows = await app.prisma.doctorAvailabilityBulkOperation.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    return reply.send(ok(rows.map(toOperationDto)));
  });

  server.post(
    "/operations/:operationId/undo",
    { config, schema: { params: OperationIdParamSchema, response: { 200: ApiSuccessSchema(OperationDtoSchema) } } },
    async (request, reply) => {
      const { operation, affectedDoctorIds } = await undoBulkOperation(app, request.user!.id, request.params.operationId);
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "telehealth.availability.bulk_undo",
        targetType: "DoctorAvailabilityBulkOperation",
        targetId: operation.id,
        metadata: { source: operation.source, doctorCount: affectedDoctorIds.length },
        ipAddress: request.ip,
      });
      await revalidateDoctorSlots(app);
      return reply.send(ok(toOperationDto(operation)));
    }
  );
}
