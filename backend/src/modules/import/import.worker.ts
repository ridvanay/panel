import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma, SiteRole } from "@prisma/client";
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
import { IMPORT_BATCH_SIZE, IMPORT_ERROR_ROW_CAP, IMPORT_RECORD_CAPS, SEVERITY_TO_PRISMA } from "./import.constants";
import { applyFieldMapping } from "./lib/field-mapping";
import { sanitizeRichHtml as sanitizeImportedHtml } from "../../lib/html-sanitize";
import { parseTabular } from "./parsers/tabular.parser";
import { parseWxr, type WxrItem } from "./parsers/wxr.parser";
import { parseMediaZip } from "./parsers/zip.parser";
import { parsePriceToCents } from "./lib/price-parse";
import { derivePriceColumns } from "../../lib/product-pricing";
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
 *
 * §10.8.9.1 compliance-agent BLOKER düzeltmesi (2026-08-10) — `FAILED` yapılan işlerin ham
 * kaynak dosyası (`storagePath`), normal akışın `finally` bloğunda çağırdığı
 * `cleanupSourceFile` İLE AYNI best-effort desenle silinir; aksi hâlde büyük WordPress/
 * WooCommerce dosyaları (sipariş/müşteri PII'si taşıyabilir) sunucu çökmesi sonrası süresiz
 * öksüz kalırdı. Silme hatası job'u etkilemez (yalnızca loglanır).
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

  for (const job of stuck) {
    if (!job.storagePath) continue;
    await importStorage.remove(job.storagePath).catch((err) => {
      app.log.error({ err, jobId: job.id }, "Yarıda kalmış içe aktarma işinin kaynak dosyası silinemedi");
    });
    await app.prisma.importJob.update({ where: { id: job.id }, data: { storagePath: null } }).catch((err) => {
      app.log.error({ err, jobId: job.id }, "Yarıda kalmış içe aktarma işinin storagePath alanı temizlenemedi");
    });
  }
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
      case "PRODUCTS":
        await runProductsJob(app, ctx, buffer, options);
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

// `.claude/architect-scope-rbac-5-tier.md` §1 — 5 kademeli rol (`VIEWER` KALDIRILDI). Bu uç
// zaten yalnızca ADMIN tarafından çağrılabilir (§5.3 satır 6, (a): rol atayabilen içe aktarma).
const ALLOWED_ROLES = new Set(["ADMIN", "MANAGER", "EDITOR", "CUSTOMER", "USER"]);
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
    let role: SiteRole = "EDITOR";
    if (roleRaw) {
      if (!ALLOWED_ROLES.has(roleRaw)) {
        await ctx.recordRow({ severity: "error", rowNumber, code: "INVALID_ROLE", message: `Geçersiz rol: "${roleRaw}".`, field: "role", sourceRef: email, rawData: record });
        if (await ctx.maybeFlushAndCheckCancel(index, records.length)) break;
        continue;
      }
      role = roleRaw as SiteRole;
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
  const parsed = parseWxr(buffer, { allowedPostTypes: ["post", "page"], recordCap: IMPORT_RECORD_CAPS.WORDPRESS });
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
          // §10.8.6/§10.8.4 — `excerpt:encoded` de `content:encoded` İLE AYNI şekilde sanitize
          // edilir (ARCHITECTURE.md §10.8.4: "İçe aktarılan HER HTML alanı ... sanitize edilir").
          excerpt: item.excerpt ? sanitizeImportedHtml(item.excerpt) : null,
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
// PRODUCTS (WooCommerce WXR) — §10.8.9. AYNI `parseWxr` giriş noktası WORDPRESS ile
// PAYLAŞILIR (mimar kararı 2A güvenlik maddesi) — XXE/derinlik koruması İKİ KEZ YAZILMAZ.
// ---------------------------------------------------------------------------

interface WriteProductInput {
  baseSlug: string;
  /** Eşleştirme/tekillik anahtarı — doluysa `sku`, boşsa `null` (o zaman `baseSlug` kullanılır). */
  sku: string | null;
  duplicateStrategy: "skip" | "overwrite" | "createNew";
  title: string;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: Date | null;
  descriptionHtml: string;
  excerpt: string | null;
  priceCents: number;
  discountPriceCents: number | null;
  currency: string;
  stockQuantity: number;
  categoryId: string | null;
  authorId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  rowNumber: number;
  ctx: JobRunContext;
  rawData: unknown;
}

/**
 * §10.8.9 SKU/tekillik kuralı (karar 2E) — eşleştirme anahtarı `sku`'dur (varsa), `sku` boşsa
 * `slug`. `createNew` + SKU çakışması → satır ATLANIR (`ABC-1`/`ABC-1-2` iki ayrı stok kalemi
 * demek olurdu, envanteri sessizce bozar) — slug çakışması gibi `-2`/`-3` İLE ÇÖZÜLMEZ.
 * `taxRatePercent` HER ZAMAN `null` bırakılır (§10.8.9 KDV kuralı — export oran taşımaz),
 * `coverMediaId` HER ZAMAN `null` (§10.8.9 görsel kuralı — SSRF, `ProductImage` YAZILMAZ).
 */
async function writeProduct(app: FastifyInstance, input: WriteProductInput): Promise<void> {
  const existing = input.sku
    ? await app.prisma.product.findUnique({ where: { sku: input.sku } })
    : await app.prisma.product.findUnique({ where: { slug: input.baseSlug } });

  // §2.3/§2.4 (.claude/architect-scope-products-catalog.md, bağlayıcı) — katalog sıralama/
  // filtreleme kolonlarının TEK üretim noktası. `baseData` HEM create (2 dal) HEM overwrite
  // update dalında kullanılır — burada TEK yerde hesaplamak §2.4'ün "3 yazma yeri" (create ×2,
  // overwrite update) gereksinimini tek satırla karşılar.
  const { effectivePriceCents, discountPercent } = derivePriceColumns({
    priceCents: input.priceCents,
    discountPriceCents: input.discountPriceCents,
  });

  const baseData = {
    title: input.title,
    status: input.status,
    descriptionHtml: input.descriptionHtml,
    excerpt: input.excerpt,
    priceCents: input.priceCents,
    discountPriceCents: input.discountPriceCents,
    effectivePriceCents,
    discountPercent,
    currency: input.currency,
    sku: input.sku,
    taxRatePercent: null,
    stockQuantity: input.stockQuantity,
    categoryId: input.categoryId,
    coverMediaId: null,
    authorId: input.authorId,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    ogTitle: input.ogTitle,
    ogImageUrl: input.ogImageUrl,
    canonicalUrl: input.canonicalUrl,
    noIndex: input.noIndex,
  };

  if (!existing) {
    await app.prisma.product.create({ data: { ...baseData, slug: input.baseSlug, publishedAt: input.publishedAt } });
    input.ctx.recordSuccess();
    return;
  }

  if (input.duplicateStrategy === "skip") {
    await input.ctx.recordRow({
      severity: "skipped",
      rowNumber: input.rowNumber,
      code: "DUPLICATE_SKIPPED",
      message: input.sku ? `"${input.sku}" SKU'lu ürün zaten mevcut, atlandı.` : `"${input.baseSlug}" slug'ı zaten kullanılıyor, atlandı.`,
      sourceRef: input.sku ?? input.baseSlug,
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
        message: "Çöpteki ürün güncellenemez, atlandı.",
        sourceRef: input.sku ?? input.baseSlug,
        rawData: input.rawData,
      });
      return;
    }
    // `ctx.actor` — işi başlatan ADMIN (worker'da HTTP request context YOK, bkz. JobRunContext).
    if (input.ctx.actor) {
      await snapshotBeforeUpdate(
        app,
        "PRODUCT",
        existing.id,
        {
          title: existing.title,
          slug: existing.slug,
          excerpt: existing.excerpt,
          descriptionHtml: existing.descriptionHtml,
          priceCents: existing.priceCents,
          currency: existing.currency,
          taxRatePercent: existing.taxRatePercent ? Number(existing.taxRatePercent) : null,
          discountPriceCents: existing.discountPriceCents,
          sku: existing.sku,
          stockQuantity: existing.stockQuantity,
          categoryId: existing.categoryId,
          coverMediaId: existing.coverMediaId,
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
    // Slug DEĞİŞTİRİLMEZ (normal `PATCH` gibi davranır) — `writePage`/`writeBlogPost` ile AYNI desen.
    await app.prisma.product.update({
      where: { id: existing.id },
      data: { ...baseData, ...(input.publishedAt && !existing.publishedAt ? { publishedAt: input.publishedAt } : {}) },
    });
    input.ctx.recordSuccess();
    return;
  }

  // createNew — SKU çakışması ÇÖZÜLEMEZ (karar 2E): satır ATLANIR, "-2" İLE YENİ SKU UYDURULMAZ.
  if (input.sku) {
    await input.ctx.recordRow({
      severity: "skipped",
      rowNumber: input.rowNumber,
      code: "DUPLICATE_SKIPPED",
      message: `"${input.sku}" SKU'lu ürün zaten mevcut; SKU çakışması yeni kayıtla çözülemez, atlandı.`,
      sourceRef: input.sku,
      rawData: input.rawData,
    });
    return;
  }
  // SKU'suz ürün — yalnızca slug çakışıyordu, `-2`/`-3` ile serbestçe çoğaltılabilir.
  const availableSlug = await findAvailableSlug(
    async (slug) => Boolean(await app.prisma.product.findUnique({ where: { slug } })),
    input.baseSlug
  );
  await app.prisma.product.create({ data: { ...baseData, slug: availableSlug, publishedAt: input.publishedAt } });
  input.ctx.recordSuccess();
}

async function runProductsJob(app: FastifyInstance, ctx: JobRunContext, buffer: Buffer, options: StartImportJobRequest): Promise<void> {
  const parsed = parseWxr(buffer, { allowedPostTypes: ["product"], recordCap: IMPORT_RECORD_CAPS.PRODUCTS });
  const duplicateStrategy = options.duplicateStrategy ?? "skip";
  // §10.8.9 karar 2C — `defaultStatus` PRODUCTS'ta TÜM kayıtlara bir TAVAN olarak uygulanır
  // (WORDPRESS'in aksine `wp:status` YOK SAYILMAZ ama asla defaultStatus'u AŞAMAZ).
  const defaultStatus = options.defaultStatus ?? "DRAFT";
  const defaultCurrency = (options.defaultCurrency ?? "TRY").toUpperCase();

  // Ürün kategorisi (product_cat) → nicename bazlı upsert önbelleği (BlogCategory deseniyle AYNI).
  const categoryIdByNicename = new Map<string, string>();
  // Dosya İÇİNDE tekrarlanan SKU tespiti — DB'ye gitmeden, `Set` ile (bkz. ARCHITECTURE.md §10.8.9).
  const seenSkus = new Set<string>();

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

    const sku = item.sku;
    if (sku) {
      if (seenSkus.has(sku)) {
        await ctx.recordRow({
          severity: "skipped",
          rowNumber,
          code: "DUPLICATE_SKIPPED",
          message: `"${sku}" SKU'su dosya içinde tekrarlanıyor, atlandı.`,
          field: "sku",
          sourceRef,
          rawData: item,
        });
        if (await ctx.maybeFlushAndCheckCancel(index, items.length)) break;
        continue;
      }
      seenSkus.add(sku);
    }

    // ---- Fiyat kuralı (§10.8.9, en kritik madde) — string tabanlı tamsayı aritmetiği. ----
    const regularPriceRaw = item.regularPriceRaw?.trim() ? item.regularPriceRaw : item.priceRaw;
    if (!regularPriceRaw || !regularPriceRaw.trim()) {
      await ctx.recordRow({
        severity: "error",
        rowNumber,
        code: "REQUIRED_FIELD_MISSING",
        message: "Fiyat (_regular_price veya _price) zorunludur.",
        field: "priceCents",
        sourceRef,
        rawData: item,
      });
      if (await ctx.maybeFlushAndCheckCancel(index, items.length)) break;
      continue;
    }
    const priceCents = parsePriceToCents(regularPriceRaw);
    if (priceCents === null || priceCents <= 0) {
      await ctx.recordRow({
        severity: "error",
        rowNumber,
        code: "INVALID_VALUE",
        message: "Fiyat sayısal bir değer değil ya da 0/negatif.",
        field: "priceCents",
        sourceRef,
        rawData: item,
      });
      if (await ctx.maybeFlushAndCheckCancel(index, items.length)) break;
      continue;
    }

    // `_sale_price >= priceCents` (ya da ayrıştırılamıyor) → indirim düşürülür, satır yine
    // YAZILIR (bkz. ARCHITECTURE.md §10.8.9 fiyat kuralı madde 4) ama veri kalitesi için bir
    // `INVALID_VALUE` (severity: error) satırı da loglanır — `INVALID_DATE` (WORDPRESS) İLE
    // AYNI "alan düzeltilip kayıt yine de yazılır" deseni (bkz. writePage/writeBlogPost tarihi).
    let discountPriceCents: number | null = null;
    const salePriceRaw = item.salePriceRaw?.trim();
    if (salePriceRaw) {
      const parsedSale = parsePriceToCents(salePriceRaw);
      if (parsedSale !== null && parsedSale > 0 && parsedSale < priceCents) {
        discountPriceCents = parsedSale;
      } else {
        await ctx.recordRow({
          severity: "error",
          rowNumber,
          code: "INVALID_VALUE",
          message: "İndirimli fiyat (_sale_price) geçersiz veya normal fiyattan küçük değil; indirim yok sayıldı.",
          field: "discountPriceCents",
          sourceRef,
          rawData: item,
        });
      }
    }

    // ---- Stok kuralı ----
    const manageStock = item.manageStockRaw?.trim().toLowerCase() === "yes";
    let stockQuantity: number;
    if (manageStock) {
      const parsedStock = Number.parseInt(item.stockRaw ?? "", 10);
      stockQuantity = Number.isFinite(parsedStock) ? Math.max(0, parsedStock) : 0;
    } else {
      const stockStatus = item.stockStatusRaw?.trim().toLowerCase();
      stockQuantity = stockStatus === "instock" ? 1 : 0;
    }

    // ---- Durum (§2C tavanı) — sonuç `defaultStatus`'u AŞAMAZ. ----
    const sourceIsPublish = item.status === "publish";
    const status: "DRAFT" | "PUBLISHED" = sourceIsPublish && defaultStatus === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

    let publishedAt: Date | null = null;
    if (status === "PUBLISHED") {
      const rawDate = item.postDateGmt || item.postDate;
      const parsedDate = parseWpDate(rawDate);
      if (rawDate && !rawDate.startsWith("0000-00-00") && !parsedDate) {
        await ctx.recordRow({ severity: "error", rowNumber, code: "INVALID_DATE", message: "Yayın tarihi geçersiz, boş bırakıldı.", field: "publishedAt", sourceRef, rawData: item });
      }
      publishedAt = parsedDate ?? new Date();
    }

    // ---- Kategori (`<category domain="product_cat">`) — BlogCategory upsert deseniyle AYNI. ----
    let categoryId: string | null = options.defaultCategoryId ?? null;
    if (item.categoryNicename) {
      let id = categoryIdByNicename.get(item.categoryNicename);
      if (!id) {
        const category = await app.prisma.productCategory.upsert({
          where: { slug: slugify(item.categoryNicename) },
          create: { name: item.categoryName ?? item.categoryNicename, slug: slugify(item.categoryNicename) },
          update: {},
        });
        id = category.id;
        categoryIdByNicename.set(item.categoryNicename, id);
      }
      categoryId = id;
    }

    // ---- Yazar (dc:creator) — §10.8.6 ile AYNI, ASLA kullanıcı OLUŞTURMAZ. ----
    let authorId: string | null = options.defaultAuthorId ?? null;
    if (item.creatorLogin) {
      const author = parsed.authors.get(item.creatorLogin);
      if (author?.email) {
        const user = await app.prisma.user.findUnique({ where: { email: author.email.toLowerCase() }, select: { id: true } });
        if (user) authorId = user.id;
      }
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

    const descriptionHtml = sanitizeImportedHtml(item.contentHtml);
    const canonicalUrl = safeUrl(item.canonicalUrl);
    // `_thumbnail_id` → `ogImageUrl` YALNIZCA Yoast/RankMath boş bıraktıysa yedek kaynak (attachment
    // URL string'i olarak — `Media` kaydı OLUŞTURULMAZ, dosya İNDİRİLMEZ, SSRF kararı). `writePage`
    // (WORDPRESS) ile AYNI `?? resolvedThumbnailUrl ?? null` deseni.
    const ogImageUrl = item.ogImageUrl ?? item.resolvedThumbnailUrl ?? null;

    try {
      await writeProduct(app, {
        baseSlug,
        sku,
        duplicateStrategy,
        title,
        status,
        publishedAt,
        descriptionHtml,
        // §10.8.9/§10.8.4 — `excerpt:encoded` de `content:encoded` İLE AYNI şekilde sanitize
        // edilir (ARCHITECTURE.md §10.8.4: "İçe aktarılan HER HTML alanı ... sanitize edilir").
        excerpt: item.excerpt ? sanitizeImportedHtml(item.excerpt) : null,
        priceCents,
        discountPriceCents,
        currency: defaultCurrency,
        stockQuantity,
        categoryId,
        authorId,
        seoTitle: item.seoTitle,
        seoDescription: item.seoDescription,
        ogTitle: item.ogTitle,
        ogImageUrl,
        canonicalUrl,
        noIndex: item.noIndex,
        rowNumber,
        ctx,
        rawData: item,
      });
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
