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
import { ApiError, PayloadTooLargeError, ValidationError } from "../../lib/errors";
import { storage } from "../../lib/storage";
import { MediaSchema } from "../../schemas/entities";
import { toMediaDto } from "../../mappers";
import { UPLOAD_DIR } from "../../plugins/uploads";
import { H264_CODECS, HEVC_CODECS, Mp4ProbeFailure, probeMp4File, type Mp4ProbeResult } from "../../lib/mp4-probe";
import { MAX_VIDEO_UPLOAD_MB_LIMIT, parseDoctorMediaSettings } from "../telehealth/lib/doctor-showcase";

/**
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

export const HEVC_WARNING =
  "Bu video iPhone'un HEVC biçiminde. Bazı tarayıcılarda (Windows Chrome/Firefox) oynatılamayabilir. iPhone'da Ayarlar → Kamera → Biçimler → 'En Uyumlu' seçip yeniden çekin ya da H.264'e dönüştürün.";
export const MOOV_AT_END_WARNING = "Video akışlı oynatma için optimize değil, yüklenmesi yavaş olabilir.";
const ONLY_MP4 = "Yalnızca MP4 video yükleyebilirsiniz.";

const WarningSchema = z.object({ code: z.enum(["HEVC_CODEC", "MOOV_AT_END"]), message: z.string() });
const VideoUploadResponseSchema = z.object({
  data: z.object({
    media: MediaSchema,
    video: z.object({ codec: z.string().nullable(), faststart: z.boolean(), durationSec: z.number().nullable() }),
    warnings: z.array(WarningSchema),
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

export function videoWarnings(probe: Pick<Mp4ProbeResult, "videoCodec" | "faststart">): z.infer<typeof WarningSchema>[] {
  const warnings: z.infer<typeof WarningSchema>[] = [];
  if (probe.videoCodec && HEVC_CODECS.has(probe.videoCodec)) warnings.push({ code: "HEVC_CODEC", message: HEVC_WARNING });
  if (!probe.faststart) warnings.push({ code: "MOOV_AT_END", message: MOOV_AT_END_WARNING });
  return warnings;
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

      const tmpPath = path.join(UPLOAD_DIR, `.upload-${crypto.randomUUID()}.part`);
      let written = 0;
      let notMp4 = false;
      let head = Buffer.alloc(0);
      const guard = new Transform({
        transform(chunk: Buffer, _enc, callback) {
          // İlk 12 bayt gelir gelmez `ftyp` imzası denetlenir; değilse akış hemen kesilir (çöp diske yazılmaz).
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
          probe = await probeMp4File(tmpPath);
        } catch (err) {
          if (err instanceof Mp4ProbeFailure) throw new ValidationError(probeErrorMessage(err), { file: [probeErrorMessage(err)] });
          throw err;
        }
        if (!probe.videoCodec) throw new ValidationError("Dosyada görüntü izi bulunamadı.", { file: ["Video izi yok."] });
        if (!H264_CODECS.has(probe.videoCodec) && !HEVC_CODECS.has(probe.videoCodec)) {
          const message = `Desteklenmeyen video kodeki (${probe.videoCodec.trim()}). H.264 (avc1) biçiminde MP4 yükleyin.`;
          throw new ValidationError(message, { file: [message] });
        }

        const { path: storedPath, url } = await storage.saveFile({ sourcePath: tmpPath, sizeBytes: written, mimeType: "video/mp4" });
        const media = await app.prisma.media.create({
          data: {
            path: storedPath,
            url,
            // Özgün dosya adı saklanmaz (hasta/hekim adı içerebilir).
            filename: `video-${new Date().toISOString().slice(0, 10)}.mp4`,
            mimeType: "video/mp4",
            sizeBytes: written,
            width: null,
            height: null,
            videoCodec: probe.videoCodec,
            videoFaststart: probe.faststart,
            durationSec: probe.durationSec,
          },
        });
        request.log.info({ mediaId: media.id, sizeBytes: written, codec: probe.videoCodec, faststart: probe.faststart }, "media.video_uploaded");
        return reply.code(201).send(
          ok({
            media: toMediaDto(media),
            video: { codec: probe.videoCodec, faststart: probe.faststart, durationSec: probe.durationSec },
            warnings: videoWarnings(probe),
          })
        );
      } catch (err) {
        if (notMp4) throw new ValidationError(ONLY_MP4, { file: [ONLY_MP4] });
        if (err instanceof ApiError) throw err;
        if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
        throw err;
      } finally {
        // Başarıda dosya taşınmıştır; hata/iptalde geçici dosya kalmaz.
        await fs.promises.unlink(tmpPath).catch(() => undefined);
      }
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
