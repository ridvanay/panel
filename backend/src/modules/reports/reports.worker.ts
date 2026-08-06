import type { FastifyInstance } from "fastify";
import { logAudit } from "../../lib/audit";
import { maskEmail } from "../../lib/pii-mask";
import { exportStorage } from "../../lib/export-storage";
import {
  getBreakdown,
  getSummaryStats,
  getTopContent,
  getViewsSeries,
  resolveStatsRange,
  type DateRange,
} from "../../lib/stats-query";
import type { StatsGranularity } from "../../lib/date";
import type { ExportJobType } from "../../schemas/entities";
import { toCsv, toPdf, type ExportCellValue } from "./reports.format";
import { EXPORT_ROW_CAPS } from "./reports.constants";
import type { ExportFilters } from "./reports.schemas";

// ---------------------------------------------------------------------------
// §10.8.10 — `import.worker.ts` BİREBİR AYNI süreç-içi FIFO kuyruk deseni (kuyruk altyapısı
// YOK, modül-seviyesi dizi + `setImmediate`, tek-instance eşzamanlılık 1 varsayımı).
// ---------------------------------------------------------------------------
const queue: string[] = [];
let processing = false;

export function enqueueExportJob(app: FastifyInstance, jobId: string): void {
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
      await runExportJob(app, jobId);
    } catch (err) {
      app.log.error({ err, jobId }, "Rapor dışa aktarma işi beklenmedik şekilde başarısız oldu");
      await app.prisma.exportJob
        .update({ where: { id: jobId }, data: { status: "FAILED", errorSummary: "Beklenmeyen bir sunucu hatası oluştu.", finishedAt: new Date() } })
        .catch(() => {});
    }
    jobId = queue.shift();
  }
  processing = false;
}

/**
 * §10.8.10 çökme/restart kurtarma — `import.worker.ts::recoverStuckImportJobs` İLE AYNI
 * GEREKÇE: `PROCESSING`'de kalmış işler `FAILED` yapılır. Ayrıca `PENDING` işler (in-process
 * kuyruk restart'ta KAYBOLUR, ExportJob'da `QUEUED` ara durumu YOK — `POST /` hem oluşturur
 * hem AYNI ANDA kuyruğa alır, bkz. reports.routes.ts) süresi dolmamışsa `seq ASC` (FIFO)
 * sırayla yeniden kuyruğa alınır.
 */
export async function recoverStuckExportJobs(app: FastifyInstance): Promise<void> {
  const stuckProcessing = await app.prisma.exportJob.findMany({ where: { status: "PROCESSING" }, select: { id: true } });
  if (stuckProcessing.length > 0) {
    await app.prisma.exportJob.updateMany({
      where: { id: { in: stuckProcessing.map((j) => j.id) } },
      data: { status: "FAILED", errorSummary: "Sunucu yeniden başlatıldığı için rapor oluşturma yarıda kaldı.", finishedAt: new Date() },
    });
    app.log.warn({ count: stuckProcessing.length }, "Yarıda kalmış rapor dışa aktarma işleri FAILED olarak işaretlendi (sunucu restart kurtarması)");
  }

  const pending = await app.prisma.exportJob.findMany({
    where: { status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true },
    orderBy: { seq: "asc" },
  });
  for (const job of pending) enqueueExportJob(app, job.id);
}

// ---------------------------------------------------------------------------
// Ana dispatcher
// ---------------------------------------------------------------------------

interface ExportJobParams {
  from: string;
  to: string;
  granularity: StatsGranularity;
  filters: ExportFilters;
  unmaskPii: boolean;
}

export async function runExportJob(app: FastifyInstance, jobId: string): Promise<void> {
  const job = await app.prisma.exportJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PENDING") return;

  // ATOMIC claim — `import.worker.ts::runImportJob`'daki gerekçeyle AYNI (bkz. o dosyadaki
  // uzun yorum): iki eşzamanlı tetikleyici (ör. restart kurtarma + orijinal `enqueueExportJob`
  // çağrısı) AYNI işi iki kez işlemeye kalkışmasın diye `updateMany({where:{status:"PENDING"}})`
  // Postgres satır kilidiyle atomic'tir.
  const claim = await app.prisma.exportJob.updateMany({ where: { id: jobId, status: "PENDING" }, data: { status: "PROCESSING", startedAt: new Date() } });
  if (claim.count === 0) return;

  try {
    const params = job.filters as unknown as ExportJobParams;
    const range = resolveStatsRange({ from: params.from, to: params.to });
    const granularity = params.granularity ?? "day";
    const unmaskPii = params.unmaskPii === true;

    const table = await buildExportTable(app, job.type as ExportJobType, range, granularity, params.filters ?? {}, unmaskPii);
    const generatedAt = new Date();
    const title = `${job.type} raporu (${range.from.toISOString().slice(0, 10)} – ${range.to.toISOString().slice(0, 10)})`;

    const fileBuffer = job.format === "CSV" ? toCsv(table.columns, table.rows) : await toPdf(title, generatedAt, table.columns, table.rows);
    const storagePath = await exportStorage.save(fileBuffer);

    await app.prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", storagePath, containsPii: table.containsPii, finishedAt: new Date() },
    });

    if (job.createdById) {
      await logAudit(app, {
        actorId: job.createdById,
        action: "reports.export.completed",
        targetType: "ExportJob",
        targetId: job.id,
        metadata: { type: job.type, format: job.format, containsPii: table.containsPii },
      });
    }
  } catch (err) {
    app.log.error({ err, jobId }, "Rapor dışa aktarma işi hata ile sonlandı");
    await app.prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorSummary: err instanceof Error ? err.message : "Bilinmeyen hata.", finishedAt: new Date() },
    });
  }
}

// ---------------------------------------------------------------------------
// Rapor türüne göre tablo üretimi — hem CSV hem PDF için ORTAK ara temsil.
// ---------------------------------------------------------------------------

interface ExportTable {
  columns: string[];
  rows: ExportCellValue[][];
  containsPii: boolean;
}

async function buildExportTable(
  app: FastifyInstance,
  type: ExportJobType,
  range: DateRange,
  granularity: StatsGranularity,
  filters: ExportFilters,
  unmaskPii: boolean
): Promise<ExportTable> {
  switch (type) {
    case "VIEWS": {
      const series = await getViewsSeries(app, range, granularity);
      return { columns: ["date", "pageViews", "postViews"], rows: series.map((p) => [p.date, p.pageViews, p.postViews]), containsPii: false };
    }

    case "BREAKDOWN": {
      const { devices, countries } = await getBreakdown(app, range);
      const rows: ExportCellValue[][] = [
        ...devices.map((d) => ["device", d.type, d.count] as ExportCellValue[]),
        ...countries.map((c) => ["country", c.country, c.count] as ExportCellValue[]),
      ];
      return { columns: ["category", "key", "count"], rows, containsPii: false };
    }

    case "SUMMARY": {
      const summary = await getSummaryStats(app, range, false);
      return {
        columns: ["from", "to", "pageViews", "postViews", "newUsers", "activeSubscriptions", "mrrCents"],
        rows: [
          [
            range.from.toISOString().slice(0, 10),
            range.to.toISOString().slice(0, 10),
            summary.pageViews,
            summary.postViews,
            summary.newUsers,
            summary.activeSubscriptions,
            summary.mrrCents,
          ],
        ],
        containsPii: false,
      };
    }

    case "TOP_CONTENT": {
      const { items } = await getTopContent(app, range, 0, EXPORT_ROW_CAPS.TOP_CONTENT);
      return { columns: ["contentType", "title", "slug", "views"], rows: items.map((i) => [i.contentType, i.title, i.slug, i.views]), containsPii: false };
    }

    // §10.8.10 — kişisel veri (ad/e-posta) içerir; `unmaskPii=false` (varsayılan) ise e-posta
    // maskelenir (bkz. lib/pii-mask.ts). `filters.role` verilirse ek daraltma uygulanır.
    case "USERS": {
      const users = await app.prisma.user.findMany({
        where: { createdAt: { gte: range.from, lt: range.toExclusive }, ...(filters.role ? { role: filters.role } : {}) },
        select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, lastLoginAt: true },
        orderBy: { createdAt: "asc" },
        take: EXPORT_ROW_CAPS.USERS,
      });
      const rows: ExportCellValue[][] = users.map((u) => [
        u.id,
        u.name,
        unmaskPii ? u.email : maskEmail(u.email),
        u.role,
        u.status,
        u.createdAt.toISOString(),
        u.lastLoginAt ? u.lastLoginAt.toISOString() : "",
      ]);
      return { columns: ["id", "name", "email", "role", "status", "createdAt", "lastLoginAt"], rows, containsPii: true };
    }

    // §10.8.10 — abonelik sahibi organizasyonun `owner.email`'i kişisel veridir (maskelenir);
    // organizasyon/plan adı doğal kişiye ait DEĞİLDİR (KVKK m.3 "ilgili kişi" tanımı), maskelenmez.
    case "REVENUE": {
      const subscriptions = await app.prisma.subscription.findMany({
        where: {
          createdAt: { gte: range.from, lt: range.toExclusive },
          ...(filters.subscriptionStatus ? { status: filters.subscriptionStatus } : {}),
        },
        select: {
          createdAt: true,
          currentPeriodEnd: true,
          status: true,
          plan: { select: { name: true, priceMonthlyCents: true } },
          organization: { select: { name: true, owner: { select: { email: true } } } },
        },
        orderBy: { createdAt: "asc" },
        take: EXPORT_ROW_CAPS.REVENUE,
      });
      const rows: ExportCellValue[][] = subscriptions.map((s) => [
        s.organization.name,
        unmaskPii ? (s.organization.owner?.email ?? "") : s.organization.owner ? maskEmail(s.organization.owner.email) : "",
        s.plan.name,
        s.status,
        s.plan.priceMonthlyCents,
        s.currentPeriodEnd.toISOString(),
        s.createdAt.toISOString(),
      ]);
      return {
        columns: ["organization", "ownerEmail", "plan", "status", "priceMonthlyCents", "currentPeriodEnd", "createdAt"],
        rows,
        containsPii: true,
      };
    }
  }
}
