import { randomUUID } from "node:crypto";
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
import { SliderSchema, SlideSchema, PublicSliderSchema, SliderListMetaSchema, SliderSummarySchema, SliderUsageSchema } from "../../schemas/entities";
import { toSliderDto, toSliderSummaryDto, toSlideDto, toPublicSliderDto, toSliderUsageDto, toMediaDto } from "../../mappers";
import { ConflictError, NotFoundError, SliderInUseError, ValidationError } from "../../lib/errors";
import { isImageMimeType } from "../../lib/mime-detect";
import { parseCursor, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { logAudit } from "../../lib/audit";
import { triggerPublicPageRevalidation } from "../../lib/revalidate";
import { parseSlideLayers, type SliderLayer } from "./lib/layers";
import { MAX_SLIDES_PER_SLIDER } from "./lib/constants";
import { findSliderUsage } from "./lib/slider-usage";
import {
  TRANSITION_EFFECT_TO_PRISMA,
  HEIGHT_MODE_TO_PRISMA,
  BACKGROUND_TYPE_TO_PRISMA,
  NAVIGATION_THEME_TO_PRISMA,
  WIDTH_MODE_TO_PRISMA,
  heightModeToPrisma,
} from "./lib/enum-maps";
import {
  SliderIdParamSchema,
  SlideIdParamSchema,
  ListSlidersQuerySchema,
  DeleteSliderQuerySchema,
  CreateSliderRequestSchema,
  UpdateSliderRequestSchema,
  CreateSlideRequestSchema,
  UpdateSlideRequestSchema,
  ReorderSlidesRequestSchema,
} from "./sliders.schemas";

/**
 * §2.2 madde 5 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) ve openapi.yaml
 * `POST /admin/media` açıklaması — `Slide.bgMediaId`/`bgVideoPosterMediaId` `image/*` DIŞINDAKİ
 * medyayı `422` ile REDDEDER (`products.routes.ts::assertImageMedia` ile AYNI kural).
 */
async function assertImageMedia(app: FastifyInstance, mediaId: string): Promise<void> {
  const media = await app.prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new NotFoundError("Medya bulunamadı.");
  if (!isImageMimeType(media.mimeType)) {
    throw new ValidationError("Bu alan yalnızca görsel medya kabul eder.", {
      mediaId: ["Seçilen dosya bir görsel değil."],
    });
  }
}

/** Slayt detay/liste sorgularında arka plan medyalarını da dönmek için (bkz. portfolio.routes.ts::WITH_RELATIONS). */
const WITH_SLIDE_RELATIONS = { bgMedia: true, bgVideoPosterMedia: true } as const;
const SLIDES_ORDER_ASC = { orderBy: { order: "asc" as const } };

/** `slug` verilmezse `name`'den üretilir, çakışmada `-2`/`-3`… eki (bkz. `import.worker.ts::findAvailableSlug` AYNI desen). */
async function findAvailableSliderSlug(app: FastifyInstance, base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (await app.prisma.slider.findFirst({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/**
 * `@@unique([sliderId, order])` uyarısı (§2.5, db-agent bağlayıcı notu) — ara adımlarda çift
 * `order` çakışmasını önlemek için İKİ AŞAMALI: (1) tüm satırları geçici NEGATİF `order`'a
 * taşı, (2) hedef `0..n-1` değerlerini yaz. `orderedIds` HEDEF sırayı (0. indeks = order 0)
 * temsil eder.
 */
async function renumberSlides(tx: Prisma.TransactionClient, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.slide.update({ where: { id: orderedIds[i]! }, data: { order: -(i + 1) } });
  }
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.slide.update({ where: { id: orderedIds[i]! }, data: { order: i } });
  }
}

/**
 * Bir slider güncellendiğinde onu KULLANAN tüm (silinmemiş) sayfaların public path'lerini
 * anında revalidate eder — bkz. lib/revalidate.ts. Best-effort (triggerPublicPageRevalidation
 * kendi içinde try/catch'li), admin isteğini ASLA bloklamaz/reddetmez.
 */
async function revalidateSliderPages(app: FastifyInstance, sliderId: string): Promise<void> {
  const usage = await findSliderUsage(app, sliderId);
  const seen = new Set<string>();
  for (const entry of usage) {
    if (entry.pageDeletedAt !== null || seen.has(entry.pageId)) continue;
    seen.add(entry.pageId);
    await triggerPublicPageRevalidation(
      app,
      { id: entry.pageId, slug: entry.pageSlug, translations: {} },
      { isHomePage: entry.isHomePage }
    );
  }
}

/** Katman `id`'lerini YENİDEN ÜRETİR (slider/slayt kopyalanırken bağlayıcı, bkz. openapi.yaml `duplicate` açıklamaları). */
function regenerateLayerIds(layersRaw: Prisma.JsonValue): SliderLayer[] {
  const layers = Array.isArray(layersRaw) ? (layersRaw as unknown as SliderLayer[]) : [];
  return layers.map((layer) => ({ ...layer, id: randomUUID() }));
}

/** `UpdateSliderRequestSchema`'nın ayar alanlarını Prisma `update` gövdesine çevirir — YALNIZCA gönderilen alanlar dokunulur. */
function buildSliderSettingsData(body: z.infer<typeof UpdateSliderRequestSchema>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (body.autoplay !== undefined) data.autoplay = body.autoplay;
  if (body.intervalMs !== undefined) data.intervalMs = body.intervalMs;
  if (body.loop !== undefined) data.loop = body.loop;
  if (body.pauseOnHover !== undefined) data.pauseOnHover = body.pauseOnHover;
  if (body.transitionEffect !== undefined) data.transitionEffect = TRANSITION_EFFECT_TO_PRISMA[body.transitionEffect];
  if (body.transitionDurationMs !== undefined) data.transitionDurationMs = body.transitionDurationMs;
  if (body.heightMode !== undefined) data.heightMode = HEIGHT_MODE_TO_PRISMA[body.heightMode];
  if (body.heightPx !== undefined) data.heightPx = body.heightPx;
  if (body.aspectRatioWidth !== undefined) data.aspectRatioWidth = body.aspectRatioWidth;
  if (body.aspectRatioHeight !== undefined) data.aspectRatioHeight = body.aspectRatioHeight;
  if (body.mobileHeightMode !== undefined) data.mobileHeightMode = heightModeToPrisma(body.mobileHeightMode);
  if (body.mobileHeightPx !== undefined) data.mobileHeightPx = body.mobileHeightPx;
  if (body.mobileAspectRatioWidth !== undefined) data.mobileAspectRatioWidth = body.mobileAspectRatioWidth;
  if (body.mobileAspectRatioHeight !== undefined) data.mobileAspectRatioHeight = body.mobileAspectRatioHeight;
  if (body.widthMode !== undefined) data.widthMode = WIDTH_MODE_TO_PRISMA[body.widthMode];
  if (body.showArrows !== undefined) data.showArrows = body.showArrows;
  if (body.showBullets !== undefined) data.showBullets = body.showBullets;
  if (body.showProgressBar !== undefined) data.showProgressBar = body.showProgressBar;
  if (body.navigationTheme !== undefined) data.navigationTheme = NAVIGATION_THEME_TO_PRISMA[body.navigationTheme];
  return data;
}

type SlideWriteBody = Omit<z.infer<typeof UpdateSlideRequestSchema>, "layers">;

/** `UpdateSlideRequestSchema`/`CreateSlideRequestSchema`'nın (layers/order HARİÇ) alanlarını Prisma gövdesine çevirir. */
function buildSlideWriteData(body: SlideWriteBody): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.label !== undefined) data.label = body.label;
  if (body.bgType !== undefined) data.bgType = BACKGROUND_TYPE_TO_PRISMA[body.bgType];
  if (body.bgMediaId !== undefined) data.bgMediaId = body.bgMediaId;
  if (body.bgVideoUrl !== undefined) data.bgVideoUrl = body.bgVideoUrl;
  if (body.bgVideoPosterMediaId !== undefined) data.bgVideoPosterMediaId = body.bgVideoPosterMediaId;
  if (body.bgPositionX !== undefined) data.bgPositionX = body.bgPositionX;
  if (body.bgPositionY !== undefined) data.bgPositionY = body.bgPositionY;
  if (body.bgOverlayColor !== undefined) data.bgOverlayColor = body.bgOverlayColor;
  if (body.bgOverlayOpacity !== undefined) data.bgOverlayOpacity = body.bgOverlayOpacity;
  if (body.bgGradientFrom !== undefined) data.bgGradientFrom = body.bgGradientFrom;
  if (body.bgGradientTo !== undefined) data.bgGradientTo = body.bgGradientTo;
  if (body.bgGradientAngle !== undefined) data.bgGradientAngle = body.bgGradientAngle;
  if (body.bgKenBurns !== undefined) data.bgKenBurns = body.bgKenBurns;
  if (body.durationMs !== undefined) data.durationMs = body.durationMs;
  if (body.linkHref !== undefined) data.linkHref = body.linkHref;
  if (body.linkNewTab !== undefined) data.linkNewTab = body.linkNewTab;
  return data;
}

/** `/admin/sliders` prefix'i altında bağlanır (bkz. app.ts) — §1.7 yetki tablosu: okuma ADMIN/MANAGER/EDITOR, yazma ADMIN/MANAGER. */
export async function adminSlidersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  // ---- Slider CRUD ----------------------------------------------------------------------

  server.get(
    "/",
    {
      schema: {
        querystring: ListSlidersQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(SliderSummarySchema), SliderListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, trashed, search } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.SliderWhereInput = {
        ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        ...(trashed === "exclude" ? { deletedAt: null } : trashed === "only" ? { deletedAt: { not: null } } : {}),
        ...(search
          ? {
              OR: [{ name: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }],
            }
          : {}),
      };

      const [rows, active, trashedCount] = await Promise.all([
        app.prisma.slider.findMany({
          where,
          orderBy: { seq: "asc" },
          take: limit,
          include: {
            _count: { select: { slides: true } },
            slides: { where: { isActive: true, bgType: "IMAGE" }, orderBy: { order: "asc" }, take: 1, include: { bgMedia: true } },
          },
        }),
        app.prisma.slider.count({ where: { deletedAt: null } }),
        app.prisma.slider.count({ where: { deletedAt: { not: null } } }),
      ]);

      const dtos = rows.map((row) => {
        const previewImageUrl = row.slides[0]?.bgMedia ? toMediaDto(row.slides[0].bgMedia).url : null;
        return toSliderSummaryDto(row, row._count.slides, previewImageUrl);
      });

      return reply.send(ok(dtos, buildPageMetaWithCounts(rows, limit, { active, trashed: trashedCount })));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { body: CreateSliderRequestSchema, response: { 201: ApiSuccessSchema(SliderSchema) } },
    },
    async (request, reply) => {
      const { name, slug, widthMode } = request.body;
      // Açık `slug` çakışırsa DB `@unique` kısıtı P2002 fırlatır → merkezi hata işleyici 409'a
      // çevirir (bkz. plugins/error-handler.ts). YALNIZCA `name`'den TÜRETİLEN slug otomatik
      // `-2`/`-3` eki ile çakışmasız hale getirilir (openapi.yaml açıklamasıyla BİREBİR).
      const resolvedSlug = slug ? slugify(slug) : await findAvailableSliderSlug(app, slugify(name));

      const created = await app.prisma.slider.create({
        data: {
          name,
          slug: resolvedSlug,
          ...(widthMode !== undefined && { widthMode: WIDTH_MODE_TO_PRISMA[widthMode] }),
        },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slider.create",
        targetType: "Slider",
        targetId: created.id,
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok(toSliderDto({ ...created, slides: [] })));
    }
  );

  server.get(
    "/:sliderId",
    {
      schema: { params: SliderIdParamSchema, response: { 200: ApiSuccessSchema(SliderSchema) } },
    },
    async (request, reply) => {
      // Çöpteki slider da döner (geri yükleme ekranı için) — deletedAt filtresi YOK.
      const slider = await app.prisma.slider.findUnique({
        where: { id: request.params.sliderId },
        include: { slides: { include: WITH_SLIDE_RELATIONS, ...SLIDES_ORDER_ASC } },
      });
      if (!slider) throw new NotFoundError("Slider bulunamadı.");
      return reply.send(ok(toSliderDto(slider)));
    }
  );

  server.patch(
    "/:sliderId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, body: UpdateSliderRequestSchema, response: { 200: ApiSuccessSchema(SliderSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!existing) throw new NotFoundError("Slider bulunamadı.");
      if (existing.deletedAt) throw new ConflictError("Çöpteki slider düzenlenemez. Önce geri yükleyin.");

      const { name, slug } = request.body;
      const settingsData = buildSliderSettingsData(request.body);

      const updated = await app.prisma.slider.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(slug !== undefined ? { slug: slugify(slug) } : {}),
          ...settingsData,
        },
        include: { slides: { include: WITH_SLIDE_RELATIONS, ...SLIDES_ORDER_ASC } },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slider.update",
        targetType: "Slider",
        targetId: updated.id,
        ipAddress: request.ip,
      });

      await revalidateSliderPages(app, updated.id);

      return reply.send(ok(toSliderDto(updated)));
    }
  );

  // Referans koruması (§4.3, bağlayıcı) — kullanımda olan bir slider `force=true` OLMADAN
  // çöpe taşınamaz. İdempotenttir (zaten çöpteyse hiçbir şey yapmaz, kullanım kontrolü DAHİ
  // ATLANIR — bkz. portfolio.routes.ts::"/:itemId" DELETE AYNI idempotency deseni).
  server.delete(
    "/:sliderId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, querystring: DeleteSliderQuerySchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!existing) throw new NotFoundError("Slider bulunamadı.");

      if (!existing.deletedAt) {
        if (!request.query.force) {
          const usage = await findSliderUsage(app, existing.id);
          if (usage.length > 0) {
            throw new SliderInUseError("Slider bir veya daha fazla sayfada kullanılıyor.", usage.map(toSliderUsageDto));
          }
        }

        await app.prisma.slider.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "slider.delete",
          targetType: "Slider",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      return reply.code(204).send();
    }
  );

  server.post(
    "/:sliderId/restore",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, response: { 200: ApiSuccessSchema(SliderSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!existing) throw new NotFoundError("Slider bulunamadı.");

      if (existing.deletedAt) {
        await app.prisma.slider.update({ where: { id: existing.id }, data: { deletedAt: null } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "slider.restore",
          targetType: "Slider",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      const slider = await app.prisma.slider.findUnique({
        where: { id: existing.id },
        include: { slides: { include: WITH_SLIDE_RELATIONS, ...SLIDES_ORDER_ASC } },
      });
      return reply.send(ok(toSliderDto(slider!)));
    }
  );

  server.delete(
    "/:sliderId/permanent",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!existing) throw new NotFoundError("Slider bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce slider'ı çöpe taşıyın.");

      // Slaytlar `onDelete: Cascade` ile gider; `Media` kayıtları ASLA silinmez.
      await app.prisma.slider.delete({ where: { id: existing.id } });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slider.permanent_delete",
        targetType: "Slider",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  // DERİN kopya — slaytlar ve `layers` dahil. Katman id'leri YENİDEN ÜRETİLİR (bağlayıcı).
  // Audit: yeni `Slider`/`Slide` SATIRLARI oluştuğu için `slider.create`/`slide.create`
  // eylemleriyle kaydedilir (§3.4'te AYRI bir "duplicate" eylemi TANIMLANMAMIŞTIR).
  server.post(
    "/:sliderId/duplicate",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, response: { 201: ApiSuccessSchema(SliderSchema) } },
    },
    async (request, reply) => {
      const source = await app.prisma.slider.findUnique({
        where: { id: request.params.sliderId },
        include: { slides: { ...SLIDES_ORDER_ASC } },
      });
      if (!source) throw new NotFoundError("Slider bulunamadı.");

      const newName = `${source.name} (kopya)`;
      const newSlug = await findAvailableSliderSlug(app, slugify(newName));

      const duplicated = await app.prisma.$transaction(async (tx) => {
        const slider = await tx.slider.create({
          data: {
            name: newName,
            slug: newSlug,
            autoplay: source.autoplay,
            intervalMs: source.intervalMs,
            loop: source.loop,
            pauseOnHover: source.pauseOnHover,
            transitionEffect: source.transitionEffect,
            transitionDurationMs: source.transitionDurationMs,
            heightMode: source.heightMode,
            heightPx: source.heightPx,
            aspectRatioWidth: source.aspectRatioWidth,
            aspectRatioHeight: source.aspectRatioHeight,
            mobileHeightMode: source.mobileHeightMode,
            mobileHeightPx: source.mobileHeightPx,
            mobileAspectRatioWidth: source.mobileAspectRatioWidth,
            mobileAspectRatioHeight: source.mobileAspectRatioHeight,
            widthMode: source.widthMode,
            showArrows: source.showArrows,
            showBullets: source.showBullets,
            showProgressBar: source.showProgressBar,
            navigationTheme: source.navigationTheme,
          },
        });

        for (const slide of source.slides) {
          await tx.slide.create({
            data: {
              sliderId: slider.id,
              // Farklı `sliderId` — `@@unique([sliderId, order])` çakışmaz, `order` AYNEN kopyalanır.
              order: slide.order,
              isActive: slide.isActive,
              label: slide.label,
              bgType: slide.bgType,
              bgMediaId: slide.bgMediaId,
              bgVideoUrl: slide.bgVideoUrl,
              bgVideoPosterMediaId: slide.bgVideoPosterMediaId,
              bgPositionX: slide.bgPositionX,
              bgPositionY: slide.bgPositionY,
              bgOverlayColor: slide.bgOverlayColor,
              bgOverlayOpacity: slide.bgOverlayOpacity,
              bgGradientFrom: slide.bgGradientFrom,
              bgGradientTo: slide.bgGradientTo,
              bgGradientAngle: slide.bgGradientAngle,
              bgKenBurns: slide.bgKenBurns,
              durationMs: slide.durationMs,
              linkHref: slide.linkHref,
              linkNewTab: slide.linkNewTab,
              layers: regenerateLayerIds(slide.layers) as unknown as Prisma.InputJsonValue,
            },
          });
        }

        return tx.slider.findUnique({
          where: { id: slider.id },
          include: { slides: { include: WITH_SLIDE_RELATIONS, ...SLIDES_ORDER_ASC } },
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slider.create",
        targetType: "Slider",
        targetId: duplicated!.id,
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok(toSliderDto(duplicated!)));
    }
  );

  server.get(
    "/:sliderId/usage",
    {
      schema: { params: SliderIdParamSchema, response: { 200: ApiSuccessSchema(z.array(SliderUsageSchema)) } },
    },
    async (request, reply) => {
      const slider = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!slider) throw new NotFoundError("Slider bulunamadı.");

      const usage = await findSliderUsage(app, slider.id);
      return reply.send(ok(usage.map(toSliderUsageDto)));
    }
  );

  // ---- Slide CRUD -------------------------------------------------------------------------

  server.post(
    "/:sliderId/slides",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, body: CreateSlideRequestSchema, response: { 201: ApiSuccessSchema(SlideSchema) } },
    },
    async (request, reply) => {
      const slider = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!slider) throw new NotFoundError("Slider bulunamadı.");

      const { order, layers, ...rest } = request.body;
      const parsedLayers = layers !== undefined ? parseSlideLayers(layers) : undefined;

      if (rest.bgMediaId) await assertImageMedia(app, rest.bgMediaId);
      if (rest.bgVideoPosterMediaId) await assertImageMedia(app, rest.bgVideoPosterMediaId);

      const currentCount = await app.prisma.slide.count({ where: { sliderId: slider.id } });
      if (currentCount >= MAX_SLIDES_PER_SLIDER) {
        throw new ValidationError(`Bir slider en fazla ${MAX_SLIDES_PER_SLIDER} slayt içerebilir.`, {
          slides: [`En fazla ${MAX_SLIDES_PER_SLIDER} slayt olabilir.`],
        });
      }

      let resolvedOrder = order;
      if (resolvedOrder === undefined) {
        const last = await app.prisma.slide.findFirst({ where: { sliderId: slider.id }, orderBy: { order: "desc" } });
        resolvedOrder = last ? last.order + 1 : 0;
      }

      const data = buildSlideWriteData(rest);
      data.sliderId = slider.id;
      data.order = resolvedOrder;
      if (parsedLayers !== undefined) data.layers = parsedLayers as unknown as Prisma.InputJsonValue;

      const created = await app.prisma.slide.create({
        data: data as Prisma.SlideUncheckedCreateInput,
        include: WITH_SLIDE_RELATIONS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slide.create",
        targetType: "Slide",
        targetId: created.id,
        ipAddress: request.ip,
      });

      await revalidateSliderPages(app, slider.id);

      return reply.code(201).send(ok(toSlideDto(created)));
    }
  );

  // `Navigation` PUT'u ile AYNI "tam durum gönder" deseni — bkz. sliders.schemas.ts::ReorderSlidesRequestSchema.
  server.put(
    "/:sliderId/slides/order",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SliderIdParamSchema, body: ReorderSlidesRequestSchema, response: { 200: ApiSuccessSchema(z.array(SlideSchema)) } },
    },
    async (request, reply) => {
      const slider = await app.prisma.slider.findUnique({ where: { id: request.params.sliderId } });
      if (!slider) throw new NotFoundError("Slider bulunamadı.");

      const existingSlides = await app.prisma.slide.findMany({ where: { sliderId: slider.id }, select: { id: true } });
      const existingIds = new Set(existingSlides.map((s) => s.id));
      const requestedIds = request.body.slideIds;
      const requestedIdSet = new Set(requestedIds);

      const hasForeignId = requestedIds.some((id) => !existingIds.has(id));
      const hasDuplicateId = requestedIdSet.size !== requestedIds.length;
      const isComplete = requestedIdSet.size === existingIds.size;

      if (hasForeignId || hasDuplicateId || !isComplete) {
        throw new ValidationError("slideIds bu slider'ın TÜM slaytlarını, eksiksiz ve tekrarsız içermelidir.", {
          slideIds: ["Eksik, fazla veya yabancı bir slayt id'si bulundu."],
        });
      }

      await app.prisma.$transaction(async (tx) => {
        await renumberSlides(tx, requestedIds);
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slide.reorder",
        targetType: "Slider",
        targetId: slider.id,
        ipAddress: request.ip,
      });

      const updated = await app.prisma.slide.findMany({
        where: { sliderId: slider.id },
        include: WITH_SLIDE_RELATIONS,
        ...SLIDES_ORDER_ASC,
      });

      await revalidateSliderPages(app, slider.id);

      return reply.send(ok(updated.map(toSlideDto)));
    }
  );

  server.patch(
    "/:sliderId/slides/:slideId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SlideIdParamSchema, body: UpdateSlideRequestSchema, response: { 200: ApiSuccessSchema(SlideSchema) } },
    },
    async (request, reply) => {
      const { sliderId, slideId } = request.params;
      const existing = await app.prisma.slide.findUnique({ where: { id: slideId } });
      if (!existing || existing.sliderId !== sliderId) throw new NotFoundError("Slayt bulunamadı.");

      const { layers, ...rest } = request.body;
      const parsedLayers = layers !== undefined ? parseSlideLayers(layers) : undefined;

      if (rest.bgMediaId) await assertImageMedia(app, rest.bgMediaId);
      if (rest.bgVideoPosterMediaId) await assertImageMedia(app, rest.bgVideoPosterMediaId);

      const data = buildSlideWriteData(rest);
      if (parsedLayers !== undefined) data.layers = parsedLayers as unknown as Prisma.InputJsonValue;

      const updated = await app.prisma.slide.update({
        where: { id: existing.id },
        data: data as Prisma.SlideUncheckedUpdateInput,
        include: WITH_SLIDE_RELATIONS,
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slide.update",
        targetType: "Slide",
        targetId: updated.id,
        ipAddress: request.ip,
      });

      await revalidateSliderPages(app, sliderId);

      return reply.send(ok(toSlideDto(updated)));
    }
  );

  // Soft-delete YOKTUR — slayt bir "içerik" değildir, slider'ın bir parçasıdır. Kalan
  // slaytların `order` değerleri `0..n-1` olarak sıkıştırılır (tek transaction).
  server.delete(
    "/:sliderId/slides/:slideId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SlideIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const { sliderId, slideId } = request.params;
      const existing = await app.prisma.slide.findUnique({ where: { id: slideId } });
      if (!existing || existing.sliderId !== sliderId) throw new NotFoundError("Slayt bulunamadı.");

      await app.prisma.$transaction(async (tx) => {
        await tx.slide.delete({ where: { id: existing.id } });
        const remaining = await tx.slide.findMany({ where: { sliderId }, orderBy: { order: "asc" }, select: { id: true } });
        await renumberSlides(
          tx,
          remaining.map((s) => s.id)
        );
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slide.delete",
        targetType: "Slide",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      await revalidateSliderPages(app, sliderId);

      return reply.code(204).send();
    }
  );

  // Kopya, kaynağın HEMEN ARDINA eklenir; sonraki slaytların `order` değerleri kaydırılır.
  // Katman id'leri YENİDEN ÜRETİLİR (bkz. slider `duplicate` ile AYNI gerekçe).
  server.post(
    "/:sliderId/slides/:slideId/duplicate",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER),
      schema: { params: SlideIdParamSchema, response: { 201: ApiSuccessSchema(SlideSchema) } },
    },
    async (request, reply) => {
      const { sliderId, slideId } = request.params;
      const existing = await app.prisma.slide.findUnique({ where: { id: slideId } });
      if (!existing || existing.sliderId !== sliderId) throw new NotFoundError("Slayt bulunamadı.");

      const currentCount = await app.prisma.slide.count({ where: { sliderId } });
      if (currentCount >= MAX_SLIDES_PER_SLIDER) {
        throw new ValidationError(`Bir slider en fazla ${MAX_SLIDES_PER_SLIDER} slayt içerebilir.`, {
          slides: [`En fazla ${MAX_SLIDES_PER_SLIDER} slayt olabilir.`],
        });
      }

      const duplicated = await app.prisma.$transaction(async (tx) => {
        // Geçici `order: -1` — normal slaytlar HER ZAMAN `0..n-1` aralığındadır (transaction
        // dışında negatif `order` asla kalıcı olmaz), bu yüzden -1 ÇAKIŞMAZ.
        const created = await tx.slide.create({
          data: {
            sliderId,
            order: -1,
            isActive: existing.isActive,
            label: existing.label,
            bgType: existing.bgType,
            bgMediaId: existing.bgMediaId,
            bgVideoUrl: existing.bgVideoUrl,
            bgVideoPosterMediaId: existing.bgVideoPosterMediaId,
            bgPositionX: existing.bgPositionX,
            bgPositionY: existing.bgPositionY,
            bgOverlayColor: existing.bgOverlayColor,
            bgOverlayOpacity: existing.bgOverlayOpacity,
            bgGradientFrom: existing.bgGradientFrom,
            bgGradientTo: existing.bgGradientTo,
            bgGradientAngle: existing.bgGradientAngle,
            bgKenBurns: existing.bgKenBurns,
            durationMs: existing.durationMs,
            linkHref: existing.linkHref,
            linkNewTab: existing.linkNewTab,
            layers: regenerateLayerIds(existing.layers) as unknown as Prisma.InputJsonValue,
          },
        });

        const rest = await tx.slide.findMany({ where: { sliderId, id: { not: created.id } }, orderBy: { order: "asc" }, select: { id: true } });
        const sourceIndex = rest.findIndex((s) => s.id === existing.id);
        const orderedIds = rest.map((s) => s.id);
        orderedIds.splice(sourceIndex + 1, 0, created.id);

        await renumberSlides(tx, orderedIds);

        return tx.slide.findUnique({ where: { id: created.id }, include: WITH_SLIDE_RELATIONS });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "slide.create",
        targetType: "Slide",
        targetId: duplicated!.id,
        ipAddress: request.ip,
      });

      await revalidateSliderPages(app, sliderId);

      return reply.code(201).send(ok(toSlideDto(duplicated!)));
    }
  );
}

/**
 * `/sliders` prefix'i altında bağlanır — herkese açık (`security: []`), rolsüz. `MODULE_REGISTRY`'ye
 * EKLENMEZ (§1.6, bağlayıcı) — `requireModuleEnabled` middleware'i BU rotalarda KULLANILMAZ.
 */
export async function publicSlidersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/:sliderId",
    {
      schema: { params: SliderIdParamSchema, response: { 200: ApiSuccessSchema(PublicSliderSchema) } },
    },
    async (request, reply) => {
      // Filtre: `deletedAt = null` VE yalnızca `isActive: true` slaytlar, `order asc`.
      const slider = await app.prisma.slider.findFirst({
        where: { id: request.params.sliderId, deletedAt: null },
        include: { slides: { where: { isActive: true }, include: WITH_SLIDE_RELATIONS, ...SLIDES_ORDER_ASC } },
      });
      if (!slider) throw new NotFoundError("Slider bulunamadı.");

      return reply.send(ok(toPublicSliderDto(slider)));
    }
  );
}
