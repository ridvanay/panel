import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta } from "../../schemas/common";
import { ExportJobSchema } from "../../schemas/entities";
import { toExportJobDto } from "../../mappers";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { encodeCursor, parseCursor } from "../../lib/pagination";
import { logAudit } from "../../lib/audit";
import { exportStorage } from "../../lib/export-storage";
import { resolveStatsRange } from "../../lib/stats-query";
import { EXPORT_JOB_RETENTION_MS, EXPORT_JOB_RETENTION_UNMASKED_MS } from "./reports.constants";
import { CreateExportJobRequestSchema, ExportJobIdParamSchema, ListExportJobsQuerySchema } from "./reports.schemas";
import { enqueueExportJob } from "./reports.worker";

const EXPORT_CONTENT_TYPES: Record<"CSV" | "PDF", string> = {
  CSV: "text/csv; charset=utf-8",
  PDF: "application/pdf",
};
const EXPORT_FILE_EXTENSIONS: Record<"CSV" | "PDF", string> = { CSV: "csv", PDF: "pdf" };

const ListExportJobsMetaSchema = z.object({ nextCursor: z.string().nullable().optional() });

/**
 * security-agent — `POST /` her çağrıda pahalı bir DB aggregation (§10.8.10'daki `stats-query.ts`
 * fonksiyonları ya da 5000 satıra kadar `USERS`/`REVENUE` sorgusu) + PDF/CSV üretimi TETİKLER;
 * global `env.RATE_LIMIT_MAX` (300/dk, admin navigasyonu için gevşetilmiş) tek başına yetersiz.
 * `import.routes.ts::IMPORT_UPLOAD_RATE_LIMIT` ile AYNI desen/gerekçe — kaynak tüketimi/kötüye
 * kullanımı sınırlamak için route-level ayrı bir tavan.
 */
const EXPORT_CREATE_RATE_LIMIT = { max: 10, timeWindow: "10 minutes" };

/**
 * `/admin/reports/exports` prefix'i altında bağlanır (bkz. app.ts).
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 16 — TÜM uçlar ADMIN + MANAGER
 * (export'ta PII/gelir riski var, rapor türü fark etmeksizin).
 */
export async function adminReportsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/",
    { schema: { querystring: ListExportJobsQuerySchema, response: { 200: ApiSuccessWithMeta(z.array(ExportJobSchema), ListExportJobsMetaSchema) } } },
    async (request, reply) => {
      const { cursor, limit, type, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.exportJob.findMany({
        where: {
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: { seq: "desc" },
        take: limit,
        include: { createdBy: true },
      });

      const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;
      return reply.send(ok(rows.map(toExportJobDto), { nextCursor }));
    }
  );

  server.post(
    "/",
    {
      config: { rateLimit: EXPORT_CREATE_RATE_LIMIT },
      schema: { body: CreateExportJobRequestSchema, response: { 202: ApiSuccessSchema(ExportJobSchema) } },
    },
    async (request, reply) => {
      const body = request.body;

      // Aralık doğrulaması (366 gün tavanı, `from` <= `to` vb.) — geçersizse iş HİÇ oluşturulmaz
      // (bkz. lib/stats-query.ts::resolveStatsRange, 422 ValidationError fırlatır).
      resolveStatsRange({ from: body.from, to: body.to });

      // compliance-agent kararı (2026-08-06) — ham PII içeren (`unmaskPii: true`) dosyalar
      // varsayılan maskeli dosyalardan çok daha kısa saklanır (bkz. reports.constants.ts).
      const retentionMs = body.unmaskPii ? EXPORT_JOB_RETENTION_UNMASKED_MS : EXPORT_JOB_RETENTION_MS;

      const job = await app.prisma.exportJob.create({
        data: {
          type: body.type,
          format: body.format,
          status: "PENDING",
          // Worker BU JSON'u okuyarak raporu üretir (bkz. reports.worker.ts::runExportJob) —
          // `filters` sütunu hem tarih aralığını hem tip-bazlı ek filtreleri hem de maskeleme
          // tercihini taşır (ARCHITECTURE.md §10.8.10'daki alan açıklamasıyla TUTARLI).
          filters: { from: body.from, to: body.to, granularity: body.granularity, filters: body.filters, unmaskPii: body.unmaskPii } as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + retentionMs),
          createdById: request.user!.id,
        },
        include: { createdBy: true },
      });

      enqueueExportJob(app, job.id);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "reports.export.create",
        targetType: "ExportJob",
        targetId: job.id,
        metadata: { type: body.type, format: body.format, from: body.from, to: body.to, unmaskPii: body.unmaskPii },
        ipAddress: request.ip,
      });

      // Kullanıcı tarafından onaylanmış karar — `unmaskPii: true` AYRI ve açıkça işaretli bir
      // audit action'ı gerektirir (ek bir onay akışı YOK, bu zaten ADMIN-only bir uçtur).
      // compliance-agent notu (2026-08-06): metadata KENDİ İÇİNDE yeterli olmalı — bir denetim/
      // soruşturma senaryosunda bu kaydın `reports.export.create` ile AYRICA eşleştirilmesine
      // (targetId join'i) gerek kalmadan "hangi rapor tipi + hangi tarih aralığı için ham PII
      // görüntülendi" sorusuna tek başına cevap versin diye `from`/`to`/`format` de eklendi.
      if (body.unmaskPii) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "reports.export.unmasked_pii",
          targetType: "ExportJob",
          targetId: job.id,
          metadata: { type: body.type, format: body.format, from: body.from, to: body.to },
          ipAddress: request.ip,
        });
      }

      return reply.code(202).send(ok(toExportJobDto(job)));
    }
  );

  server.get(
    "/:jobId",
    { schema: { params: ExportJobIdParamSchema, response: { 200: ApiSuccessSchema(ExportJobSchema) } } },
    async (request, reply) => {
      const job = await app.prisma.exportJob.findUnique({ where: { id: request.params.jobId }, include: { createdBy: true } });
      if (!job) throw new NotFoundError("Dışa aktarma işi bulunamadı.");
      return reply.send(ok(toExportJobDto(job)));
    }
  );

  server.get(
    "/:jobId/download",
    { schema: { params: ExportJobIdParamSchema } },
    async (request, reply) => {
      const job = await app.prisma.exportJob.findUnique({ where: { id: request.params.jobId } });
      if (!job) throw new NotFoundError("Dışa aktarma işi bulunamadı.");

      if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
        throw new NotFoundError("Bu raporun indirme süresi dolmuş.");
      }
      if (job.status !== "COMPLETED" || !job.storagePath) {
        throw new ConflictError("Rapor henüz hazır değil.");
      }

      const buffer = await exportStorage.read(job.storagePath);
      const extension = EXPORT_FILE_EXTENSIONS[job.format];
      const filename = `export-${job.type.toLowerCase()}-${job.id}.${extension}`;

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "reports.export.download",
        targetType: "ExportJob",
        targetId: job.id,
        metadata: { type: job.type, format: job.format, containsPii: job.containsPii },
        ipAddress: request.ip,
      });

      return reply
        .header("Content-Type", EXPORT_CONTENT_TYPES[job.format])
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(buffer);
    }
  );
}
