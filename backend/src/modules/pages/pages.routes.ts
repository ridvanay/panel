import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Page } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import {
  ApiSuccessSchema,
  ApiSuccessWithMeta,
  AutosaveResponseSchema,
  ContentListQuerySchema,
  CursorQuerySchema,
} from "../../schemas/common";
import {
  BulkContentActionRequestSchema,
  BulkContentActionResultSchema,
  ContentListMetaSchema,
  ContentRevisionSchema,
  ContentRevisionSummarySchema,
  PageSchema,
} from "../../schemas/entities";
import { toContentRevisionDto, toContentRevisionSummaryDto, toPageDto } from "../../mappers";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { parseCursor, buildPageMetaWithCounts } from "../../lib/pagination";
import { slugify } from "../../lib/slug";
import { startOfUtcDay } from "../../lib/date";
import { detectDeviceType } from "../../lib/device";
import { detectCountry } from "../../lib/geo";
import { touchVisitor } from "../../lib/live-visitors";
import { snapshotBeforeUpdate, listContentRevisions, getContentRevisionOrThrow } from "../../lib/content-revisions";
import { runBulkContentAction, type BulkContentDelegate } from "../../lib/bulk-content-actions";
import { getPageContentCounts } from "../../lib/content-counts";
import { resolveAuthorId } from "../../lib/content-author";
import { logAudit } from "../../lib/audit";
import {
  applyFieldLocalization,
  attachLocalizations,
  attachLocalizationsOne,
  deleteContentSlugsForEntity,
  getLocaleSet,
  mergeTranslations,
  resolveEffectiveLocaleCode,
  resolveEntityIdBySlug,
  syncContentSlugs,
} from "../../lib/localization";
import { sanitizePageBlocks, sanitizePageTranslations } from "./lib/sanitize-blocks";
import { SETTINGS_ID } from "../settings/settings.routes";
import { emitWebhookEvent } from "../../lib/webhook-emitter";
import { toPublicPageDto } from "../public-api/public-api.mappers";
import {
  AutosavePageRequestSchema,
  CreatePageRequestSchema,
  LocaleQuerySchema,
  PageIdParamSchema,
  PageRevisionIdParamSchema,
  PageSlugParamSchema,
  UpdatePageRequestSchema,
} from "./pages.schemas";

/** Sayfa detay/liste sorgularında yazar özetini de dönmek için (bkz. ARCHITECTURE.md §10.7). */
const WITH_AUTHOR = { author: true } as const;

/** Güncellemeden HEMEN ÖNCEKİ alan setini döner (bkz. ARCHITECTURE.md §10.1). */
function toPageSnapshot(page: Page): Record<string, unknown> {
  return {
    title: page.title,
    slug: page.slug,
    blocks: page.blocks,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogTitle: page.ogTitle,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
    isLegalDocument: page.isLegalDocument,
    translations: page.translations,
  };
}

const PAGE_STRING_FIELDS = ["title", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl"] as const;
const PAGE_ARRAY_FIELDS = ["blocks"] as const;

/**
 * §10.5/§5.1 — `applyLocale()` artık `lib/localization.ts`'teki ortak yardımcıyı sarar
 * (bkz. .claude/architect-scope-i18n.md §9 backend-agent madde 2/9). `Page`'e özgü TEK fark:
 * `isLegalDocument: true` VE istenen locale'de çeviri YOKSA (`translated: false`) sessiz
 * fallback UYGULANMAZ — `blocks` BOŞ döner, `title` varsayılan dilden gelmeye devam eder
 * (KVKK m.10 / GDPR m.12, bkz. §5.1). SEO alanları normal fallback'e tabidir; yalnızca
 * `title` ve `blocks` bilinçli olarak istisna dışı/içi tutulur.
 */
function applyPageLocale<T extends Page>(page: T, effectiveLocale: string | undefined, translatedInLocale: boolean): T {
  if (!effectiveLocale) return page;

  if (page.isLegalDocument && !translatedInLocale) {
    const seoLocalized = applyFieldLocalization(
      page,
      effectiveLocale,
      ["seoTitle", "seoDescription", "ogTitle", "canonicalUrl"] as const
    );
    return { ...seoLocalized, blocks: [] } as T;
  }

  return applyFieldLocalization(page, effectiveLocale, PAGE_STRING_FIELDS, PAGE_ARRAY_FIELDS);
}

/** §5.1 — `isLegalDocument` alanını YALNIZCA ADMIN gönderebilir (EDITOR → 403). */
function assertLegalDocumentAuthorized(value: boolean | undefined, actorRole: "ADMIN" | "EDITOR" | "VIEWER"): void {
  if (value === undefined) return;
  if (actorRole !== "ADMIN") {
    throw new ForbiddenError("isLegalDocument alanını yalnızca ADMIN değiştirebilir.");
  }
}

async function toPageDtoLocalized(app: FastifyInstance, page: Parameters<typeof toPageDto>[0]) {
  const localizations = await attachLocalizationsOne(app, "PAGE", page);
  return toPageDto(page, localizations);
}

async function toPageDtosLocalized(app: FastifyInstance, pages: Parameters<typeof toPageDto>[0][]) {
  const map = await attachLocalizations(app, "PAGE", pages);
  return pages.map((page) => toPageDto(page, map.get(page.id) ?? []));
}

/** `/admin/pages` prefix'i altında bağlanır (bkz. app.ts) — tüm durumlar (taslak dahil), authenticated. */
export async function adminPagesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get(
    "/",
    {
      schema: {
        querystring: ContentListQuerySchema,
        response: { 200: ApiSuccessWithMeta(z.array(PageSchema), ContentListMetaSchema) },
      },
    },
    async (request, reply) => {
      const { cursor, limit, trashed, status } = request.query;
      const cursorSeq = parseCursor(cursor);

      const where: Prisma.PageWhereInput = {
        ...(cursorSeq ? { seq: { gt: cursorSeq } } : {}),
        ...(status ? { status } : {}),
        ...(trashed === "exclude" ? { deletedAt: null } : trashed === "only" ? { deletedAt: { not: null } } : {}),
      };

      const [rows, counts] = await Promise.all([
        app.prisma.page.findMany({ where, orderBy: { seq: "asc" }, take: limit, include: WITH_AUTHOR }),
        getPageContentCounts(app.prisma),
      ]);

      return reply.send(ok(await toPageDtosLocalized(app, rows), buildPageMetaWithCounts(rows, limit, counts)));
    }
  );

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: CreatePageRequestSchema, response: { 201: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const {
        title,
        slug,
        status,
        blocks,
        seoTitle,
        seoDescription,
        ogTitle,
        ogImageUrl,
        canonicalUrl,
        noIndex,
        isLegalDocument,
        translations,
        scheduledAt,
      } = request.body;

      assertLegalDocumentAuthorized(isLegalDocument, request.user!.role);

      const resolvedAuthorId = await resolveAuthorId(app, request.body.authorId, request.user!);
      const authorId = resolvedAuthorId === undefined ? request.user!.id : resolvedAuthorId;

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = translations ? sanitizePageTranslations(translations) : {};

      const page = await app.prisma.$transaction(async (tx) => {
        const created = await tx.page.create({
          data: {
            title,
            slug: slug ? slugify(slug) : slugify(title),
            status: status ?? "DRAFT",
            // Stored-XSS koruması: EDITOR de yazabildiği için (ADMIN'den daha az güvenilir bir rol)
            // "text" block'larının `data.html`'i DB'ye yazılmadan önce sanitize edilir — public
            // sitede `dangerouslySetInnerHTML` ile doğrudan render edilir (bkz. lib/html-sanitize.ts).
            blocks: sanitizePageBlocks(blocks ?? []) as Prisma.InputJsonValue,
            seoTitle,
            seoDescription,
            ogTitle,
            ogImageUrl,
            canonicalUrl,
            noIndex,
            isLegalDocument: isLegalDocument ?? false,
            translations: sanitizedTranslations as Prisma.InputJsonValue,
            publishedAt: status === "PUBLISHED" ? new Date() : null,
            // Faz 4 (zamanlanmış yayın) — `CreatePageRequestSchema`'nın `refine`'ı zaten
            // `status === "SCHEDULED"` iken `scheduledAt`'in gelecekte dolu olmasını garanti eder.
            scheduledAt: status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null,
            authorId,
          },
          include: WITH_AUTHOR,
        });

        // §9 backend-agent madde 5 — `ContentSlug` satırları içerikle AYNI transaction'da senkronlanır.
        await syncContentSlugs(tx, enabledLocales, "PAGE", created.id, created.slug, created.translations);

        return created;
      });

      if (isLegalDocument === true) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "content.legal_flag_change",
          targetType: "Page",
          targetId: page.id,
          metadata: { isLegalDocument: true },
          ipAddress: request.ip,
        });
      }

      return reply.code(201).send(ok(await toPageDtoLocalized(app, page)));
    }
  );

  server.get(
    "/:pageId",
    { schema: { params: PageIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } } },
    async (request, reply) => {
      // Çöpteki sayfayı da döner (geri yükleme/onay ekranları için) — deletedAt filtresi YOK.
      const page = await app.prisma.page.findUnique({ where: { id: request.params.pageId }, include: WITH_AUTHOR });
      if (!page) throw new NotFoundError("Sayfa bulunamadı.");
      return reply.send(ok(await toPageDtoLocalized(app, page)));
    }
  );

  server.patch(
    "/:pageId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageIdParamSchema, body: UpdatePageRequestSchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      assertLegalDocumentAuthorized(request.body.isLegalDocument, request.user!.role);

      await snapshotBeforeUpdate(app, "PAGE", existing.id, toPageSnapshot(existing), request.user!.id);

      const { slug, translations, authorId: requestedAuthorId, scheduledAt, isLegalDocument, ...rest } = request.body;
      const resolvedAuthorId = await resolveAuthorId(app, requestedAuthorId, request.user!);

      // Stored-XSS koruması: gelen çeviriler merge'den ÖNCE sanitize edilir (mevcut kayıttaki
      // çeviriler zaten sanitize edilmiş halde DB'de duruyor — bkz. lib/html-sanitize.ts).
      const sanitizedTranslations = translations !== undefined ? sanitizePageTranslations(translations) : undefined;
      // §9 backend-agent madde 5 — locale bazında shallow merge; `null` = o dilin çevirisini sil.
      const mergedTranslations =
        sanitizedTranslations !== undefined ? mergeTranslations(existing.translations, sanitizedTranslations) : undefined;

      const finalSlug = slug !== undefined ? slugify(slug) : existing.slug;
      const { enabled: enabledLocales } = await getLocaleSet(app);

      const page = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.page.update({
          where: { id: request.params.pageId },
          data: {
            ...rest,
            blocks: rest.blocks !== undefined ? (sanitizePageBlocks(rest.blocks) as Prisma.InputJsonValue) : undefined,
            ...(slug !== undefined ? { slug: finalSlug } : {}),
            ...(isLegalDocument !== undefined ? { isLegalDocument } : {}),
            ...(mergedTranslations !== undefined ? { translations: mergedTranslations as Prisma.InputJsonValue } : {}),
            ...(rest.status === "PUBLISHED" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
            // Faz 4 (zamanlanmış yayın) — yalnızca bu istekte `status` GÖNDERİLMİŞSE dokunulur (aksi
            // halde ilgisiz bir alan güncellemesi mevcut bir zamanlamayı bozardı). `status ===
            // "SCHEDULED"` ise `UpdatePageRequestSchema`'nın `refine`'ı `scheduledAt`'in gelecekte
            // dolu olmasını garanti eder; `PUBLISHED`/`DRAFT`'a manuel geçişte ise eski zamanlama
            // artığı kalmasın diye `null`'a temizlenir.
            ...(rest.status !== undefined
              ? { scheduledAt: rest.status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt) : null }
              : {}),
            ...(resolvedAuthorId !== undefined ? { authorId: resolvedAuthorId } : {}),
          },
          include: WITH_AUTHOR,
        });

        // Slug ve/veya çeviriler değiştiyse ContentSlug satırları AYNI transaction'da senkronlanır
        // (kanonik slug değişmese dahi resync ZARARSIZ — bkz. lib/localization.ts::syncContentSlugs).
        if (slug !== undefined || mergedTranslations !== undefined) {
          await syncContentSlugs(tx, enabledLocales, "PAGE", updated.id, updated.slug, updated.translations);
        }

        return updated;
      });

      if (isLegalDocument !== undefined && isLegalDocument !== existing.isLegalDocument) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "content.legal_flag_change",
          targetType: "Page",
          targetId: page.id,
          metadata: { from: existing.isLegalDocument, to: isLegalDocument },
          ipAddress: request.ip,
        });
      }

      // §10.13.8 — `PAGE_PUBLISHED` YALNIZCA duruma GEÇİŞTE (`!existing.publishedAt` →
      // `page.publishedAt` dolu) tetiklenir; transaction COMMIT'inden SONRA, `emitWebhookEvent`
      // TEK giriş noktasıdır (route doğrudan `WebhookDelivery` OLUŞTURMAZ).
      if (!existing.publishedAt && page.publishedAt) {
        await emitWebhookEvent(app, "PAGE_PUBLISHED", toPublicPageDto(page));
      }

      return reply.send(ok(await toPageDtoLocalized(app, page)));
    }
  );

  // Faz 3 (autosave) — 3sn debounce ile frontend'den çağrılır. Bilinçli olarak `PATCH`'ten
  // AYRIDIR: `snapshotBeforeUpdate` (revizyon) ve `logAudit` ÇAĞIRMAZ — aksi halde her
  // otomatik kayıt entity başına 50'lik revizyon tavanını (MAX_REVISIONS_PER_ENTITY) doldurup
  // kullanıcının bilinçli "Kaydet" ile ürettiği anlamlı geçmişi silerdi (bkz. lib/content-revisions.ts).
  server.post(
    "/:pageId/autosave",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PageIdParamSchema,
        body: AutosavePageRequestSchema,
        response: { 200: ApiSuccessSchema(AutosaveResponseSchema) },
      },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const { title, blocks } = request.body;

      await app.prisma.page.update({
        where: { id: request.params.pageId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(blocks !== undefined ? { blocks: sanitizePageBlocks(blocks) as Prisma.InputJsonValue } : {}),
        },
      });

      return reply.send(ok({ savedAt: new Date().toISOString() }));
    }
  );

  // §10.7 İçerik Yönetim Listesi — ÇÖPE TAŞI (soft-delete), KALICI SİLMEZ. İdempotenttir.
  server.delete(
    "/:pageId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (!existing.deletedAt) {
        await app.prisma.$transaction(async (tx) => {
          await tx.page.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
          await tx.siteSettings.updateMany({ where: { id: SETTINGS_ID, homePageId: existing.id }, data: { homePageId: null } });
        });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "page.trash",
          targetType: "Page",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      return reply.code(204).send();
    }
  );

  // §10.7 — çöpten geri yükle. `status` DEĞİŞMEZ. İdempotenttir (çöpte değilse de 200 + mevcut kayıt).
  server.post(
    "/:pageId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (existing.deletedAt) {
        await app.prisma.page.update({ where: { id: existing.id }, data: { deletedAt: null } });

        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "page.restore",
          targetType: "Page",
          targetId: existing.id,
          ipAddress: request.ip,
        });
      }

      const page = await app.prisma.page.findUnique({ where: { id: existing.id }, include: WITH_AUTHOR });
      return reply.send(ok(await toPageDtoLocalized(app, page!)));
    }
  );

  // §10.7 — KALICI sil (yalnızca ADMIN). Kayıt ÖNCE çöpte olmalı, değilse 409.
  server.delete(
    "/:pageId/permanent",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: PageIdParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");
      if (!existing.deletedAt) throw new ConflictError("Kalıcı silmeden önce içeriği çöpe taşıyın.");

      await app.prisma.$transaction(async (tx) => {
        await tx.contentRevision.deleteMany({ where: { entityType: "PAGE", entityId: existing.id } });
        // §9 backend-agent madde 7 — `ContentSlug`'ın içerik tablolarına FK'si YOKTUR (polimorfik),
        // kalıcı silmede AYNI transaction'da elle temizlenir (bkz. lib/localization.ts).
        await deleteContentSlugsForEntity(tx, "PAGE", existing.id);
        await tx.page.delete({ where: { id: existing.id } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "page.permanent_delete",
        targetType: "Page",
        targetId: existing.id,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );

  // §10.7 — toplu işlem. Kısmi başarı hata DEĞİLDİR (200 + skippedIds).
  server.post(
    "/bulk",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { body: BulkContentActionRequestSchema, response: { 200: ApiSuccessSchema(BulkContentActionResultSchema) } },
    },
    async (request, reply) => {
      // §10.13.8 — `PAGE_PUBLISHED` YALNIZCA duruma GEÇİŞTE tetiklenir. `runBulkContentAction`
      // (Page/BlogPost/Product/PortfolioItem arasında PAYLAŞILAN ortak yardımcı) transitionı BİLMEZ
      // (yalnızca satır sayısı döner) — bu yüzden "geçiş adayları" (henüz yayınlanmamış, çöpte
      // olmayan id'ler) ÇAĞRIDAN ÖNCE belirlenir, commit SONRASI gerçekten yayınlananlar arasından
      // filtrelenir (`skippedIds` çıkarılır) ve emisyon transaction dışında yapılır (§10.13.8 kuralı).
      const publishCandidateIds =
        request.body.action === "publish"
          ? (
              await app.prisma.page.findMany({
                where: { id: { in: request.body.ids }, deletedAt: null, publishedAt: null },
                select: { id: true },
              })
            ).map((row) => row.id)
          : [];

      const result = await runBulkContentAction(
        app,
        {
          getDelegate: (client) => client.page as unknown as BulkContentDelegate,
          entityType: "PAGE",
          targetType: "Page",
          auditActionPrefix: "page.",
          // Çöpe taşınan sayfa `SiteSettings.homePageId` ise aynı transaction'da temizlenir
          // (bkz. ARCHITECTURE.md §10.7) — yalnızca `Page`'e özgü bir yan etki.
          onTrash: async (tx, applicableIds) => {
            await tx.siteSettings.updateMany({
              where: { id: SETTINGS_ID, homePageId: { in: applicableIds } },
              data: { homePageId: null },
            });
          },
        },
        {
          ids: request.body.ids,
          action: request.body.action,
          actor: { id: request.user!.id, email: request.user!.email, role: request.user!.role },
          ip: request.ip,
        }
      );

      if (publishCandidateIds.length > 0) {
        const transitionedIds = publishCandidateIds.filter((id) => !result.skippedIds.includes(id));
        if (transitionedIds.length > 0) {
          const publishedRows = await app.prisma.page.findMany({ where: { id: { in: transitionedIds } } });
          for (const row of publishedRows) {
            await emitWebhookEvent(app, "PAGE_PUBLISHED", toPublicPageDto(row));
          }
        }
      }

      return reply.send(ok(result));
    }
  );

  // §10.1 İçerik Sürüm Kontrolü — yetki eşiği sayfa düzenleme ile aynı (ADMIN+EDITOR).
  server.get(
    "/:pageId/revisions",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: {
        params: PageIdParamSchema,
        querystring: CursorQuerySchema,
        response: { 200: ApiSuccessSchema(z.array(ContentRevisionSummarySchema)) },
      },
    },
    async (request, reply) => {
      const { rows, nextCursor } = await listContentRevisions(app, "PAGE", request.params.pageId, request.query);
      return reply.send(ok(rows.map(toContentRevisionSummaryDto), { nextCursor }));
    }
  );

  server.get(
    "/:pageId/revisions/:revisionId",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageRevisionIdParamSchema, response: { 200: ApiSuccessSchema(ContentRevisionSchema) } },
    },
    async (request, reply) => {
      const revision = await getContentRevisionOrThrow(app, "PAGE", request.params.pageId, request.params.revisionId);
      return reply.send(ok(toContentRevisionDto(revision)));
    }
  );

  server.post(
    "/:pageId/revisions/:revisionId/restore",
    {
      preHandler: requireSiteRole("ADMIN", "EDITOR"),
      schema: { params: PageRevisionIdParamSchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.page.findUnique({ where: { id: request.params.pageId } });
      if (!existing) throw new NotFoundError("Sayfa bulunamadı.");

      if (existing.deletedAt) {
        throw new ConflictError("Çöpteki içerik düzenlenemez. Önce geri yükleyin.");
      }

      const revision = await getContentRevisionOrThrow(app, "PAGE", request.params.pageId, request.params.revisionId);

      // Geri dönüş de geri alınabilir olsun diye önce mevcut state'i yeni bir revizyon olarak kaydet.
      await snapshotBeforeUpdate(app, "PAGE", existing.id, toPageSnapshot(existing), request.user!.id);

      const snapshot = revision.snapshot as {
        title: string;
        slug: string;
        blocks: unknown;
        seoTitle: string | null;
        seoDescription: string | null;
        ogTitle: string | null;
        ogImageUrl: string | null;
        canonicalUrl: string | null;
        noIndex: boolean;
        isLegalDocument?: boolean;
        translations: unknown;
      };

      const { enabled: enabledLocales } = await getLocaleSet(app);
      const sanitizedTranslations = snapshot.translations
        ? sanitizePageTranslations(snapshot.translations as Record<string, Record<string, unknown> | null>)
        : {};

      // §5.1/security-agent bulgusu (bkz. .claude/security-review-i18n.md) — bu route
      // `requireSiteRole("ADMIN", "EDITOR")` ile korunuyor, ama `isLegalDocument` alanı
      // YALNIZCA ADMIN değiştirebilir (bkz. `assertLegalDocumentAuthorized`, PATCH ile AYNI
      // kural). Eski revizyonun snapshot'ı bu bayrağı taşıyorsa VE mevcut değerden FARKLIYSA,
      // bunu bir EDITOR'ün "geri yükleme" aracılığıyla ADMIN onayı/audit'i OLMADAN
      // değiştirmesine izin VERİLMEZ. Seçilen davranış (kısmi uygulama — restore'un TAMAMI
      // reddedilmez): EDITOR ise bu TEK ALAN atlanır ve mevcut değer KORUNUR (tıpkı "snapshot'ta
      // hiç yoksa korunur" dalıyla AYNI kod yolu) — geri kalan tüm alanlar normal şekilde geri
      // yüklenir. ADMIN ise (PATCH ile birebir aynı) değişiklik uygulanır ve
      // `content.legal_flag_change` denetlenir. EDITOR'ün reddedilen denemesi de (isteği
      // BLOKE ETMEDEN) `FORBIDDEN` durumuyla denetlenir — sessiz bir "hayır" değil, görünür bir
      // iz bırakır (KVKK/GDPR uyumluluk denetimi için).
      const snapshotLegalDocument = snapshot.isLegalDocument;
      const legalDocumentWouldChange = snapshotLegalDocument !== undefined && snapshotLegalDocument !== existing.isLegalDocument;
      const actorIsAdmin = request.user!.role === "ADMIN";
      const applyLegalDocumentChange = legalDocumentWouldChange && actorIsAdmin;
      const rejectedLegalDocumentChange = legalDocumentWouldChange && !actorIsAdmin;

      const page = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.page.update({
          where: { id: request.params.pageId },
          data: {
            title: snapshot.title,
            slug: snapshot.slug,
            // Savunmada derinlik: bu sanitizasyon eklenmeden ÖNCE kaydedilmiş eski revizyonlar
            // temizlenmemiş HTML içerebilir — geri yükleme her zaman yeniden sanitize eder.
            blocks: (Array.isArray(snapshot.blocks)
              ? sanitizePageBlocks(snapshot.blocks)
              : snapshot.blocks) as Prisma.InputJsonValue,
            seoTitle: snapshot.seoTitle,
            seoDescription: snapshot.seoDescription,
            ogTitle: snapshot.ogTitle,
            ogImageUrl: snapshot.ogImageUrl,
            canonicalUrl: snapshot.canonicalUrl,
            noIndex: snapshot.noIndex,
            // Eski revizyonlarda (bu alan eklenmeden ÖNCE alınmış) `isLegalDocument` YOKTUR —
            // bu durumda mevcut değer KORUNUR. AYNI şekilde EDITOR'ün yetkisiz bir değişikliği
            // de (yukarıda hesaplanan `rejectedLegalDocumentChange`) uygulanmaz — mevcut değer
            // KORUNUR (sessizce ATLANIR, restore'un geri kalanı bloklanmaz).
            ...(snapshotLegalDocument !== undefined && !rejectedLegalDocumentChange
              ? { isLegalDocument: snapshotLegalDocument }
              : {}),
            translations: sanitizedTranslations as Prisma.InputJsonValue,
          },
          include: WITH_AUTHOR,
        });

        await syncContentSlugs(tx, enabledLocales, "PAGE", updated.id, updated.slug, updated.translations);

        return updated;
      });

      if (applyLegalDocumentChange) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "content.legal_flag_change",
          targetType: "Page",
          targetId: page.id,
          metadata: {
            from: existing.isLegalDocument,
            to: snapshotLegalDocument,
            viaRevisionRestore: true,
            revisionId: request.params.revisionId,
          },
          ipAddress: request.ip,
        });
      } else if (rejectedLegalDocumentChange) {
        // İstek reddedilmedi (restore'un geri kalanı uygulandı) ama bu ALAN uygulanmadı —
        // bu denemenin görünür bir izi olsun diye `FORBIDDEN` statüsüyle ayrıca denetlenir
        // (bkz. requireSiteRole'ün route-seviyesi 403'leri logladığı AYNI desen).
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: "content.legal_flag_change",
          status: "FORBIDDEN",
          targetType: "Page",
          targetId: page.id,
          metadata: {
            attemptedFrom: existing.isLegalDocument,
            attemptedTo: snapshotLegalDocument,
            viaRevisionRestore: true,
            revisionId: request.params.revisionId,
            reason: "isLegalDocument alanını yalnızca ADMIN değiştirebilir; alan atlanarak geri kalan revizyon geri yüklendi.",
          },
          ipAddress: request.ip,
        });
      }

      return reply.send(ok(await toPageDtoLocalized(app, page)));
    }
  );
}

/** `/pages` prefix'i altında bağlanır — herkese açık, yalnızca yayınlanmış VE çöpte olmayan sayfalar. */
export async function publicPagesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    "/",
    { schema: { querystring: LocaleQuerySchema, response: { 200: ApiSuccessSchema(z.array(PageSchema)) } } },
    async (request, reply) => {
      const rows = await app.prisma.page.findMany({
        where: { status: "PUBLISHED", deletedAt: null },
        orderBy: { seq: "asc" },
        take: 100,
        include: WITH_AUTHOR,
      });

      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);
      const localizationsByEntity = await attachLocalizations(app, "PAGE", rows);

      const dtos = rows.map((row) => {
        const localizations = localizationsByEntity.get(row.id) ?? [];
        const translated = effectiveLocale ? localizations.find((l) => l.locale === effectiveLocale)?.translated ?? false : false;
        return toPageDto(applyPageLocale(row, effectiveLocale, translated), localizations);
      });

      return reply.send(ok(dtos));
    }
  );

  server.get(
    "/:slug",
    {
      schema: { params: PageSlugParamSchema, querystring: LocaleQuerySchema, response: { 200: ApiSuccessSchema(PageSchema) } },
    },
    async (request, reply) => {
      const localeSet = await getLocaleSet(app);
      const effectiveLocale = resolveEffectiveLocaleCode(localeSet, request.query.locale);

      // §4/§12.2 — slug çözümleme: (1) ContentSlug(locale, slug) tam eşleşme, (2) varsayılan
      // dildeki kanonik `slug` kolonu. İkisi de tutmazsa 404.
      const translatedEntityId = await resolveEntityIdBySlug(app, "PAGE", request.params.slug, effectiveLocale);
      const page = translatedEntityId
        ? await app.prisma.page.findFirst({
            where: { id: translatedEntityId, status: "PUBLISHED", deletedAt: null },
            include: WITH_AUTHOR,
          })
        : null;
      const resolvedPage =
        page ??
        (await app.prisma.page.findFirst({
          where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
          include: WITH_AUTHOR,
        }));
      if (!resolvedPage) throw new NotFoundError("Sayfa bulunamadı.");

      const localizations = await attachLocalizationsOne(app, "PAGE", resolvedPage);
      const translated = effectiveLocale ? localizations.find((l) => l.locale === effectiveLocale)?.translated ?? false : false;

      return reply.send(ok(toPageDto(applyPageLocale(resolvedPage, effectiveLocale, translated), localizations)));
    }
  );

  server.post(
    "/:slug/view",
    { schema: { params: PageSlugParamSchema, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const page = await app.prisma.page.findFirst({
        where: { slug: request.params.slug, status: "PUBLISHED", deletedAt: null },
        select: { id: true },
      });
      if (!page) throw new NotFoundError("Sayfa bulunamadı.");

      const deviceType = detectDeviceType(request.headers["user-agent"]);
      const country = detectCountry(request.ip);
      touchVisitor(request.ip, request.headers["user-agent"]);

      const date = startOfUtcDay();
      await app.prisma.$transaction([
        app.prisma.pageView.upsert({
          where: { pageId_date_deviceType_country: { pageId: page.id, date, deviceType, country } },
          create: { pageId: page.id, date, deviceType, country, count: 1 },
          update: { count: { increment: 1 } },
        }),
        app.prisma.page.update({ where: { id: page.id }, data: { viewCount: { increment: 1 } } }),
      ]);

      return reply.code(204).send();
    }
  );
}
