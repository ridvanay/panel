import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { imageSize } from "image-size";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN_MANAGER, ROLES_PANEL } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { MediaFolderSchema, MediaSchema, MoveMediaResultSchema } from "../../schemas/entities";
import { toMediaDto, toMediaFolderDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { parseCursor, buildPageMeta } from "../../lib/pagination";
import { storage } from "../../lib/storage";
import { detectUploadMimeType, filenameForMimeType, isHeifImage, mimeTypeLabel } from "../../lib/mime-detect";
import { ImageProcessingError, type ImagePurpose } from "../../lib/image-pipeline";
import { processAndStoreSiteImage, removeStoredPaths, variantPaths } from "../../lib/site-image-store";
import { sourceFilePath } from "../../lib/video-transcode/worker";
import fs from "node:fs";
import { registerVideoUploadRoutes } from "./media.video.routes";
import {
  CreateMediaFolderRequestSchema,
  MediaFolderIdParamSchema,
  MediaIdParamSchema,
  MediaListQuerySchema,
  MoveMediaRequestSchema,
  UpdateMediaAltTextRequestSchema,
  UpdateMediaFolderRequestSchema,
} from "./media.schemas";

// SVG kasıtlı olarak allow-list'te YOK: metin tabanlıdır, magic byte imzası yoktur ve içine
// `<script>` gömülebildiği için depolanmış XSS riski taşır — import modülü (§10.8.7,
// `import.worker.ts`::`UNSUPPORTED_MIME`/`entry.isSvg`) ile AYNI politika burada da uygulanır.
// §2.2 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — `application/pdf` ürün
// teknik dökümanları için EK OLARAK kabul edilir (görsel allow-list'i DEĞİŞMEDİ, yalnızca
// genişledi).
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]);
/** Paket AE — tarayıcının/işletim sisteminin tür veremediği görseller (boş/genel beyan); tür içerikten belirlenir. */
const CORRECTABLE_DECLARED_TYPES = new Set(["application/octet-stream", "image/jpg", "image/pjpeg", "image/x-png", "image/heic", "image/heif"]);
/** Paket AE-ek — sharp ile WebP'ye dönüştürülen site fotoğrafı türleri (GIF ve PDF olduğu gibi saklanır). */
const CONVERTIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PURPOSES = new Set<ImagePurpose>(["default", "logo", "icon"]);

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const MediaUploadResponseSchema = z.object({
  data: MediaSchema,
  meta: z
    .object({
      notice: z.object({ code: z.enum(["TYPE_CORRECTED", "CONVERTED"]), detectedMimeType: z.string(), message: z.string() }).optional(),
    })
    .optional(),
});

// Diğer admin listeleme uçlarıyla paylaşılan global limitten (env.RATE_LIMIT_MAX) bağımsız,
// bu uca özel orta seviye üst sınır — hem savunma derinliği (hızlı veri dökümü/scraping'e karşı)
// hem de diğer admin trafiğinin (health polling, dashboard) global bütçeyi tüketmesi durumunda
// bu ucun erişiminin garanti altında kalması için (bkz. logs.routes.ts::LOGS_RATE_LIMIT). Sadece
// GET/listeleme içindir — POST/DELETE zaten requireSiteRole ile korunuyor ve daha maliyetli/az
// sıklıkta çağrılan işlemler.
const MEDIA_LIST_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

// §10.11 Medya Kütüphanesi — Klasör Sistemi. `MediaFolder` tek sorguda `_count` ile birlikte
// döner (N+1 YASAK, bkz. ARCHITECTURE.md §10.11.1) — create/update de AYNI include ile tek
// round-trip'te güncel `mediaCount`'u taşır.
const FOLDER_WITH_COUNT = { include: { _count: { select: { media: true } } } } as const;

/**
 * Klasör hedefi doğrulaması (create/update ortak) — hedefin KENDİ `parentId`'si null OLMALIDIR
 * (maksimum derinlik 2, §10.11.1). `targetId` bulunamazsa `NotFoundError`, derinlik aşılırsa
 * `ValidationError` fırlatır.
 */
async function assertValidParent(app: FastifyInstance, targetId: string): Promise<void> {
  const target = await app.prisma.mediaFolder.findUnique({ where: { id: targetId } });
  if (!target) {
    throw new NotFoundError("`parentId` gönderildi ama böyle bir klasör yok.");
  }
  if (target.parentId !== null) {
    throw new ValidationError("Maksimum derinlik 2: parentId yalnızca parentId'si null olan (kök) bir klasörü işaret edebilir.", {
      parentId: ["Yalnızca kök seviye bir klasör hedef alınabilir."],
    });
  }
}

/** Aynı `parentId` altında case-insensitive isim çakışması kontrolü — 409 CONFLICT. */
async function assertNameAvailable(app: FastifyInstance, name: string, parentId: string | null, excludeId?: string): Promise<void> {
  const clash = await app.prisma.mediaFolder.findFirst({
    where: {
      parentId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (clash) {
    throw new ConflictError("Aynı üst klasör altında bu isimde bir klasör zaten var.");
  }
}

/**
 * `/admin/media` prefix'i altında bağlanır (bkz. app.ts).
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 9 — okuma/yükleme/altText/klasör
 * oluştur-yeniden adlandır-taşı: ADMIN/MANAGER/EDITOR; kalıcı silme (medya/klasör): ADMIN+MANAGER.
 */
export async function adminMediaRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: { response: { 201: MediaUploadResponseSchema } },
    },
    async (request, reply) => {
      // §10.11 — opsiyonel `folderId` alanı dosyadan ÖNCE ya da SONRA gelebilir, bu yüzden
      // `request.file()` yerine `request.parts()` ile TÜM parçalar elle tüketilir (import.routes.ts
      // ile AYNI desen). Global multipart limitleri (bkz. plugins/uploads.ts, MAX_UPLOAD_BYTES/files:1)
      // register anında ayarlandığı için burada AYRICA belirtilmesine gerek yoktur.
      const parts = request.parts();

      let filename: string | undefined;
      let mimetype: string | undefined;
      let buffer: Buffer | undefined;
      let folderIdRaw: string | undefined;
      let purposeRaw: string | undefined;

      for await (const part of parts) {
        if (part.type === "file") {
          if (buffer !== undefined) {
            // İkinci bir dosya parçası — global `files: 1` limiti zaten bunu engeller, ama
            // savunma derinliği olarak stream'i tüketip atlıyoruz.
            part.file.resume();
            continue;
          }
          filename = part.filename;
          mimetype = part.mimetype;
          // Boyut aşımında `toBuffer()` `FST_REQ_FILE_TOO_LARGE` fırlatır (bkz. plugins/error-handler.ts).
          buffer = await part.toBuffer();
        } else if (part.fieldname === "folderId") {
          folderIdRaw = String(part.value);
        } else if (part.fieldname === "purpose") {
          // Paket AE-ek — "logo" (PNG uyumluluk kopyası) | "icon" (favicon: ana sürüm PNG kalır).
          purposeRaw = String(part.value);
        }
      }

      if (!buffer || !filename || !mimetype) {
        throw new ValidationError("Yüklenecek dosya bulunamadı.", { file: ["Zorunlu."] });
      }
      const purpose: ImagePurpose = purposeRaw && PURPOSES.has(purposeRaw as ImagePurpose) ? (purposeRaw as ImagePurpose) : "default";
      // Paket AE-ek — iPhone HEIC/HEIF içerikten tanınır; sharp okuyabiliyorsa WebP'ye çevrilir, okuyamıyorsa
      // (hazır sharp derlemesi HEVC tabanlı HEIC'i açamaz) anlaşılır mesajla reddedilir.
      const isHeif = isHeifImage(buffer);
      if (!isHeif && !ALLOWED_MIME_TYPES.has(mimetype) && !CORRECTABLE_DECLARED_TYPES.has(mimetype)) {
        throw new ValidationError("Desteklenmeyen dosya türü.", {
          file: ["Yalnızca JPEG, PNG, WEBP veya GIF yükleyebilirsiniz."],
        });
      }

      // §10.11 — `folderId` UUID doğrulaması ve klasör varlık kontrolü, dosya DİSKE YAZILMADAN
      // ÖNCE yapılır (aksi hâlde DB kaydı olmayan yetim dosya kalırdı).
      let folderId: string | null = null;
      if (folderIdRaw !== undefined && folderIdRaw !== "") {
        const parsedFolderId = z.string().uuid().safeParse(folderIdRaw);
        if (!parsedFolderId.success) {
          throw new ValidationError("Geçersiz `folderId`.", { folderId: ["UUID olmalıdır."] });
        }
        const folder = await app.prisma.mediaFolder.findUnique({ where: { id: parsedFolderId.data } });
        if (!folder) {
          throw new NotFoundError("`folderId` gönderildi ama böyle bir klasör yok.");
        }
        folderId = parsedFolderId.data;
      }

      // GÜVENLİK: `part.mimetype` istemcinin (multipart Content-Type başlığı üzerinden) BEYAN
      // ettiği değerdir, doğrulanmamıştır — sahte bir Content-Type ile keyfi içerik (örn. HTML/JS)
      // yüklenip diskte servis edilebilir (stored-XSS). Gerçek tür, buffer'ın ilk baytlarından
      // (magic byte) `detectUploadMimeType` (görsel + PDF, §2.2) ile tespit edilir; beyan
      // edilenle uyuşmuyorsa ya da tanınmıyorsa/SVG ise istek reddedilir. import.worker.ts
      // (§10.8.7) ile aynı kod yolu (o modül yalnızca görsel bekler, `detectImageMimeType`'ı
      // DEĞİŞMEDEN kullanmaya devam eder).
      const detected = isHeif ? { mimeType: "image/heic", isSvg: false } : detectUploadMimeType(buffer);
      if (!detected.mimeType || detected.isSvg) {
        throw new ValidationError("Dosya içeriği geçerli bir görsel veya PDF değil.", {
          file: ["Dosya içeriği tanınan bir görsel (JPEG/PNG/WEBP/GIF) ya da PDF biçimiyle eşleşmiyor."],
        });
      }
      // Paket AE — beyan ile içerik farklıysa (ör. `.PNG` uzantılı JPEG) tür İÇERİKTEN alınır, dosya adı
      // uzantısı düzeltilir ve kullanıcıya bilgi verilir. Güvenlik değişmez: kaydedilen tür ve diskteki uzantı
      // zaten yalnızca tespit edilen türden gelir. Görsel ↔ PDF karışması (seçici yanlış türde dosya alır) reddedilir.
      let notice: { code: "TYPE_CORRECTED"; detectedMimeType: string; message: string } | undefined;
      if (!isHeif && detected.mimeType !== mimetype) {
        const declaredIsImage = mimetype.startsWith("image/") || CORRECTABLE_DECLARED_TYPES.has(mimetype);
        if (!declaredIsImage || !detected.mimeType.startsWith("image/")) {
          throw new ValidationError("Beyan edilen dosya türü, dosya içeriğiyle uyuşmuyor.", {
            file: [`Content-Type "${mimetype}" olarak beyan edildi ama dosya içeriği "${detected.mimeType}" olarak tespit edildi.`],
          });
        }
        filename = filenameForMimeType(filename, detected.mimeType);
        notice = { code: "TYPE_CORRECTED", detectedMimeType: detected.mimeType, message: `Dosya ${mimeTypeLabel(detected.mimeType)} olarak kaydedildi.` };
      }

      // Paket AE-ek — JPEG/PNG/WebP/HEIC: WebP'ye çevrilir, meta veri (EXIF/GPS) silinir, uyumluluk kopyaları yazılır.
      // Orijinal saklanmaz. GIF ve PDF eskisi gibi olduğu gibi saklanır.
      if (isHeif || CONVERTIBLE_IMAGE_TYPES.has(detected.mimeType)) {
        let stored;
        try {
          stored = await processAndStoreSiteImage(buffer, filename, { purpose, isHeif });
        } catch (err) {
          if (err instanceof ImageProcessingError) throw new ValidationError(err.message, { file: [err.message] });
          throw err;
        }
        let media;
        try {
          media = await app.prisma.media.create({ data: { ...stored.data, folderId } });
        } catch (err) {
          await removeStoredPaths(stored.writtenPaths);
          throw err;
        }
        const label = mimeTypeLabel(stored.processed.main.mimeType);
        const prefix = notice ? `Dosya aslında ${mimeTypeLabel(detected.mimeType)}; ` : "";
        const converted = {
          code: "CONVERTED" as const,
          detectedMimeType: isHeif ? "image/heic" : detected.mimeType,
          message: `${prefix}${label} olarak kaydedildi (${formatBytes(buffer.byteLength)} → ${formatBytes(stored.data.sizeBytes)}); konum ve kamera bilgileri silindi.`,
        };
        return reply.code(201).send(ok(toMediaDto(media), { notice: converted }));
      }

      const { path: storedPath, url } = await storage.save({
        buffer,
        filename,
        mimeType: detected.mimeType,
      });

      // Piksel boyutu (width/height) yalnızca GÖRSEL için anlamlıdır. §2.2 madde 1 — PDF için
      // `imageSize()` HİÇ ÇAĞRILMAZ, `width`/`height` `null` kalır (bozuk dosya/kütüphanenin
      // desteklemediği bir edge-case için de aynı sessiz-null davranışı korunur).
      let width: number | null = null;
      let height: number | null = null;
      if (detected.mimeType.startsWith("image/")) {
        try {
          const dimensions = imageSize(buffer);
          width = dimensions.width;
          height = dimensions.height;
        } catch {
          width = null;
          height = null;
        }
      }

      const media = await app.prisma.media.create({
        data: {
          path: storedPath,
          url,
          filename,
          mimeType: detected.mimeType,
          sizeBytes: buffer.byteLength,
          width,
          height,
          folderId,
        },
      });

      return reply.code(201).send(notice ? ok(toMediaDto(media), { notice }) : ok(toMediaDto(media)));
    }
  );

  await registerVideoUploadRoutes(app);

  server.get(
    "/",
    {
      config: { rateLimit: MEDIA_LIST_RATE_LIMIT },
      schema: { querystring: MediaListQuerySchema, response: { 200: ApiSuccessSchema(z.array(MediaSchema)) } },
    },
    async (request, reply) => {
      const { cursor, limit, folderId, type } = request.query;
      const cursorSeq = parseCursor(cursor);

      // §10.11 — `folderId` filtresi SUNUCU taraflıdır ve ÖZYİNELEMELİ DEĞİLDİR: `none` =
      // yalnızca "Kategorisiz" (`folderId IS NULL`), UUID = yalnızca o klasördeki medya (alt
      // klasörlerdekiler DAHİL EDİLMEZ). Var olmayan bir UUID → boş liste + 200 (404 DEĞİL).
      const folderWhere: Prisma.MediaWhereInput = folderId === undefined ? {} : folderId === "none" ? { folderId: null } : { folderId };

      // §2.2 madde 6 — `image` = `mimeType LIKE 'image/%'`, `document` = `mimeType =
      // 'application/pdf'`. Verilmezse filtre uygulanmaz (bkz. openapi.yaml::MediaTypeFilter).
      const typeWhere: Prisma.MediaWhereInput =
        type === "image"
          ? { mimeType: { startsWith: "image/" } }
          : type === "document"
            ? { mimeType: "application/pdf" }
            : type === "video"
              ? { mimeType: "video/mp4" }
              : {};

      const rows = await app.prisma.media.findMany({
        where: { ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}), ...folderWhere, ...typeWhere },
        orderBy: { seq: "asc" },
        take: limit,
      });

      return reply.send(ok(rows.map(toMediaDto), buildPageMeta(rows, limit)));
    }
  );

  // ---------------------------------------------------------------------------
  // §10.11 Medya Kütüphanesi — Klasörler. Statik segmentler (`/folders`, `/move`) — find-my-way
  // bunları `/:mediaId` parametresinden ÖNCE eşleştirir, çakışma YOKTUR (bkz. openapi.yaml notu).
  // ---------------------------------------------------------------------------

  server.get(
    "/folders",
    {
      config: { rateLimit: MEDIA_LIST_RATE_LIMIT },
      schema: { response: { 200: ApiSuccessSchema(z.array(MediaFolderSchema)) } },
    },
    async (_request, reply) => {
      // Karar — düz (flat) dizi + `(parentId NULLS FIRST, name ASC)` sıralama: kök klasörler her
      // zaman alt klasörlerden ÖNCE gelir, tüketici tek geçişte ağacı kurar (bkz. ARCHITECTURE.md
      // §10.11.1, NavigationItem ile AYNI patern). Sayfalama/arama YOKTUR (v1 varsayımı: ~200 altı
      // klasör).
      const rows = await app.prisma.mediaFolder.findMany({
        orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { name: "asc" }],
        include: { _count: { select: { media: true } } },
      });
      return reply.send(ok(rows.map(toMediaFolderDto)));
    }
  );

  server.post(
    "/folders",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: { body: CreateMediaFolderRequestSchema, response: { 201: ApiSuccessSchema(MediaFolderSchema) } },
    },
    async (request, reply) => {
      const { name, parentId } = request.body;
      const normalizedParentId = parentId ?? null;

      // `parentId` verilirse hedefin KENDİ `parentId`'si null OLMALIDIR (maksimum derinlik 2).
      if (normalizedParentId !== null) {
        await assertValidParent(app, normalizedParentId);
      }

      await assertNameAvailable(app, name, normalizedParentId);

      const folder = await app.prisma.mediaFolder.create({
        data: { name, parentId: normalizedParentId },
        ...FOLDER_WITH_COUNT,
      });

      return reply.code(201).send(ok(toMediaFolderDto(folder)));
    }
  );

  server.patch(
    "/folders/:folderId",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: {
        params: MediaFolderIdParamSchema,
        body: UpdateMediaFolderRequestSchema,
        response: { 200: ApiSuccessSchema(MediaFolderSchema) },
      },
    },
    async (request, reply) => {
      const { folderId } = request.params;
      const folder = await app.prisma.mediaFolder.findUnique({ where: { id: folderId } });
      if (!folder) throw new NotFoundError("Klasör bulunamadı.");

      const { name: nameInput, parentId: parentIdInput } = request.body;
      // Alanın HİÇ gönderilmemesi ("değiştirme") ile `parentId: null` ("köke taşı") ayrı
      // anlamlara sahiptir (bkz. ARCHITECTURE.md §10.11.1) — `!== undefined` ile ayrıştırılır.
      const parentIdProvided = parentIdInput !== undefined;
      const effectiveName = nameInput !== undefined ? nameInput : folder.name;
      const effectiveParentId = parentIdProvided ? parentIdInput : folder.parentId;

      if (parentIdProvided) {
        // Klasör kendi kendinin parent'ı olamaz.
        if (effectiveParentId === folder.id) {
          throw new ValidationError("Bir klasör kendi id'sini parentId olarak veremez (kendine referans).", {
            parentId: ["Kendi kendinin üst klasörü olamaz."],
          });
        }

        if (effectiveParentId !== null) {
          // Hedef üst klasörün `parentId`'si null OLMALIDIR (derinlik 2).
          await assertValidParent(app, effectiveParentId);

          // Klasörün KENDİ alt klasörleri varsa başka bir klasörün altına taşınamaz (derinlik aşımı).
          const childCount = await app.prisma.mediaFolder.count({ where: { parentId: folder.id } });
          if (childCount > 0) {
            throw new ValidationError(
              "Alt klasörleri olan bir klasör başka bir klasörün altına taşınamaz. Önce alt klasörleri köke taşıyın.",
              { parentId: ["Bu klasörün alt klasörleri var."] }
            );
          }
        }
      }

      if (nameInput !== undefined || parentIdProvided) {
        await assertNameAvailable(app, effectiveName, effectiveParentId, folder.id);
      }

      const data: Prisma.MediaFolderUpdateInput = {};
      if (nameInput !== undefined) data.name = nameInput;
      if (parentIdProvided) data.parent = effectiveParentId === null ? { disconnect: true } : { connect: { id: effectiveParentId } };

      const updated = await app.prisma.mediaFolder.update({
        where: { id: folder.id },
        data,
        ...FOLDER_WITH_COUNT,
      });

      return reply.send(ok(toMediaFolderDto(updated)));
    }
  );

  server.delete(
    "/folders/:folderId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: MediaFolderIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const { folderId } = request.params;
      const folder = await app.prisma.mediaFolder.findUnique({ where: { id: folderId } });
      if (!folder) throw new NotFoundError("Klasör bulunamadı.");

      // FK `onDelete: SetNull` (hem `Media.folderId` hem `MediaFolder.parentId` self-relation)
      // yan etkileri DB seviyesinde ifade eder — içindeki medya "Kategorisiz"e düşer, alt
      // klasörler köke çıkar. Elle `updateMany` YAZILMAZ (bkz. ARCHITECTURE.md §10.11.3).
      await app.prisma.mediaFolder.delete({ where: { id: folder.id } });

      return reply.code(204).send();
    }
  );

  server.post(
    "/move",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: { body: MoveMediaRequestSchema, response: { 200: ApiSuccessSchema(MoveMediaResultSchema) } },
    },
    async (request, reply) => {
      const { mediaIds, folderId } = request.body;
      // Tekrarlı id'ler sunucuda teklenir (dedupe).
      const dedupedIds = Array.from(new Set(mediaIds));

      if (folderId !== null) {
        const folder = await app.prisma.mediaFolder.findUnique({ where: { id: folderId } });
        if (!folder) throw new NotFoundError("Hedef klasör bulunamadı.");
      }

      const existing = await app.prisma.media.findMany({
        where: { id: { in: dedupedIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((m) => m.id));
      const skippedIds = dedupedIds.filter((id) => !existingIds.has(id));

      // Zaten hedef klasörde olan medya da "taşındı" sayılır (idempotent) — `updateMany` mevcut
      // `folderId` değerinden bağımsız olarak tüm bulunan kayıtları günceller. Tek sorgu — id
      // başına sorgu YASAK (bkz. ARCHITECTURE.md §10.11.4).
      const result =
        existingIds.size > 0
          ? await app.prisma.media.updateMany({
              where: { id: { in: Array.from(existingIds) } },
              data: { folderId },
            })
          : { count: 0 };

      return reply.send(
        ok({
          folderId,
          requestedCount: dedupedIds.length,
          movedCount: result.count,
          skippedIds,
        })
      );
    }
  );

  server.patch(
    "/:mediaId",
    {
      preHandler: requireSiteRole(...ROLES_PANEL),
      schema: {
        params: MediaIdParamSchema,
        body: UpdateMediaAltTextRequestSchema,
        response: { 200: ApiSuccessSchema(MediaSchema) },
      },
    },
    async (request, reply) => {
      const media = await app.prisma.media.findUnique({ where: { id: request.params.mediaId } });
      if (!media) throw new NotFoundError("Medya bulunamadı.");

      const updated = await app.prisma.media.update({
        where: { id: media.id },
        data: { altText: request.body.altText },
      });

      return reply.send(ok(toMediaDto(updated)));
    }
  );

  server.delete(
    "/:mediaId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: MediaIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const media = await app.prisma.media.findUnique({ where: { id: request.params.mediaId }, include: { transcodeJob: { select: { sourcePath: true } } } });
      if (!media) throw new NotFoundError("Medya bulunamadı.");
      // Paket AE-ek — dönüştürülmeyi bekleyen/başarısız videonun özel klasördeki orijinali de silinir.
      if (media.transcodeJob?.sourcePath) await fs.promises.unlink(sourceFilePath(media.transcodeJob.sourcePath)).catch(() => undefined);

      await app.prisma.media.delete({ where: { id: media.id } });
      if (media.path) await storage.remove(media.path).catch(() => {});
      // Paket AE-ek — uyumluluk kopyaları da silinir.
      await removeStoredPaths(variantPaths(media.variants));

      return reply.code(204).send();
    }
  );
}
