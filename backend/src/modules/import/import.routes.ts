import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, ApiSuccessWithMeta, CursorQuerySchema } from "../../schemas/common";
import { ImportJobErrorListMetaSchema, ImportJobErrorSchema, ImportJobPreviewDto, ImportJobSchema, ImportJobSummarySchema } from "../../schemas/entities";
import { toImportJobDto, toImportJobErrorDto, toImportJobSummaryDto } from "../../mappers";
import { ConflictError, NotFoundError, PayloadTooLargeError, ValidationError } from "../../lib/errors";
import { encodeCursor, parseCursor } from "../../lib/pagination";
import { logAudit } from "../../lib/audit";
import { importStorage } from "../../lib/import-storage";
import { isModuleEnabled } from "../../lib/module-state";
import { buildImportPreview } from "./import.preview";
import { detectImportFormat } from "./lib/format-detect";
import {
  assertDuplicateStrategyAllowed,
  DUPLICATE_STRATEGY_TO_PRISMA,
  IMPORT_ERROR_ROW_CAP,
  IMPORT_FILE_SIZE_LIMITS,
  IMPORT_PENDING_SWEEP_MS,
  ISO_4217_CURRENCY_CODES,
} from "./import.constants";
import { CreateImportJobRequestSchema, ImportJobIdParamSchema, ListImportJobsQuerySchema, StartImportJobRequestSchema } from "./import.schemas";
import { enqueueImportJob } from "./import.worker";

/** Tüm tipler arasındaki en yüksek dosya boyutu limiti (MEDIA, 100 MB) — multipart üst tavanı. */
const MAX_IMPORT_FILE_BYTES = Math.max(...Object.values(IMPORT_FILE_SIZE_LIMITS));
/** `app.ts`'teki global `bodyLimit`i aşmak için route-level override (bkz. ARCHITECTURE.md §10.8.5). */
const IMPORT_UPLOAD_BODY_LIMIT = MAX_IMPORT_FILE_BYTES + 2 * 1024 * 1024;
/** openapi.yaml `POST /admin/import/jobs` açıklaması — "10 istek / 10 dakika". */
const IMPORT_UPLOAD_RATE_LIMIT = { max: 10, timeWindow: "10 minutes" };

/**
 * §10.8.5 — onaylanmamış (`PENDING`) işler 24 saat sonra tembel süpürülür (cron YOK, her yeni
 * yüklemede tetiklenir). Best-effort: başarısız olursa yükleme isteğini DÜŞÜRMEZ.
 */
async function sweepStalePendingJobs(app: FastifyInstance): Promise<void> {
  const cutoff = new Date(Date.now() - IMPORT_PENDING_SWEEP_MS);
  const stale = await app.prisma.importJob.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true, storagePath: true },
  });
  if (stale.length === 0) return;

  for (const job of stale) {
    if (job.storagePath) await importStorage.remove(job.storagePath).catch(() => {});
  }
  await app.prisma.importJob.deleteMany({ where: { id: { in: stale.map((j) => j.id) } } });
}

/**
 * `/admin/import/jobs` prefix'i altında bağlanır (bkz. app.ts) — TÜM uçlar yalnızca ADMIN
 * (`.claude/architect-scope-rbac-5-tier.md` §5.3 satır 6 — (a): USERS içe aktarma rol atayabilir).
 */
export async function adminImportRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN));

  server.get(
    "/",
    {
      schema: { querystring: ListImportJobsQuerySchema, response: { 200: ApiSuccessSchema(z.array(ImportJobSummarySchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit, type, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.importJob.findMany({
        where: {
          ...(cursorSeq ? { seq: { lt: cursorSeq } } : {}),
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
        },
        // `seq DESC` (en yeni önce) — bkz. openapi.yaml `GET /admin/import/jobs` açıklaması.
        orderBy: { seq: "desc" },
        take: limit,
        include: { createdBy: true },
      });

      const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;
      return reply.send(ok(rows.map(toImportJobSummaryDto), { nextCursor }));
    }
  );

  server.post(
    "/",
    {
      config: { rateLimit: IMPORT_UPLOAD_RATE_LIMIT },
      bodyLimit: IMPORT_UPLOAD_BODY_LIMIT,
      schema: { response: { 201: ApiSuccessSchema(ImportJobSchema) } },
    },
    async (request, reply) => {
      await sweepStalePendingJobs(app).catch((err) => app.log.error({ err }, "Bekleyen içe aktarma işleri süpürülemedi"));

      // `type` alanı dosyadan ÖNCE ya da SONRA gelebilir — bu yüzden `request.file()` yerine
      // `request.parts()` ile TÜM parçalar elle tüketilir (bkz. ARCHITECTURE.md §10.8.5).
      // Üst tavan (100 MB, MEDIA) burada uygulanır; tip-bazlı gerçek limit aşağıda AYRICA kontrol
      // edilir — bu ikisi birbirinden bağımsızdır çünkü `type` alanı henüz bilinmeden dosya
      // okunmaya başlanmış olabilir.
      const parts = request.parts({ limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1, fields: 5 } });

      let filename: string | undefined;
      let buffer: Buffer | undefined;
      let truncated = false;
      let typeValue: string | undefined;

      for await (const part of parts) {
        if (part.type === "file") {
          if (buffer !== undefined) {
            part.file.resume();
            continue;
          }
          filename = part.filename;
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk as Buffer);
          buffer = Buffer.concat(chunks);
          truncated = part.file.truncated;
        } else if (part.fieldname === "type") {
          typeValue = String(part.value);
        }
      }

      if (!buffer || !filename) {
        throw new ValidationError("Yüklenecek dosya bulunamadı.", { file: ["Zorunlu."] });
      }

      const typeParse = CreateImportJobRequestSchema.shape.type.safeParse(typeValue);
      if (!typeParse.success) {
        throw new ValidationError("Geçersiz veya eksik `type` alanı.", { type: ["PAGES, BLOG, WORDPRESS, PRODUCTS, USERS veya MEDIA olmalı."] });
      }
      const type = typeParse.data;

      // §10.8.9 — `Products` modülü kapalıysa `PRODUCTS` tipiyle iş OLUŞTURULMAZ (422, `NOT_FOUND`
      // değil — kapalı bir modüle veri yazmak modül anahtarının anlamını boşa çıkarırdı).
      if (type === "PRODUCTS" && !(await isModuleEnabled(app, "products"))) {
        throw new ValidationError("Ürünler modülü kapalı olduğundan bu tipte içe aktarma yapılamaz.", {
          type: ["Ürünler modülünü Modüller ekranından etkinleştirin."],
        });
      }

      const typeLimit = IMPORT_FILE_SIZE_LIMITS[type];
      if (truncated || buffer.byteLength > typeLimit) {
        throw new PayloadTooLargeError(`Dosya çok büyük. Bu tür için en fazla ${Math.floor(typeLimit / (1024 * 1024))} MB yükleyebilirsiniz.`, {
          file: [`En fazla ${typeLimit} bayt.`],
        });
      }

      const format = detectImportFormat(buffer, type);
      const { preview, totalCount } = await buildImportPreview(app, type, format, buffer);

      const storagePath = await importStorage.save(buffer);

      let job;
      try {
        job = await app.prisma.importJob.create({
          data: {
            type,
            format,
            status: "PENDING",
            filename,
            storagePath,
            sizeBytes: buffer.byteLength,
            preview: preview as unknown as Prisma.InputJsonValue,
            totalCount,
            createdById: request.user!.id,
          },
          include: { createdBy: true },
        });
      } catch (err) {
        await importStorage.remove(storagePath).catch(() => {});
        throw err;
      }

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "import.upload",
        targetType: "ImportJob",
        targetId: job.id,
        metadata: { type, format, sizeBytes: buffer.byteLength, totalCount },
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok(toImportJobDto(job)));
    }
  );

  server.get(
    "/:jobId",
    { schema: { params: ImportJobIdParamSchema, response: { 200: ApiSuccessSchema(ImportJobSchema) } } },
    async (request, reply) => {
      const job = await app.prisma.importJob.findUnique({ where: { id: request.params.jobId }, include: { createdBy: true } });
      if (!job) throw new NotFoundError("İçe aktarma işi bulunamadı.");
      return reply.send(ok(toImportJobDto(job)));
    }
  );

  server.delete(
    "/:jobId",
    { schema: { params: ImportJobIdParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const job = await app.prisma.importJob.findUnique({ where: { id: request.params.jobId } });
      if (!job) throw new NotFoundError("İçe aktarma işi bulunamadı.");
      if (job.status === "PROCESSING") {
        throw new ConflictError("İşlenen bir iş silinemez. Önce iptal edin.");
      }

      // ATOMIC koşullu silme — yukarıdaki okuma ile buradaki silme arasında worker tam bu anda
      // işi `PROCESSING`e claim edebilir (bkz. import.worker.ts::runImportJob). `status: { not:
      // "PROCESSING" }` koşulu Postgres'te satır kilidiyle atomic değerlendirilir: worker
      // önce davranırsa burada `count: 0` görürüz (409'a düşer, dosya SİLİNMEZ — worker hâlâ
      // okuyor olabilir); biz önce davranırsak worker'ın claim'i `count: 0` görüp sessizce
      // çıkar (bkz. worker'daki `updateMany` claim). Dosya, satır GERÇEKTEN silindikten SONRA
      // kaldırılır — aksi halde `count: 0` durumunda hâlâ PROCESSING olan işin kaynak dosyasını
      // worker'ın altından çekmiş oluruz.
      const deleted = await app.prisma.importJob.deleteMany({ where: { id: job.id, status: { not: "PROCESSING" } } });
      if (deleted.count === 0) {
        throw new ConflictError("İşlenen bir iş silinemez. Önce iptal edin.");
      }

      if (job.storagePath) await importStorage.remove(job.storagePath).catch(() => {});

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "import.delete",
        targetType: "ImportJob",
        targetId: job.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  server.post(
    "/:jobId/start",
    {
      schema: {
        params: ImportJobIdParamSchema,
        body: StartImportJobRequestSchema.optional(),
        response: { 202: ApiSuccessSchema(ImportJobSchema) },
      },
    },
    async (request, reply) => {
      const job = await app.prisma.importJob.findUnique({ where: { id: request.params.jobId } });
      if (!job) throw new NotFoundError("İçe aktarma işi bulunamadı.");
      if (job.status !== "PENDING") throw new ConflictError("Bu iş zaten başlatılmış.");

      const body = request.body ?? {};
      const duplicateStrategy = body.duplicateStrategy ?? "skip";

      try {
        assertDuplicateStrategyAllowed(job.type, duplicateStrategy);
      } catch {
        throw new ValidationError(
          job.type === "USERS"
            ? "USERS içe aktarımında yalnızca `skip` çakışma stratejisi kullanılabilir (yetki yükseltme riski)."
            : "MEDIA içe aktarımında `createNew` çakışma stratejisi kullanılamaz.",
          { duplicateStrategy: ["Geçersiz strateji."] }
        );
      }

      const preview = job.preview as unknown as ImportJobPreviewDto | null;
      if (preview && preview.canStart === false) {
        throw new ValidationError("Bu iş başlatılamaz — önizlemede zorunlu bir alan eşleşmedi ya da işlenebilir kayıt yok.");
      }

      // §10.8.9 `defaultCurrency` — YALNIZCA `PRODUCTS` için anlamlıdır. Verilmezse `TRY`;
      // ISO-4217 3 harfli, büyük harfe normalize edilir; tanınmayan kod → 422.
      let defaultCurrency: string | undefined;
      if (job.type === "PRODUCTS") {
        defaultCurrency = (body.defaultCurrency ?? "TRY").toUpperCase();
        if (!ISO_4217_CURRENCY_CODES.has(defaultCurrency)) {
          throw new ValidationError("Geçersiz para birimi kodu.", {
            defaultCurrency: ["Tanınan bir ISO-4217 para birimi kodu olmalı (ör. TRY, USD, EUR)."],
          });
        }
      }

      const options = {
        fieldMapping: body.fieldMapping ?? preview?.suggestedMapping ?? {},
        duplicateStrategy,
        defaultStatus: body.defaultStatus ?? "DRAFT",
        defaultCurrency,
        defaultAuthorId: body.defaultAuthorId ?? null,
        defaultCategoryId: body.defaultCategoryId ?? null,
      };

      const updated = await app.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          duplicateStrategy: DUPLICATE_STRATEGY_TO_PRISMA[duplicateStrategy],
          options: options as unknown as Prisma.InputJsonValue,
        },
        include: { createdBy: true },
      });

      enqueueImportJob(app, job.id);

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "import.start",
        targetType: "ImportJob",
        targetId: job.id,
        // §10.8.9 — `PRODUCTS` işlerinde `defaultCurrency`/`defaultStatus` DA taşınır (bkz.
        // ARCHITECTURE.md §10.8.9 "Audit" maddesi). Ürün-bazlı `product.create` audit'i
        // BİLEREK YAZILMAZ (5.000 ürünlük bir aktarım AuditLog'u işe yaramaz biçimde şişirirdi).
        metadata: { type: job.type, totalCount: job.totalCount, duplicateStrategy, defaultStatus: options.defaultStatus, defaultCurrency },
        ipAddress: request.ip,
      });

      return reply.code(202).send(ok(toImportJobDto(updated)));
    }
  );

  server.post(
    "/:jobId/cancel",
    { schema: { params: ImportJobIdParamSchema, response: { 200: ApiSuccessSchema(ImportJobSchema) } } },
    async (request, reply) => {
      const job = await app.prisma.importJob.findUnique({ where: { id: request.params.jobId } });
      if (!job) throw new NotFoundError("İçe aktarma işi bulunamadı.");
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
        throw new ConflictError("İş zaten sonlanmış.");
      }

      // ATOMIC anında iptal — bkz. import.worker.ts::runImportJob'daki `updateMany` claim adımı.
      // Bu `updateMany` ile worker'ın `status: "QUEUED"` koşullu claim'i AYNI satır üzerinde
      // yarışır; Postgres satır kilidi sayesinde İKİSİNDEN YALNIZCA BİRİ `count: 1` görür —
      // koşulsuz bir `update` (eski kod) her ikisinin de "başarılı" olmasına, yani API'nin
      // `CANCELLED` dönmesine RAĞMEN worker'ın arka planda yazmaya devam etmesine yol açıyordu.
      const instantCancel = await app.prisma.importJob.updateMany({
        where: { id: job.id, status: { in: ["PENDING", "QUEUED"] } },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date() },
      });

      if (instantCancel.count === 0) {
        // Biz kaybettik — worker araya girip işi `PROCESSING`e claim etti (ya da iş bu sırada
        // zaten sonlandı). İşbirlikçi iptale düş: yalnızca hâlâ `PROCESSING` ise işaretle.
        const cooperative = await app.prisma.importJob.updateMany({
          where: { id: job.id, status: "PROCESSING" },
          data: { cancelRequestedAt: new Date() },
        });
        if (cooperative.count === 0) {
          throw new ConflictError("İş zaten sonlanmış.");
        }
      } else if (job.storagePath) {
        // Kayıt hiç yazılmadı (PENDING/QUEUED) — kaynak dosya güvenle silinebilir. Worker artık
        // bu job'ı claim EDEMEYECEK (yukarıdaki race'i kazandık), dosyayı okumaya çalışmayacak.
        await importStorage.remove(job.storagePath).catch(() => {});
      }

      const updated = await app.prisma.importJob.findUnique({ where: { id: job.id }, include: { createdBy: true } });
      if (!updated) throw new NotFoundError("İçe aktarma işi bulunamadı.");

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "import.cancel",
        targetType: "ImportJob",
        targetId: job.id,
        ipAddress: request.ip,
      });

      return reply.send(ok(toImportJobDto(updated)));
    }
  );

  server.get(
    "/:jobId/errors",
    {
      schema: {
        params: ImportJobIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(ImportJobErrorSchema), ImportJobErrorListMetaSchema) },
      },
    },
    async (request, reply) => {
      const job = await app.prisma.importJob.findUnique({
        where: { id: request.params.jobId },
        select: { id: true, errorCount: true, skippedCount: true },
      });
      if (!job) throw new NotFoundError("İçe aktarma işi bulunamadı.");

      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const [rows, storedRowCount] = await Promise.all([
        app.prisma.importJobError.findMany({
          where: { jobId: job.id, ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}) },
          orderBy: { seq: "asc" },
          take: limit,
        }),
        app.prisma.importJobError.count({ where: { jobId: job.id } }),
      ]);

      const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1]!.seq) : null;
      const truncated = storedRowCount >= IMPORT_ERROR_ROW_CAP && job.errorCount + job.skippedCount > storedRowCount;

      return reply.send(ok(rows.map(toImportJobErrorDto), { nextCursor, truncated }));
    }
  );
}
