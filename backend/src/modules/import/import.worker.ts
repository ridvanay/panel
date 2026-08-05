import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { logAudit } from "../../lib/audit";
import { hashPassword } from "../../lib/password";
import { slugify } from "../../lib/slug";
import { storage } from "../../lib/storage";
import { importStorage } from "../../lib/import-storage";
import { env } from "../../config/env";
import { createPasswordResetToken } from "../auth/auth.service";
import { sendPasswordResetEmail } from "../email-templates/email-templates.service";
import { snapshotBeforeUpdate } from "../../lib/content-revisions";
import type { ImportFieldMapping, ImportJobErrorCode, ImportJobType, ImportSourceFormat } from "../../schemas/entities";
import { IMPORT_BATCH_SIZE, IMPORT_ERROR_ROW_CAP, SEVERITY_TO_PRISMA } from "./import.constants";
import { applyFieldMapping } from "./lib/field-mapping";
import { sanitizeRichHtml as sanitizeImportedHtml } from "../../lib/html-sanitize";
import { parseTabular } from "./parsers/tabular.parser";
import { parseWxr, type WxrItem } from "./parsers/wxr.parser";
import { parseMediaZip } from "./parsers/zip.parser";
import type { StartImportJobRequest } from "./import.schemas";

// ---------------------------------------------------------------------------
// §10.8.1 Süreç-içi FIFO kuyruk — kuyruk altyapısı (BullMQ/Redis) YOK. Modül seviyesinde
// TEK bir dizi + "işleniyor" bayrağı, eşzamanlılık 1'i garanti eder. `setImmediate` ile
// tetiklenir, istek/yanıt döngüsünü BEKLETMEZ (bkz. ARCHITECTURE.md §10.8.1).
// ---------------------------------------------------------------------------
const queue: string[] = [];
let processing = false;

export function enqueueImportJob(app: FastifyInstance, jobId: string): void {
  queue.push(jobId);
  if (!processing) {
    processing = true;
    setImmediate(() => void drainQueue(app));
  }
}

async function drainQueue(app: FastifyInstance): Promise<void> {
  let jobId = queue.shift();
  while (jobId) {
    try {
      await runImportJob(app, jobId);
    } catch (err) {
      app.log.error({ err, jobId }, "İçe aktarma işi beklenmedik şekilde başarısız oldu");
      await app.prisma.importJob
        .update({
          where: { id: jobId },
          data: { status: "FAILED", errorSummary: "Beklenmeyen bir sunucu hatası oluştu.", finishedAt: new Date() },
        })
        .catch(() => {});
      await cleanupSourceFile(app, jobId);
    }
    jobId = queue.shift();
  }
  processing = false;
}

/**
 * §10.8.1 çökme/restart kurtarma — sunucu açılışında `QUEUED`/`PROCESSING`'de kalmış işler
 * `FAILED` yapılır. BU HOOK OLMADAN bu işler sonsuza dek `PROCESSING`'de asılı kalır ve
 * frontend'in 2 sn'lik poll'u sonsuza dek devam eder (bkz. ARCHITECTURE.md §10.8.1).
 */
export async function recoverStuckImportJobs(app: FastifyInstance): Promise<void> {
  const stuck = await app.prisma.importJob.findMany({
    where: { status: { in: ["QUEUED", "PROCESSING"] } },
    select: { id: true, storagePath: true },
  });
  if (stuck.length === 0) return;

  await app.prisma.importJob.updateMany({
    where: { id: { in: stuck.map((j) => j.id) } },
    data: { status: "FAILED", errorSummary: "Sunucu yeniden başlatıldığı için içe aktarma yarıda kaldı.", finishedAt: new Date() },
  });
  app.log.warn({ count: stuck.length }, "Yarıda kalmış içe aktarma işleri FAILED olarak işaretlendi (sunucu restart kurtarması)");
}

// ---------------------------------------------------------------------------
// Ortak yardımcılar
// ---------------------------------------------------------------------------

interface Counts {
  processed: number;
  success: number;
  error: number;
  skipped: number;
}

class JobRunContext {
  counts: Counts = { processed: 0, success: 0, error: 0, skipped: 0 };
  storedErrorRows = 0;
  cancelled = false;

  constructor(
    private readonly app: FastifyInstance,
    public readonly jobId: string,
    /** İşi başlatan ADMIN — `ContentRevision.editedById`/`AuditLog.actorId` için (worker'da HTTP request context YOK). */
    public readonly actor: { id: string; email: string | null } | null
  ) {}

  private truncateRawData(record: unknown): Prisma.InputJsonValue | undefined {
    if (record === undefined || record === null) return undefined;
    const json = JSON.stringify(record);
    if (json.length <= 8192) return record as Prisma.InputJsonValue;
    return { _truncated: true, _preview: json.slice(0, 8000) } as Prisma.InputJsonValue;
  }

  /** Satır hatası/atlama kaydı. 1.000 satır tavanı aşıldığında YAZMA DURUR, sayaç saymaya devam eder. */
  async recordRow(input: {
    severity: "error" | "skipped";
    rowNumber: number;
    code: ImportJobErrorCode;
    message: string;
    field?: string | null;
    sourceRef?: string | null;
    rawData?: unknown;
  }): Promise<void> {
    if (input.severity === "error") this.counts.error += 1;
    else this.counts.skipped += 1;

    if (this.storedErrorRows < IMPORT_ERROR_ROW_CAP) {
      this.storedErrorRows += 1;
      await this.app.prisma.importJobError.create({
        data: {
          jobId: this.jobId,
          rowNumber: input.rowNumber,
          code: input.code,
          message: input.message,
          severity: SEVERITY_TO_PRISMA[input.severity],
          field: input.field ?? null,
          sourceRef: input.sourceRef ?? null,
          rawData: this.truncateRawData(input.rawData),
        },
      });
    }
  }

  recordSuccess(): void {
    this.counts.success += 1;
  }

  /**
   * Her 25 kayıtta bir (ve döngü sonunda) sayaçları flush eder + iptal isteğini kontrol eder.
   *
   * `updateMany` KASITLI kullanılır (`update` DEĞİL): satır, cancel/delete uçlarıyla worker
   * arasındaki (artık atomic hale getirilmiş, bkz. `runImportJob` claim adımı ve
   * `import.routes.ts::cancel/delete`) race'lerin herhangi bir köşe durumunda hâlâ ortadan
   * kalkmış olabileceği ihtimaline karşı `update`'in `P2025` (kayıt bulunamadı) ile ÇÖKMESİNİ
   * önler — `updateMany` 0 satır etkilenirse sessizce `{ count: 0 }` döner, throw ETMEZ.
   */
  async maybeFlushAndCheckCancel(index: number, total: number): Promise<boolean> {
    this.counts.processed = this.counts.success + this.counts.error + this.counts.skipped;
    const isBatchBoundary = (index + 1) % IMPORT_BATCH_SIZE === 0 || index + 1 === total;
    if (!isBatchBoundary) return false;

    const updateResult = await this.app.prisma.importJob.updateMany({
      where: { id: this.jobId },
      data: {
        processedCount: this.counts.processed,
        successCount: this.counts.success,
        errorCount: this.counts.error,
        skippedCount: this.counts.skipped,
      },
    });

    // Satır artık yok (beklenmedik köşe durumu) — daha fazla yazma denemeden işlemi durdur.
    if (updateResult.count === 0) {
      this.cancelled = true;
      return true;
    }

    const current = await this.app.prisma.importJob.findUnique({ where: { id: this.jobId }, select: { cancelRequestedAt: true } });
    if (current?.cancelRequestedAt) {
      this.cancelled = true;
      return true;
    }
    return false;
  }
}

async function cleanupSourceFile(app: FastifyInstance, jobId: string): Promise<void> {
  const job = await app.prisma.importJob.findUnique({ where: { id: jobId }, select: { storagePath: true } });
  if (job?.storagePath) {
    await importStorage.remove(job.storagePath).catch(() => {});
    await app.prisma.importJob.update({ where: { id: jobId }, data: { storagePath: null } }).catch(() => {});
  }
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

function parseWpDate(raw: string | null): Date | null {
  if (!raw) return null;
  // WordPress NULL sentinel — parse hatası DEĞİL (bkz. ARCHITECTURE.md §10.8.6).
  if (raw.startsWith("0000-00-00")) return null;
  const date = new Date(raw.includes(" ") ? raw.replace(" ", "T") + "Z" : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Slug çakışmasında `-2`, `-3` … ekleyerek boş bir slug bulur (`createNew` stratejisi). */
async function findAvailableSlug(
  check: (slug: string) => Promise<boolean>,
  base: string
): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (await check(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Ana dispatcher
// ---------------------------------------------------------------------------

export async function runImportJob(app: FastifyInstance, jobId: string): Promise<void> {
  const job = await app.prisma.importJob.findUnique({ where: { id: jobId }, include: { createdBy: { select: { id: true, email: true } } } });
  if (!job || job.status !== "QUEUED") return;

  // ATOMIC claim — `POST .../cancel` (bkz. import.routes.ts) `PENDING`/`QUEUED` bir işi ANINDA
  // `CANCELLED` yapabilir; yukarıdaki `findUnique` ile buradaki claim arasında bir istemci
  // cancel çağırırsa, koşulsuz bir `update` her ikisinin de "başarıyla" yazmasına (worker
  // arka planda çalışmaya devam ederken client'a `CANCELLED`/`successCount: 0` dönmesine) yol
  // açardı — dokümante edilen "PENDING/QUEUED bir iş anında CANCELLED olur, hiç kayıt
  // yazılmamıştır" invariant'ını ihlal eder. `updateMany({ where: { status: "QUEUED" } })`
  // Postgres'in satır seviyesi kilidiyle bunu atomic hale getirir: iki taraftan yalnızca BİRİ
  // `count: 1` görür: cancel kazanırsa worker burada `count: 0` görüp SESSİZCE çıkar (hiçbir
  // kayıt yazmadan) — yarış koşulu tamamen kapanır.
  const claim = await app.prisma.importJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (claim.count === 0) return;

  const ctx = new JobRunContext(app, jobId, job.createdBy ? { id: job.createdBy.id, email: job.createdBy.email } : null);
  const options = (job.options as unknown as StartImportJobRequest) ?? {};

  try {
    if (!job.storagePath) throw new Error("Kaynak dosya bulunamadı.");
    const buffer = await importStorage.read(job.storagePath);

    switch (job.type as ImportJobType) {
      case "PAGES":
        await runTabularContentJob(app, ctx, "PAGES", job.format, buffer, options);
        break;
      case "BLOG":
        await runTabularContentJob(app, ctx, "BLOG", job.format, buffer, options);
        break;
      case "USERS":
        await runUsersJob(app, ctx, buffer, options);
        break;
      case "WORDPRESS":
        await runWordpressJob(app, ctx, buffer, options);
        break;
      case "MEDIA":
        await runMediaJob(app, ctx, buffer, options);
        break;
      default:
        throw new Error(`Desteklenmeyen içe aktarma türü: ${job.type}`);
    }

    const finalStatus = ctx.cancelled ? "CANCELLED" : "COMPLETED";
    // `updateMany` — bkz. JobRunContext.maybeFlushAndCheckCancel üstündeki not; satır teorik
    // olarak burada da yok olmuş olabilir (ör. beklenmedik bir köşe durumu), `update` bu
    // durumda `P2025` ile ÇÖKERDİ. 0 satır etkilenirse sessizce no-op.
    await app.prisma.importJob.updateMany({
      where: { id: jobId },
      data: {
        status: finalStatus,
        processedCount: ctx.counts.processed,
        successCount: ctx.counts.success,
        errorCount: ctx.counts.error,
        skippedCount: ctx.counts.skipped,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    app.log.error({ err, jobId }, "İçe aktarma işi hata ile sonlandı");
    await app.prisma.importJob.updateMany({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorSummary: err instanceof Error ? err.message : "Bilinmeyen hata.",
        processedCount: ctx.counts.processed,
        successCount: ctx.counts.success,
        errorCount: ctx.counts.error,
        skippedCount: ctx.counts.skipped,
        finishedAt: new Date(),
      },
    });
  } finally {
    await cleanupSourceFile(app, jobId);
  }
}

// ---------------------------------------------------------------------------
// PAGES / BLOG (CSV/JSON)
// ---------------------------------------------------------------------------

async function runTabularContentJob(
  app: FastifyInstance,
  ctx: JobRunContext,
  type: "PAGES" | "BLOG",
  format: ImportSourceFormat,
  buffer: Buffer,
  options: StartImportJobRequest
): Promise<void> {
  const { records } = parseTabular(buffer, format);
  const mapping: ImportFieldMapping = options.fieldMapping ?? {};
  const duplicateStrategy = options.duplicateStrategy ?? "skip";
  const defaultStatus = options.defaultStatus ?? "DRAFT";

  for (let index = 0; index < records.length; index++) {
    const rowNumber = index + 1;
    const record = records[index]!;
    const mapped = applyFieldMapping(record, mapping);

    const title = typeof mapped.title === "string" ? mapped.title.trim() : "";
    if (!title) {
      await ctx.recordRow({
        severity: "error",
        rowNumber,
        code: "REQUIRED_FIELD_MISSING",
        message: "Başlık (title) zorunludur.",
        field: "title",
        rawData: record,
      });
      if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
      continue;
    }

    const rawSlug = typeof mapped.slug === "string" && mapped.slug.trim() ? mapped.slug : title;
    const baseSlug = slugify(rawSlug);

    const normalizedStatusInput = typeof mapped.status === "string" ? mapped.status.trim().toUpperCase() : undefined;
    const status = normalizedStatusInput === "DRAFT" || normalizedStatusInput === "PUBLISHED" ? normalizedStatusInput : defaultStatus;

    let publishedAt: Date | null = null;
    if (status === "PUBLISHED") {
      if (typeof mapped.publishedAt === "string" && mapped.publishedAt.trim()) {
        const parsed = new Date(mapped.publishedAt);
        if (Number.isNaN(parsed.getTime())) {
          await ctx.recordRow({
            severity: "error",
            rowNumber,
            code: "INVALID_DATE",
            message: "Yayın tarihi geçersiz, boş bırakıldı.",
            field: "publishedAt",
            sourceRef: baseSlug,
            rawData: record,
          });
        } else {
          publishedAt = parsed;
        }
      }
      if (!publishedAt) publishedAt = new Date();
    }

    let categoryId: string | null | undefined;
    if (type === "BLOG") {
      const categoryName = typeof mapped.categoryName === "string" ? mapped.categoryName.trim() : "";
      if (categoryName) {
        const category = await app.prisma.blogCategory.upsert({
          where: { slug: slugify(categoryName) },
          create: { name: categoryName, slug: slugify(categoryName) },
          update: {},
        });
        categoryId = category.id;
      } else {
        categoryId = options.defaultCategoryId ?? null;
      }
    }

    let authorId: string | null = options.defaultAuthorId ?? null;
    const authorEmail = typeof mapped.authorEmail === "string" ? mapped.authorEmail.trim().toLowerCase() : "";
    if (authorEmail) {
      const author = await app.prisma.user.findUnique({ where: { email: authorEmail }, select: { id: true } });
      if (author) authorId = author.id;
    }

    const contentHtmlRaw = typeof mapped.contentHtml === "string" ? mapped.contentHtml : "";
    const sanitizedHtml = sanitizeImportedHtml(contentHtmlRaw);

    const seoTitle = typeof mapped.seoTitle === "string" ? mapped.seoTitle : null;
    const seoDescription = typeof mapped.seoDescription === "string" ? mapped.seoDescription : null;
    const ogTitle = typeof mapped.ogTitle === "string" ? mapped.ogTitle : null;
    const ogImageUrl = typeof mapped.ogImageUrl === "string" ? mapped.ogImageUrl : null;
    const canonicalUrl = safeUrl(typeof mapped.canonicalUrl === "string" ? mapped.canonicalUrl : null);
    const noIndexRaw = typeof mapped.noIndex === "string" ? mapped.noIndex.trim().toLowerCase() : mapped.noIndex;
    const noIndex = noIndexRaw === true || noIndexRaw === "true" || noIndexRaw === "1" || noIndexRaw === "evet";

    try {
      if (type === "PAGES") {
        await writePage(app, {
          baseSlug,
          duplicateStrategy,
          title,
          status: status as "DRAFT" | "PUBLISHED",
          publishedAt,
          contentHtml: sanitizedHtml,
          seoTitle,
          seoDescription,
          ogTitle,
          ogImageUrl,
          canonicalUrl,
          noIndex,
          authorId,
          rowNumber,
          ctx,
          rawData: record,
        });
      } else {
        await writeBlogPost(app, {
          baseSlug,
          duplicateStrategy,
          title,
          status: status as "DRAFT" | "PUBLISHED",
          publishedAt,
          contentHtml: sanitizedHtml,
          excerpt: typeof mapped.excerpt === "string" ? mapped.excerpt : null,
          coverImageUrl: typeof mapped.coverImageUrl === "string" ? mapped.coverImageUrl : null,
          categoryId: categoryId ?? null,
          seoTitle,
          seoDescription,
          ogTitle,
          ogImageUrl,
          canonicalUrl,
          noIndex,
          authorId,
          rowNumber,
          ctx,
          rawData: record,
        });
      }
    } catch (err) {
      await ctx.recordRow({
        severity: "error",
        rowNumber,
        code: "DB_ERROR",
        message: `Kayıt yazılamadı: ${(err as Error).message}`,
        sourceRef: baseSlug,
        rawData: record,
      });
    }

    if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
  }
}

interface WritePageInput {
  baseSlug: string;
  duplicateStrategy: "skip" | "overwrite" | "createNew";
  title: string;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: Date | null;
  contentHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  authorId: string | null;
  rowNumber: number;
  ctx: JobRunContext;
  rawData: unknown;
}

async function writePage(app: FastifyInstance, input: WritePageInput): Promise<void> {
  const blocks = input.contentHtml ? [{ id: crypto.randomUUID(), type: "text", data: { html: input.contentHtml } }] : [];
  const existing = await app.prisma.page.findUnique({ where: { slug: input.baseSlug } });

  if (existing) {
    if (input.duplicateStrategy === "skip") {
      await input.ctx.recordRow({
        severity: "skipped",
        rowNumber: input.rowNumber,
        code: "DUPLICATE_SKIPPED",
        message: `"${input.baseSlug}" slug'ı zaten kullanılıyor, atlandı.`,
        sourceRef: input.baseSlug,
        rawData: input.rawData,
      });
      return;
    }
    if (input.duplicateStrategy === "overwrite") {
      if (existing.deletedAt) {
        await input.ctx.recordRow({
          severity: "error",
          rowNumber: input.rowNumber,
          code: "TARGET_TRASHED",
          message: "Çöpteki içerik güncellenemez, atlandı.",
          sourceRef: input.baseSlug,
          rawData: input.rawData,
        });
        return;
      }
      // `ctx.actor` — işi başlatan ADMIN (worker'da HTTP request context YOK, bkz. JobRunContext).
      // Actor artık DB'de yoksa (silinmiş kullanıcı) snapshot atlanır, overwrite yine de devam eder.
      if (input.ctx.actor) {
        await snapshotBeforeUpdate(
          app,
          "PAGE",
          existing.id,
          {
            title: existing.title,
            slug: existing.slug,
            blocks: existing.blocks,
            seoTitle: existing.seoTitle,
            seoDescription: existing.seoDescription,
            ogTitle: existing.ogTitle,
            ogImageUrl: existing.ogImageUrl,
            canonicalUrl: existing.canonicalUrl,
            noIndex: existing.noIndex,
            translations: existing.translations,
          },
          input.ctx.actor.id
        );
      }
      await app.prisma.page.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          status: input.status,
          blocks: blocks as Prisma.InputJsonValue,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          ogTitle: input.ogTitle,
          ogImageUrl: input.ogImageUrl,
          canonicalUrl: input.canonicalUrl,
          noIndex: input.noIndex,
          ...(input.publishedAt && !existing.publishedAt ? { publishedAt: input.publishedAt } : {}),
          ...(input.authorId ? { authorId: input.authorId } : {}),
        },
      });
      input.ctx.recordSuccess();
      return;
    }
    // createNew
    const available = await findAvailableSlug(async (slug) => Boolean(await app.prisma.page.findUnique({ where: { slug } })), input.baseSlug);
    await app.prisma.page.create({
      data: {
        title: input.title,
        slug: available,
        status: input.status,
        blocks: blocks as Prisma.InputJsonValue,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        ogTitle: input.ogTitle,
        ogImageUrl: input.ogImageUrl,
        canonicalUrl: input.canonicalUrl,
        noIndex: input.noIndex,
        publishedAt: input.publishedAt,
        authorId: input.authorId,
      },
    });
    input.ctx.recordSuccess();
    return;
  }

  await app.prisma.page.create({
    data: {
      title: input.title,
      slug: input.baseSlug,
      status: input.status,
      blocks: blocks as Prisma.InputJsonValue,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      ogTitle: input.ogTitle,
      ogImageUrl: input.ogImageUrl,
      canonicalUrl: input.canonicalUrl,
      noIndex: input.noIndex,
      publishedAt: input.publishedAt,
      authorId: input.authorId,
    },
  });
  input.ctx.recordSuccess();
}

interface WriteBlogPostInput extends Omit<WritePageInput, "ogImageUrl"> {
  excerpt: string | null;
  coverImageUrl: string | null;
  categoryId: string | null;
  ogImageUrl: string | null;
}

async function writeBlogPost(app: FastifyInstance, input: WriteBlogPostInput): Promise<void> {
  const existing = await app.prisma.blogPost.findUnique({ where: { slug: input.baseSlug } });

  if (existing) {
    if (input.duplicateStrategy === "skip") {
      await input.ctx.recordRow({
        severity: "skipped",
        rowNumber: input.rowNumber,
        code: "DUPLICATE_SKIPPED",
        message: `"${input.baseSlug}" slug'ı zaten kullanılıyor, atlandı.`,
        sourceRef: input.baseSlug,
        rawData: input.rawData,
      });
      return;
    }
    if (input.duplicateStrategy === "overwrite") {
      if (existing.deletedAt) {
        await input.ctx.recordRow({
          severity: "error",
          rowNumber: input.rowNumber,
          code: "TARGET_TRASHED",
          message: "Çöpteki içerik güncellenemez, atlandı.",
          sourceRef: input.baseSlug,
          rawData: input.rawData,
        });
        return;
      }
      if (input.ctx.actor) {
        await snapshotBeforeUpdate(
          app,
          "BLOG_POST",
          existing.id,
          {
            title: existing.title,
            slug: existing.slug,
            excerpt: existing.excerpt,
            contentHtml: existing.contentHtml,
            coverImageUrl: existing.coverImageUrl,
            categoryId: existing.categoryId,
            seoTitle: existing.seoTitle,
            seoDescription: existing.seoDescription,
            ogTitle: existing.ogTitle,
            ogImageUrl: existing.ogImageUrl,
            canonicalUrl: existing.canonicalUrl,
            noIndex: existing.noIndex,
            translations: existing.translations,
          },
          input.ctx.actor.id
        );
      }
      await app.prisma.blogPost.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          status: input.status,
          contentHtml: input.contentHtml,
          excerpt: input.excerpt,
          coverImageUrl: input.coverImageUrl,
          categoryId: input.categoryId,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          ogTitle: input.ogTitle,
          ogImageUrl: input.ogImageUrl,
          canonicalUrl: input.canonicalUrl,
          noIndex: input.noIndex,
          ...(input.publishedAt && !existing.publishedAt ? { publishedAt: input.publishedAt } : {}),
          ...(input.authorId ? { authorId: input.authorId } : {}),
        },
      });
      input.ctx.recordSuccess();
      return;
    }
    const available = await findAvailableSlug(
      async (slug) => Boolean(await app.prisma.blogPost.findUnique({ where: { slug } })),
      input.baseSlug
    );
    await app.prisma.blogPost.create({
      data: {
        title: input.title,
        slug: available,
        status: input.status,
        contentHtml: input.contentHtml,
        excerpt: input.excerpt,
        coverImageUrl: input.coverImageUrl,
        categoryId: input.categoryId,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        ogTitle: input.ogTitle,
        ogImageUrl: input.ogImageUrl,
        canonicalUrl: input.canonicalUrl,
        noIndex: input.noIndex,
        publishedAt: input.publishedAt,
        authorId: input.authorId,
      },
    });
    input.ctx.recordSuccess();
    return;
  }

  await app.prisma.blogPost.create({
    data: {
      title: input.title,
      slug: input.baseSlug,
      status: input.status,
      contentHtml: input.contentHtml,
      excerpt: input.excerpt,
      coverImageUrl: input.coverImageUrl,
      categoryId: input.categoryId,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      ogTitle: input.ogTitle,
      ogImageUrl: input.ogImageUrl,
      canonicalUrl: input.canonicalUrl,
      noIndex: input.noIndex,
      publishedAt: input.publishedAt,
      authorId: input.authorId,
    },
  });
  input.ctx.recordSuccess();
}

// ---------------------------------------------------------------------------
// USERS (CSV) — §10.8.7. `duplicateStrategy` her zaman `skip`tir (start() ucunda garanti edilir).
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = new Set(["ADMIN", "EDITOR", "VIEWER"]);
let lastEmailSentAt = 0;

/** E-posta gönderimini ~10/sn ile kısar (bkz. ARCHITECTURE.md §10.8.7 — SMTP sağlayıcı koruması). */
async function throttleEmail(): Promise<void> {
  const minGapMs = 100;
  const elapsed = Date.now() - lastEmailSentAt;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastEmailSentAt = Date.now();
}

async function runUsersJob(app: FastifyInstance, ctx: JobRunContext, buffer: Buffer, options: StartImportJobRequest): Promise<void> {
  const { records } = parseTabular(buffer, "CSV");
  const mapping: ImportFieldMapping = options.fieldMapping ?? {};

  for (let index = 0; index < records.length; index++) {
    const rowNumber = index + 1;
    const record = records[index]!;
    const mapped = applyFieldMapping(record, mapping);

    const email = typeof mapped.email === "string" ? mapped.email.trim().toLowerCase() : "";
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!email) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "REQUIRED_FIELD_MISSING", message: "E-posta zorunludur.", field: "email", rawData: record });
      if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
      continue;
    }
    if (!emailValid) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "INVALID_EMAIL", message: "Geçersiz e-posta adresi.", field: "email", sourceRef: email, rawData: record });
      if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
      continue;
    }

    const roleRaw = typeof mapped.role === "string" ? mapped.role.trim().toUpperCase() : "";
    let role: "ADMIN" | "EDITOR" | "VIEWER" = "EDITOR";
    if (roleRaw) {
      if (!ALLOWED_ROLES.has(roleRaw)) {
        await ctx.recordRow({ severity: "error", rowNumber, code: "INVALID_ROLE", message: `Geçersiz rol: "${roleRaw}".`, field: "role", sourceRef: email, rawData: record });
        if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
        continue;
      }
      role = roleRaw as "ADMIN" | "EDITOR" | "VIEWER";
    }

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // §10.8.8.1 compliance-agent kararı (2026-08-05, BLOCKER) — `rawData` BİLEREK
      // YAZILMAZ: bu satır importu YÜKLEYEN kişinin değil, sistemde ZATEN var olan BAŞKA bir
      // kullanıcının PII'sini (ad/e-posta/rol) taşırdı — teşhis değeri sıfır, "hangi e-posta
      // çakıştı" bilgisi zaten `sourceRef: email`'de var. Veri minimizasyonu (KVKK m.4/2-c,
      // GDPR Art. 5(1)(c)).
      await ctx.recordRow({ severity: "skipped", rowNumber, code: "DUPLICATE_SKIPPED", message: `"${email}" zaten kayıtlı, atlandı.`, sourceRef: email });
      if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
      continue;
    }

    const name = typeof mapped.name === "string" && mapped.name.trim() ? mapped.name.trim() : email.split("@")[0]!;

    try {
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
      const user = await app.prisma.user.create({ data: { name, email, passwordHash, role } });

      await logAudit(app, {
        actorId: ctx.actor?.id ?? null,
        actorEmail: ctx.actor?.email ?? null,
        action: "user.create",
        targetType: "User",
        targetId: user.id,
        metadata: { email: user.email, role: user.role, importJobId: ctx.jobId },
      });

      try {
        await throttleEmail();
        const rawToken = await createPasswordResetToken(app, user.id);
        const setPasswordUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
        await sendPasswordResetEmail(app, { email: user.email, name: user.name }, setPasswordUrl);
        ctx.recordSuccess();
      } catch (mailErr) {
        app.log.error({ err: mailErr, userId: user.id }, "İçe aktarma: şifre belirleme e-postası gönderilemedi");
        await ctx.recordRow({
          severity: "error",
          rowNumber,
          code: "EMAIL_DELIVERY_FAILED",
          message: "Kullanıcı oluşturuldu ama davet e-postası gönderilemedi.",
          sourceRef: email,
          rawData: record,
        });
      }
    } catch (err) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "DB_ERROR", message: `Kullanıcı oluşturulamadı: ${(err as Error).message}`, sourceRef: email, rawData: record });
    }

    if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
  }
}

// ---------------------------------------------------------------------------
// WORDPRESS (WXR/XML) — §10.8.6
// ---------------------------------------------------------------------------

async function runWordpressJob(app: FastifyInstance, ctx: JobRunContext, buffer: Buffer, options: StartImportJobRequest): Promise<void> {
  const parsed = parseWxr(buffer);
  const duplicateStrategy = options.duplicateStrategy ?? "skip";

  // Kategorileri baştan upsert et (WXR'dan) → nicename -> id sözlüğü.
  const categoryIdByNicename = new Map<string, string>();
  for (const [nicename, name] of parsed.categories) {
    const category = await app.prisma.blogCategory.upsert({
      where: { slug: slugify(nicename) },
      create: { name, slug: slugify(nicename) },
      update: {},
    });
    categoryIdByNicename.set(nicename, category.id);
  }

  // Yazar e-postalarını toplu çöz.
  const candidateEmails = Array.from(new Set(Array.from(parsed.authors.values()).map((a) => a.email).filter((e): e is string => Boolean(e)))).map(
    (e) => e.toLowerCase()
  );
  const users = candidateEmails.length > 0 ? await app.prisma.user.findMany({ where: { email: { in: candidateEmails } } }) : [];
  const userIdByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  function resolveAuthor(item: WxrItem): string | null {
    if (item.creatorLogin) {
      const author = parsed.authors.get(item.creatorLogin);
      if (author?.email) {
        const id = userIdByEmail.get(author.email.toLowerCase());
        if (id) return id;
      }
    }
    return options.defaultAuthorId ?? null;
  }

  const items = parsed.items;
  for (let index = 0; index < items.length; index++) {
    const rowNumber = index + 1;
    const item = items[index]!;
    const sourceRef = item.postId ?? item.guid ?? item.link ?? undefined;

    const title = item.title.trim();
    if (!title) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "REQUIRED_FIELD_MISSING", message: "Başlık (title) zorunludur.", field: "title", sourceRef, rawData: item });
      if (await ctx.maybeFlushAndCheckCancel(index, items.length)) break;
      continue;
    }

    let decodedSlug: string | null = null;
    if (item.slugRaw) {
      try {
        decodedSlug = decodeURIComponent(item.slugRaw);
      } catch {
        decodedSlug = item.slugRaw;
      }
    }
    const baseSlug = slugify(decodedSlug || title);

    const status: "DRAFT" | "PUBLISHED" = item.status === "publish" ? "PUBLISHED" : "DRAFT";

    let publishedAt: Date | null = null;
    if (status === "PUBLISHED") {
      const rawDate = item.postDateGmt || item.postDate;
      const parsedDate = parseWpDate(rawDate);
      if (rawDate && !rawDate.startsWith("0000-00-00") && !parsedDate) {
        await ctx.recordRow({ severity: "error", rowNumber, code: "INVALID_DATE", message: "Yayın tarihi geçersiz, boş bırakıldı.", field: "publishedAt", sourceRef, rawData: item });
      }
      publishedAt = parsedDate ?? new Date();
    }

    const authorId = resolveAuthor(item);
    const sanitizedHtml = sanitizeImportedHtml(item.contentHtml);
    const canonicalUrl = safeUrl(item.canonicalUrl);
    const ogImageUrl = item.ogImageUrl ?? item.resolvedThumbnailUrl ?? null;

    try {
      if (item.postType === "page") {
        await writePage(app, {
          baseSlug,
          duplicateStrategy,
          title,
          status,
          publishedAt,
          contentHtml: sanitizedHtml,
          seoTitle: item.seoTitle,
          seoDescription: item.seoDescription,
          ogTitle: item.ogTitle,
          ogImageUrl,
          canonicalUrl,
          noIndex: item.noIndex,
          authorId,
          rowNumber,
          ctx,
          rawData: item,
        });
      } else {
        // `defaultCategoryId` WORDPRESS'te YOK SAYILIR — kategoriler WXR'dan upsert edilir (bkz. StartImportJobRequest açıklaması).
        const categoryId = item.categoryNicename ? (categoryIdByNicename.get(item.categoryNicename) ?? null) : null;
        await writeBlogPost(app, {
          baseSlug,
          duplicateStrategy,
          title,
          status,
          publishedAt,
          contentHtml: sanitizedHtml,
          excerpt: item.excerpt,
          coverImageUrl: item.resolvedThumbnailUrl,
          categoryId,
          seoTitle: item.seoTitle,
          seoDescription: item.seoDescription,
          ogTitle: item.ogTitle,
          ogImageUrl: item.ogImageUrl,
          canonicalUrl,
          noIndex: item.noIndex,
          authorId,
          rowNumber,
          ctx,
          rawData: item,
        });
      }
    } catch (err) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "DB_ERROR", message: `Kayıt yazılamadı: ${(err as Error).message}`, sourceRef, rawData: item });
    }

    if (await ctx.maybeFlushAndCheckCancel(index, items.length)) break;
  }
}

// ---------------------------------------------------------------------------
// MEDIA (ZIP) — §10.8.7
// ---------------------------------------------------------------------------

async function runMediaJob(app: FastifyInstance, ctx: JobRunContext, buffer: Buffer, options: StartImportJobRequest): Promise<void> {
  const { entries } = await parseMediaZip(buffer);
  const duplicateStrategy = options.duplicateStrategy ?? "skip";

  for (let index = 0; index < entries.length; index++) {
    const rowNumber = index + 1;
    const entry = entries[index]!;
    const filename = entry.name.split("/").pop() ?? entry.name;

    if (entry.pathUnsafe) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "INVALID_VALUE", message: "Güvensiz dosya yolu, atlandı.", field: "filename", sourceRef: entry.name, rawData: { name: entry.name } });
      if (await ctx.maybeFlushAndCheckCancel(index, entries.length)) break;
      continue;
    }
    if (entry.isSvg) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "UNSUPPORTED_MIME", message: "SVG dosyaları güvenlik nedeniyle içe aktarılamaz.", field: "mimeType", sourceRef: filename, rawData: { name: entry.name } });
      if (await ctx.maybeFlushAndCheckCancel(index, entries.length)) break;
      continue;
    }
    if (!entry.mimeType) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "UNSUPPORTED_MIME", message: "Tanınmayan dosya türü.", field: "mimeType", sourceRef: filename, rawData: { name: entry.name } });
      if (await ctx.maybeFlushAndCheckCancel(index, entries.length)) break;
      continue;
    }

    try {
      const existing = await app.prisma.media.findFirst({ where: { filename } });
      if (existing) {
        if (duplicateStrategy === "skip") {
          await ctx.recordRow({ severity: "skipped", rowNumber, code: "DUPLICATE_SKIPPED", message: `"${filename}" zaten mevcut, atlandı.`, sourceRef: filename, rawData: { name: entry.name } });
        } else {
          const saved = await storage.save({ buffer: entry.buffer, filename, mimeType: entry.mimeType });
          await app.prisma.media.update({
            where: { id: existing.id },
            data: { path: saved.path, url: saved.url, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes },
          });
          await storage.remove(existing.path).catch(() => {});
          ctx.recordSuccess();
        }
      } else {
        const saved = await storage.save({ buffer: entry.buffer, filename, mimeType: entry.mimeType });
        await app.prisma.media.create({
          data: { path: saved.path, url: saved.url, filename, mimeType: entry.mimeType, sizeBytes: entry.sizeBytes },
        });
        ctx.recordSuccess();
      }
    } catch (err) {
      await ctx.recordRow({ severity: "error", rowNumber, code: "DB_ERROR", message: `Dosya yazılamadı: ${(err as Error).message}`, sourceRef: filename, rawData: { name: entry.name } });
    }

    if (await ctx.maybeFlushAndCheckCancel(index, entries.length)) break;
  }
}
