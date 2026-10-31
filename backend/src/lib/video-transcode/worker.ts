import path from "node:path";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { MediaTranscodeJob } from "@prisma/client";
import { storage } from "../storage";
import { probeMp4File } from "../mp4-probe";
import { processAndStoreSiteImage, removeStoredPaths } from "../site-image-store";
import { CACHE_TAGS, triggerTagRevalidation } from "../revalidate";
import { FFMPEG_TIMEOUT_MS, ProcessFailedError, ProcessTimeoutError, buildPosterArgs, buildTranscodeArgs, runFfmpeg } from "./ffmpeg";

/**
 * Paket AE-ek — yüklenen video kuyruğu (MP4/MOV → H.264 MP4, faststart, en çok 1080p).
 *
 * - Aynı anda en çok 1 dönüştürme: süreç içi bayrak + veritabanında "running" iş varken yenisi alınmaz
 *   (birden fazla backend örneğine karşı da), iş `updateMany(status=queued)` ile atomik sahiplenilir.
 * - Aktif görüşme varsa (IN_PROGRESS randevu ya da başlamış ama bitmemiş görüşme) iş başlamaz, 2 dk ertelenir.
 *   Kontrol yalnızca mevcut randevu verisinden yapılır; LiveKit koduna dokunulmaz.
 * - Orijinal, herkese açık OLMAYAN `storage/media-transcode/originals` içinde; başarıda hemen, hatada 24 saat
 *   sonra silinir. Ara dosyalar iş klasöründe tutulur ve iş bitince silinir.
 */
export const TRANSCODE_ROOT = path.join(process.cwd(), "storage", "media-transcode");
export const ORIGINALS_DIR = path.join(TRANSCODE_ROOT, "originals");
export const WORK_DIR = path.join(TRANSCODE_ROOT, "work");
export const DEFER_WHEN_BUSY_MS = 2 * 60 * 1000;
export const FAILED_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const STALE_RUNNING_MS = FFMPEG_TIMEOUT_MS + 5 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;
const FIRST_RUN_DELAY_MS = 20 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface TranscodeDeps {
  transcode(input: string, output: string): Promise<void>;
  extractPoster(input: string, output: string, atSec: number): Promise<void>;
  isConsultationActive(app: FastifyInstance, now: Date): Promise<boolean>;
  now(): Date;
}

/** Aktif görüşme: IN_PROGRESS randevu ya da başlamış (startedAt) ama bitmemiş ve süresi yeni geçmiş randevu. */
export async function isConsultationActive(app: FastifyInstance, now: Date): Promise<boolean> {
  const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const count = await app.prisma.appointment.count({
    where: {
      endsAt: { gte: recent },
      OR: [{ status: "IN_PROGRESS" }, { startedAt: { not: null, lte: now }, endedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] } }],
    },
  });
  return count > 0;
}

export const defaultTranscodeDeps: TranscodeDeps = {
  transcode: (input, output) => runFfmpeg(buildTranscodeArgs(input, output)),
  extractPoster: (input, output, atSec) => runFfmpeg(buildPosterArgs(input, output, atSec), 60_000),
  isConsultationActive,
  now: () => new Date(),
};

/** Sunucunun ürettiği kaynak adını (yalnızca dosya adı) özel klasördeki tam yola çevirir. */
export function sourceFilePath(sourceName: string): string {
  return path.join(ORIGINALS_DIR, path.basename(sourceName));
}

export function readableTranscodeError(err: unknown): string {
  if (err instanceof ProcessTimeoutError) return "Dönüştürme 10 dakikayı aştı ve durduruldu. Daha kısa bir video yükleyin ya da yeniden deneyin.";
  if (err instanceof ProcessFailedError) {
    if (err.notFound || err.exitCode === 127) return "Sunucuda ffmpeg bulunamadı; video dönüştürülemedi.";
    const last = err.stderrTail.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    return `Video dönüştürülemedi${last ? `: ${last.slice(0, 240)}` : "."}`;
  }
  return "Video dönüştürülemedi (beklenmeyen hata).";
}

const runningApps = new WeakSet<FastifyInstance>();

export type TranscodeRunResult = { status: "idle" | "busy" | "deferred" } | { status: "done" | "failed"; jobId: string; error?: string };

/** Kuyruktaki ilk uygun işi çalıştırır (en çok 1 iş). Testler `deps` ile ffmpeg'i taklit eder. */
export async function runNextTranscodeJob(app: FastifyInstance, deps: TranscodeDeps = defaultTranscodeDeps): Promise<TranscodeRunResult> {
  if (runningApps.has(app)) return { status: "busy" };
  runningApps.add(app);
  try {
    const now = deps.now();
    if ((await app.prisma.mediaTranscodeJob.count({ where: { status: "running" } })) > 0) return { status: "busy" };
    const next = await app.prisma.mediaTranscodeJob.findFirst({ where: { status: "queued", notBefore: { lte: now } }, orderBy: { queuedAt: "asc" } });
    if (!next) return { status: "idle" };
    if (await deps.isConsultationActive(app, now)) {
      await app.prisma.mediaTranscodeJob.update({ where: { id: next.id }, data: { notBefore: new Date(now.getTime() + DEFER_WHEN_BUSY_MS) } });
      app.log.info({ jobId: next.id }, "video dönüştürme ertelendi: aktif görüşme var");
      return { status: "deferred" };
    }
    const claimed = await app.prisma.mediaTranscodeJob.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: now, attempts: { increment: 1 }, error: null },
    });
    if (claimed.count !== 1) return { status: "busy" };
    return await executeJob(app, next, deps);
  } finally {
    runningApps.delete(app);
  }
}

async function executeJob(app: FastifyInstance, job: MediaTranscodeJob, deps: TranscodeDeps): Promise<TranscodeRunResult> {
  const workDir = path.join(WORK_DIR, job.id);
  const output = path.join(workDir, "out.mp4");
  const posterFile = path.join(workDir, "poster.png");
  const written: string[] = [];
  let posterMediaId: string | null = null;
  try {
    if (!job.sourcePath) throw new Error("SOURCE_MISSING");
    const input = sourceFilePath(job.sourcePath);
    if (!fs.existsSync(input)) throw new Error("SOURCE_MISSING");
    await fs.promises.mkdir(workDir, { recursive: true });

    await deps.transcode(input, output);
    const probe = await probeMp4File(output);
    if (!probe.videoCodec) throw new Error("NO_VIDEO_OUTPUT");
    const outSize = (await fs.promises.stat(output)).size;

    // Kapak: 1. saniye (çok kısa videoda 0). Başarısız olursa video yine yayınlanır; admin kapağı kendisi seçer.
    try {
      await deps.extractPoster(output, posterFile, probe.durationSec !== null && probe.durationSec < 1.5 ? 0 : 1);
      const stored = await processAndStoreSiteImage(await fs.promises.readFile(posterFile), "video-kapak.png");
      written.push(...stored.writtenPaths);
      posterMediaId = (await app.prisma.media.create({ data: stored.data })).id;
    } catch (err) {
      app.log.warn({ err, jobId: job.id }, "video kapağı üretilemedi");
    }

    const saved = await storage.saveFile({ sourcePath: output, sizeBytes: outSize, mimeType: "video/mp4" });
    written.push(saved.path);
    await app.prisma.$transaction([
      app.prisma.media.update({
        where: { id: job.mediaId },
        data: { path: saved.path, url: saved.url, sizeBytes: outSize, videoCodec: probe.videoCodec, videoFaststart: probe.faststart, durationSec: probe.durationSec, processingStatus: "ready" },
      }),
      app.prisma.mediaTranscodeJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: deps.now(), outputSizeBytes: outSize, sourcePath: null, sourceDeleteAfter: null, error: null } }),
      ...(posterMediaId ? [app.prisma.doctorMedia.updateMany({ where: { mediaId: job.mediaId, thumbnailMediaId: null }, data: { thumbnailMediaId: posterMediaId } })] : []),
    ]);
    await fs.promises.unlink(sourceFilePath(job.sourcePath)).catch(() => undefined);
    await triggerTagRevalidation(app, [CACHE_TAGS.doctors]).catch(() => undefined);
    app.log.info({ jobId: job.id, mediaId: job.mediaId, sourceSizeBytes: job.sourceSizeBytes, outputSizeBytes: outSize }, "video dönüştürüldü");
    return { status: "done", jobId: job.id };
  } catch (err) {
    await removeStoredPaths(written);
    if (posterMediaId) await app.prisma.media.delete({ where: { id: posterMediaId } }).catch(() => undefined);
    const message = err instanceof Error && err.message === "SOURCE_MISSING" ? "Orijinal video bulunamadı (silinmiş olabilir); videoyu yeniden yükleyin." : readableTranscodeError(err);
    const now = deps.now();
    await app.prisma.$transaction([
      app.prisma.mediaTranscodeJob.update({ where: { id: job.id }, data: { status: "failed", finishedAt: now, error: message, sourceDeleteAfter: new Date(now.getTime() + FAILED_SOURCE_RETENTION_MS) } }),
      app.prisma.media.update({ where: { id: job.mediaId }, data: { processingStatus: "failed" } }),
    ]);
    app.log.warn({ err, jobId: job.id }, "video dönüştürme başarısız");
    return { status: "failed", jobId: job.id, error: message };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Başarısız işlerin orijinallerini 24 saat sonra, sahipsiz eski dosyaları da siler. */
export async function cleanupTranscodeSources(app: FastifyInstance, now = new Date()): Promise<{ expired: number; orphans: number }> {
  const expired = await app.prisma.mediaTranscodeJob.findMany({ where: { sourcePath: { not: null }, sourceDeleteAfter: { lte: now } }, select: { id: true, sourcePath: true } });
  for (const job of expired) {
    await fs.promises.unlink(sourceFilePath(job.sourcePath!)).catch(() => undefined);
    await app.prisma.mediaTranscodeJob.update({ where: { id: job.id }, data: { sourcePath: null } });
  }
  let orphans = 0;
  const names = await fs.promises.readdir(ORIGINALS_DIR).catch(() => [] as string[]);
  if (names.length) {
    const known = new Set((await app.prisma.mediaTranscodeJob.findMany({ where: { sourcePath: { in: names } }, select: { sourcePath: true } })).map((j) => j.sourcePath));
    for (const name of names) {
      if (known.has(name)) continue;
      const full = path.join(ORIGINALS_DIR, name);
      const stat = await fs.promises.stat(full).catch(() => null);
      if (stat && now.getTime() - stat.mtimeMs > FAILED_SOURCE_RETENTION_MS) {
        await fs.promises.unlink(full).catch(() => undefined);
        orphans++;
      }
    }
  }
  return { expired: expired.length, orphans };
}

/** Açılışta yarıda kalmış ("running") işler kuyruğa geri alınır (çökme/yeniden başlatma kurtarması). */
export async function recoverStaleTranscodeJobs(app: FastifyInstance, now = new Date()): Promise<number> {
  const res = await app.prisma.mediaTranscodeJob.updateMany({
    where: { status: "running", startedAt: { lte: new Date(now.getTime() - STALE_RUNNING_MS) } },
    data: { status: "queued", notBefore: now },
  });
  return res.count;
}

const registeredApps = new WeakSet<FastifyInstance>();

/** Yükleme sonrası kuyruğu beklemeden dener (yalnızca işçi kuruluysa; testlerde kurulmaz). */
export function kickVideoTranscode(app: FastifyInstance): void {
  if (!registeredApps.has(app)) return;
  setImmediate(() => {
    runNextTranscodeJob(app).catch((err) => app.log.error({ err }, "video dönüştürme turu başarısız"));
  });
}

export function registerVideoTranscodeWorker(app: FastifyInstance): void {
  registeredApps.add(app);
  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const tick = () => {
    runNextTranscodeJob(app).catch((err) => app.log.error({ err }, "video dönüştürme turu başarısız"));
  };
  const first = setTimeout(() => {
    recoverStaleTranscodeJobs(app, new Date(Date.now() + STALE_RUNNING_MS))
      .catch(() => 0)
      .finally(tick);
  }, FIRST_RUN_DELAY_MS);
  first.unref();
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  timer.unref();
  const cleanup = setInterval(() => {
    cleanupTranscodeSources(app).catch((err) => app.log.error({ err }, "video orijinali temizliği başarısız"));
  }, CLEANUP_INTERVAL_MS);
  cleanup.unref();
  app.addHook("onClose", async () => {
    registeredApps.delete(app);
    clearTimeout(first);
    clearInterval(timer);
    clearInterval(cleanup);
  });
}

/** Admin ekranı: işin kuyruktaki sırası (1 = sıradaki); kuyrukta değilse null. */
export async function queuePosition(app: FastifyInstance, job: Pick<MediaTranscodeJob, "status" | "queuedAt">): Promise<number | null> {
  if (job.status !== "queued") return null;
  const ahead = await app.prisma.mediaTranscodeJob.count({ where: { status: { in: ["queued", "running"] }, queuedAt: { lt: job.queuedAt } } });
  return ahead + 1;
}
