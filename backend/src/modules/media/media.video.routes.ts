import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiError, ConflictError, NotFoundError, PayloadTooLargeError, ValidationError } from "../../lib/errors";
import { storage } from "../../lib/storage";
import { MediaSchema } from "../../schemas/entities";
import { toMediaDto } from "../../mappers";
import { Mp4ProbeFailure, probeMp4File, type Mp4ProbeResult } from "../../lib/mp4-probe";
import { ORIGINALS_DIR, kickVideoTranscode, queuePosition, sourceFilePath } from "../../lib/video-transcode/worker";
import { MAX_VIDEO_UPLOAD_MB_LIMIT, parseDoctorMediaSettings } from "../telehealth/lib/doctor-showcase";

/**
 * Paket AE-ek: yüklenen MP4/MOV artık doğrudan yayınlanmaz; özel klasöre yazılır ve kuyrukta H.264 MP4'e
 * dönüştürülür (lib/video-transcode/worker.ts). Aşağıdaki AE notlarının "diskteki ad/oynatma" kısmı
 * dönüştürülmüş çıktı için geçerlidir.
 *
 * Paket AE — hekim videosu yükleme (`POST /admin/media/video`) ve WebVTT altyazı (`POST /admin/media/captions`).
 *
 * - Video belleğe ALINMAZ: multipart dosya akışı bayt sayacından geçerek UPLOAD_DIR içindeki geçici dosyaya
 *   yazılır; sınır (admin ayarı `maxVideoUploadMb`, varsayılan 100) aşılınca akış kesilir, dosya silinir.
 * - Tür beyandan değil içerikten belirlenir: ilk parçada `ftyp` yoksa yükleme hemen kesilir; bitince kutu
 *   yapısı (`lib/mp4-probe.ts`) denetlenir. ffmpeg kullanılmaz (sunucuda olduğu varsayılmaz).
 * - Diskteki ad rastgele UUID + `.mp4`; özgün dosya adı SAKLANMAZ (Media.filename nötr bir addır).
 * - Oynatma `/uploads/*` statik servisinden: Range/206 ve `Accept-Ranges: bytes` (`@fastify/static`), UUID adlı
 *   dosyaya 1 yıllık `immutable` önbellek (bkz. plugins/uploads.ts).
 */
const MB = 1024 * 1024;
const VIDEO_RATE_LIMIT = { max: 20, timeWindow: "1 hour" };
const CAPTIONS_MAX_BYTES = 512 * 1024;

const ONLY_MP4 = "Yalnızca MP4 ya da MOV (iPhone) video yükleyebilirsiniz.";

const WarningSchema = z.object({ code: z.enum(["HEVC_CODEC", "MOOV_AT_END"]), message: z.string() });
const VideoUploadResponseSchema = z.object({
  data: z.object({
    media: MediaSchema,
    video: z.object({ codec: z.string().nullable(), faststart: z.boolean(), durationSec: z.number().nullable() }),
    warnings: z.array(WarningSchema),
    /** Paket AE-ek — video sunucuda H.264 MP4'e dönüştürülene kadar "processing"; sitede görünmez. */
    processing: z.object({ status: z.enum(["processing", "ready", "failed"]), queuePosition: z.number().int().nullable() }),
  }),
});

function probeErrorMessage(err: Mp4ProbeFailure): string {
  switch (err.code) {
    case "HEIF_IMAGE":
      return "Bu dosya bir HEIC/HEIF görseli, video değil. " + ONLY_MP4;
    case "QUICKTIME":
      return "Bu dosya QuickTime (.mov) biçiminde. " + ONLY_MP4 + " iPhone'da paylaşırken 'En Uyumlu' biçimi seçin ya da MP4'e dönüştürün.";
    case "NO_MOOV":
      return "Video dosyası eksik ya da bozuk (moov kutusu yok).";
    case "MOOV_TOO_LARGE":
      return "Video üst bilgisi beklenenden büyük; dosya işlenemedi.";
    default:
      return ONLY_MP4;
  }
}

/** WebVTT: (BOM'dan sonra) "WEBVTT" ile başlamalı, ardından boşluk/satır sonu ya da dosya sonu gelmeli; geçerli UTF-8. */
export function isWebVtt(buffer: Buffer): boolean {
  const body = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  if (!/^WEBVTT(?:[ \t\r\n]|$)/.test(body.subarray(0, 16).toString("latin1"))) return false;
  return !new TextDecoder("utf-8", { fatal: false }).decode(body).includes("�");
}

async function maxVideoBytes(app: FastifyInstance): Promise<{ bytes: number; mb: number }> {
  const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
  const { maxVideoUploadMb } = parseDoctorMediaSettings(row?.settings);
  return { bytes: maxVideoUploadMb * MB, mb: maxVideoUploadMb };
}

export async function registerVideoUploadRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    "/video",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      config: { rateLimit: VIDEO_RATE_LIMIT },
      // Çekirdek gövde sınırı en yüksek ayar değerine göre; asıl sınır (admin ayarı) akışta sayılır.
      bodyLimit: MAX_VIDEO_UPLOAD_MB_LIMIT * MB + MB,
      schema: { response: { 201: VideoUploadResponseSchema } },
    },
    async (request, reply) => {
      const limit = await maxVideoBytes(app);
      const tooLarge = () => new PayloadTooLargeError(`Video en fazla ${limit.mb} MB olabilir.`);
      // Content-Length açıkça sınırın üstündeyse gövde okunmadan reddedilir (multipart ek yükü için 1 MB pay).
      const declared = Number(request.headers["content-length"] ?? 0);
      if (declared > limit.bytes + MB) throw tooLarge();

      const part = await request.file({ limits: { fileSize: limit.bytes, files: 1, fields: 0 } });
      if (!part) throw new ValidationError("Yüklenecek dosya bulunamadı.", { file: ["Zorunlu."] });

      // Paket AE-ek — orijinal, herkese açık OLMAYAN özel klasöre yazılır; ad sunucunun ürettiği UUID'dir.
      await fs.promises.mkdir(ORIGINALS_DIR, { recursive: true });
      const sourceId = crypto.randomUUID();
      const tmpPath = path.join(ORIGINALS_DIR, `.${sourceId}.part`);
      let finalPath: string | null = null;
      let written = 0;
      let notMp4 = false;
      let head = Buffer.alloc(0);
      const guard = new Transform({
        transform(chunk: Buffer, _enc, callback) {
          // İlk 12 bayt gelir gelmez `ftyp` imzası denetlenir; değilse akış hemen kesilir (çöp diske yazılmaz).
          // HLS/m3u8 çalma listeleri, WebM/MKV vb. burada elenir.
          if (head.length < 12) {
            head = Buffer.concat([head, chunk]).subarray(0, 12);
            if (head.length >= 8 && head.subarray(4, 8).toString("latin1") !== "ftyp") {
              notMp4 = true;
              callback(new Error("NOT_MP4"));
              return;
            }
          }
          written += chunk.length;
          if (written > limit.bytes) {
            callback(tooLarge());
            return;
          }
          callback(null, chunk);
        },
      });

      try {
        await pipeline(part.file, guard, fs.createWriteStream(tmpPath, { flags: "wx" }));
        if (part.file.truncated) throw tooLarge();
        if (written < 12) {
          notMp4 = true;
          throw new Error("NOT_MP4");
        }
        let probe: Mp4ProbeResult;
        try {
          probe = await probeMp4File(tmpPath, { allowQuickTime: true });
        } catch (err) {
          if (err instanceof Mp4ProbeFailure) throw new ValidationError(probeErrorMessage(err), { file: [probeErrorMessage(err)] });
          throw err;
        }
        if (!probe.videoCodec) throw new ValidationError("Dosyada görüntü izi bulunamadı.", { file: ["Video izi yok."] });

        const sourceName = `${sourceId}.${probe.container}`;
        finalPath = path.join(ORIGINALS_DIR, sourceName);
        await fs.promises.rename(tmpPath, finalPath);
        const media = await app.prisma.media.create({
          data: {
            // Dönüştürme bitene kadar herkese açık dosya yok (path/url boş); sitede görünmez.
            path: "",
            url: "",
            // Özgün dosya adı saklanmaz (hasta/hekim adı içerebilir).
            filename: `video-${new Date().toISOString().slice(0, 10)}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: written,
            width: null,
            height: null,
            videoCodec: probe.videoCodec,
            videoFaststart: probe.faststart,
            durationSec: probe.durationSec,
            processingStatus: "processing",
            transcodeJob: {
              create: {
                sourcePath: sourceName,
                sourceContainer: probe.container,
                sourceSizeBytes: written,
                sourceCodec: probe.videoCodec,
                sourceDurationSec: probe.durationSec,
                createdById: request.user?.id ?? null,
                // Kuyruk zamanları işçiyle aynı (uygulama) saatiyle yazılır; veritabanı saatiyle ms farkı sırayı bozmasın.
                queuedAt: new Date(),
                notBefore: new Date(),
              },
            },
          },
          include: { transcodeJob: true },
        });
        request.log.info({ mediaId: media.id, sizeBytes: written, codec: probe.videoCodec, container: probe.container }, "media.video_uploaded");
        kickVideoTranscode(app);
        return reply.code(201).send(
          ok({
            media: toMediaDto(media),
            video: { codec: probe.videoCodec, faststart: probe.faststart, durationSec: probe.durationSec },
            // Video H.264/faststart olarak yeniden kodlanacağı için HEVC ve moov uyarıları artık gerekmez.
            warnings: [],
            processing: { status: "processing" as const, queuePosition: await queuePosition(app, media.transcodeJob!) },
          })
        );
      } catch (err) {
        if (finalPath) await fs.promises.unlink(finalPath).catch(() => undefined);
        if (notMp4) throw new ValidationError(ONLY_MP4, { file: [ONLY_MP4] });
        if (err instanceof ApiError) throw err;
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
        throw err;
      } finally {
        await fs.promises.unlink(tmpPath).catch(() => undefined);
      }
    }
  );

  /** Paket AE-ek — dönüştürme kuyruğu (admin ekranı: durum, sıra, boyut/süre önce-sonra, hata). */
  server.get(
    "/transcode-jobs",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      const jobs = await app.prisma.mediaTranscodeJob.findMany({
        where: { OR: [{ status: { in: ["queued", "running", "failed"] } }, { finishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] },
        orderBy: { queuedAt: "asc" },
        take: 100,
      });
      const items = await Promise.all(jobs.map(async (j) => ({ ...transcodeJobDto(j), queuePosition: await queuePosition(app, j) })));
      return reply.send(ok(items));
    }
  );

  /** Paket AE-ek — başarısız dönüştürmeyi yeniden kuyruğa alır (orijinal 24 saat saklanır). */
  server.post(
    "/:mediaId/transcode/retry",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), config: { rateLimit: { max: 30, timeWindow: "1 hour" } }, schema: { params: z.object({ mediaId: z.string().uuid() }) } },
    async (request, reply) => {
      const job = await app.prisma.mediaTranscodeJob.findUnique({ where: { mediaId: request.params.mediaId } });
      if (!job) throw new NotFoundError("Dönüştürme işi bulunamadı.");
      if (job.status !== "failed") throw new ConflictError("Yalnızca başarısız dönüştürme yeniden denenebilir.");
      if (!job.sourcePath || !fs.existsSync(sourceFilePath(job.sourcePath))) throw new ConflictError("Orijinal video artık yok (24 saat sonra silinir); videoyu yeniden yükleyin.");
      const now = new Date();
      const [updated] = await app.prisma.$transaction([
        app.prisma.mediaTranscodeJob.update({ where: { id: job.id }, data: { status: "queued", error: null, notBefore: now, queuedAt: now, startedAt: null, finishedAt: null, sourceDeleteAfter: null } }),
        app.prisma.media.update({ where: { id: job.mediaId }, data: { processingStatus: "processing" } }),
      ]);
      kickVideoTranscode(app);
      return reply.send(ok({ ...transcodeJobDto(updated), queuePosition: await queuePosition(app, updated) }));
    }
  );

  server.post(
    "/captions",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      config: { rateLimit: { max: 60, timeWindow: "1 hour" } },
      schema: { response: { 201: z.object({ data: MediaSchema }) } },
    },
    async (request, reply) => {
      const part = await request.file({ limits: { fileSize: CAPTIONS_MAX_BYTES, files: 1, fields: 0 } });
      if (!part) throw new ValidationError("Yüklenecek dosya bulunamadı.", { file: ["Zorunlu."] });
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new PayloadTooLargeError("Altyazı dosyası en fazla 512 KB olabilir.");
        throw err;
      }
      if (!isWebVtt(buffer)) {
        throw new ValidationError("Altyazı WebVTT (.vtt) biçiminde olmalı.", { file: ["Dosya 'WEBVTT' ile başlamalı (UTF-8)."] });
      }
      const { path: storedPath, url } = await storage.save({ buffer, filename: "captions.vtt", mimeType: "text/vtt" });
      const media = await app.prisma.media.create({
        data: { path: storedPath, url, filename: "captions.vtt", mimeType: "text/vtt", sizeBytes: buffer.byteLength, width: null, height: null },
      });
      return reply.code(201).send(ok(toMediaDto(media)));
    }
  );
}

export function transcodeJobDto(j: {
  id: string;
  mediaId: string;
  status: string;
  sourceContainer: string;
  sourceSizeBytes: number;
  sourceCodec: string | null;
  sourceDurationSec: number | null;
  outputSizeBytes: number | null;
  attempts: number;
  error: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  sourceDeleteAfter: Date | null;
  sourcePath: string | null;
}) {
  return {
    id: j.id,
    mediaId: j.mediaId,
    status: j.status as "queued" | "running" | "done" | "failed",
    sourceContainer: j.sourceContainer,
    sourceSizeBytes: j.sourceSizeBytes,
    sourceCodec: j.sourceCodec,
    sourceDurationSec: j.sourceDurationSec,
    outputSizeBytes: j.outputSizeBytes,
    attempts: j.attempts,
    error: j.error,
    canRetry: j.status === "failed" && j.sourcePath !== null,
    queuedAt: j.queuedAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    sourceDeleteAfter: j.sourceDeleteAfter?.toISOString() ?? null,
  };
}
