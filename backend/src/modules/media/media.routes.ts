import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema, CursorQuerySchema } from "../../schemas/common";
import { MediaSchema } from "../../schemas/entities";
import { toMediaDto } from "../../mappers";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { storage } from "../../lib/storage";
import { detectImageMimeType } from "../../lib/mime-detect";
import { MediaIdParamSchema } from "./media.schemas";

// SVG kasıtlı olarak allow-list'te YOK: metin tabanlıdır, magic byte imzası yoktur ve içine
// `<script>` gömülebildiği için depolanmış XSS riski taşır — import modülü (§10.8.7,
// `import.worker.ts`::`UNSUPPORTED_MIME`/`entry.isSvg`) ile AYNI politika burada da uygulanır.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Diğer admin listeleme uçlarıyla paylaşılan global limitten (env.RATE_LIMIT_MAX) bağımsız,
// bu uca özel orta seviye üst sınır — hem savunma derinliği (hızlı veri dökümü/scraping'e karşı)
// hem de diğer admin trafiğinin (health polling, dashboard) global bütçeyi tüketmesi durumunda
// bu ucun erişiminin garanti altında kalması için (bkz. logs.routes.ts::LOGS_RATE_LIMIT). Sadece
// GET/listeleme içindir — POST/DELETE zaten requireSiteRole ile korunuyor ve daha maliyetli/az
// sıklıkta çağrılan işlemler.
const MEDIA_LIST_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

/** `/admin/media` prefix'i altında bağlanır (bkz. app.ts) — authenticated. */
export async function adminMediaRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { response: { 201: ApiSuccessSchema(MediaSchema) } },
    },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw new ValidationError("Yüklenecek dosya bulunamadı.", { file: ["Zorunlu."] });
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new ValidationError("Desteklenmeyen dosya türü.", {
          file: ["Yalnızca JPEG, PNG, WEBP veya GIF yükleyebilirsiniz."],
        });
      }

      const buffer = await file.toBuffer();

      // GÜVENLİK: `file.mimetype` istemcinin (multipart Content-Type başlığı üzerinden) BEYAN
      // ettiği değerdir, doğrulanmamıştır — sahte bir Content-Type ile keyfi içerik (örn. HTML/JS)
      // yüklenip diskte servis edilebilir (stored-XSS). Gerçek tür, buffer'ın ilk baytlarından
      // (magic byte) `detectImageMimeType` ile tespit edilir; beyan edilenle uyuşmuyorsa ya da
      // tanınmıyorsa/SVG ise istek reddedilir. import.worker.ts (§10.8.7) ile aynı kod yolu.
      const detected = detectImageMimeType(buffer);
      if (!detected.mimeType || detected.isSvg) {
        throw new ValidationError("Dosya içeriği geçerli bir görsel değil.", {
          file: ["Dosya içeriği tanınan bir görsel biçimiyle (JPEG/PNG/WEBP/GIF) eşleşmiyor."],
        });
      }
      if (detected.mimeType !== file.mimetype) {
        throw new ValidationError("Beyan edilen dosya türü, dosya içeriğiyle uyuşmuyor.", {
          file: [`Content-Type "${file.mimetype}" olarak beyan edildi ama dosya içeriği "${detected.mimeType}" olarak tespit edildi.`],
        });
      }

      const { path: storedPath, url } = await storage.save({
        buffer,
        filename: file.filename,
        mimeType: detected.mimeType,
      });

      const media = await app.prisma.media.create({
        data: {
          path: storedPath,
          url,
          filename: file.filename,
          mimeType: detected.mimeType,
          sizeBytes: buffer.byteLength,
        },
      });

      return reply.code(201).send(ok(toMediaDto(media)));
    }
  );

  server.get(
    "/",
    {
      config: { rateLimit: MEDIA_LIST_RATE_LIMIT },
      schema: { querystring: CursorQuerySchema, response: { 200: ApiSuccessSchema(z.array(MediaSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit } = request.query;
      const cursorSeq = parseCursor(cursor);

      const rows = await app.prisma.media.findMany({
        where: cursorSeq ? { seq: { gt: cursorSeq } } : {},
        orderBy: { seq: "asc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toMediaDto), buildPageMeta(rows, limit)));
    }
  );

  server.delete(
    "/:mediaId",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: MediaIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const media = await app.prisma.media.findUnique({ where: { id: request.params.mediaId } });
      if (!media) throw new NotFoundError("Medya bulunamadı.");

      await app.prisma.media.delete({ where: { id: media.id } });
      await storage.remove(media.path).catch(() => {});

      return reply.code(204).send();
    }
  );
}
