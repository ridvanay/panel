import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { LocaleSchema } from "../../schemas/entities";
import { toLocaleDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { LOCALE_CODE_PATTERN, listAllLocales, normalizeLocaleCode } from "../../lib/localization";
import { LocaleCodeParamSchema, LocaleUpdateRequestSchema, LocaleUpsertRequestSchema } from "./localization.schemas";

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `/admin/locales` prefix'i altında bağlanır (authenticated).
 * GET herhangi bir SiteRole (çeviri editörü sekmelerini kurmak için EDITOR de okur), yazma
 * uçları yalnızca ADMIN (bkz. openapi.yaml `Localization` tag'i).
 */
export async function adminLocalesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(z.array(LocaleSchema)) } } }, async (_request, reply) => {
    const [locales, counts] = await Promise.all([
      listAllLocales(app),
      // `translatedContentCount` — bu dilde EN AZ BİR alanı çevrilmiş içerik sayısı (§1.4:
      // ContentSlug satır sayısı). Varsayılan dil de bu sayıma dahildir (her içerik için bir
      // satırı vardır, §2.4) — silme onayı zaten varsayılan dil için asla tetiklenmez.
      app.prisma.contentSlug.groupBy({ by: ["locale"], _count: { _all: true } }),
    ]);

    const countByLocale = new Map(counts.map((row) => [row.locale, row._count._all]));
    return reply.send(ok(locales.map((locale) => toLocaleDto(locale, countByLocale.get(locale.code) ?? 0))));
  });

  server.post(
    "/",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { body: LocaleUpsertRequestSchema, response: { 201: ApiSuccessSchema(LocaleSchema) } },
    },
    async (request, reply) => {
      const code = normalizeLocaleCode(request.body.code);
      if (!LOCALE_CODE_PATTERN.test(code)) {
        throw new ValidationError("Geçersiz dil kodu.", { code: ["BCP-47 biçiminde küçük harf bir kod olmalıdır (örn. \"en\", \"en-gb\")."] });
      }

      const existing = await app.prisma.locale.findUnique({ where: { code } });
      if (existing) throw new ConflictError(`"${code}" dili zaten kayıtlı.`);

      // Şema değişikliği/migration GEREKMEZ — yalnızca bir satır eklenir (§2.1 kabul kriteri).
      // `isDefault` HER ZAMAN false — yalnızca PATCH ile (tek transaction'lı devir) değişir.
      const locale = await app.prisma.locale.create({
        data: {
          code,
          label: request.body.label,
          nativeLabel: request.body.nativeLabel,
          enabled: request.body.enabled ?? false,
          sortOrder: request.body.sortOrder ?? 0,
          hreflang: request.body.hreflang ?? null,
          isDefault: false,
        },
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "localization.locale_create",
        targetType: "Locale",
        targetId: locale.code,
        metadata: { code: locale.code, enabled: locale.enabled },
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok(toLocaleDto(locale, 0)));
    }
  );

  // SÖZLEŞME NOTU (mimariye eskale edilmeli, kod DEĞİL): openapi.yaml'ın bu ucun düzyazı
  // açıklaması "yanıt `warnings` içinde etkilenen URL sayısını döndürür" diyor, ama `Locale`
  // response şemasında böyle bir alan TANIMLI DEĞİL. Şema (bağlayıcı sözleşme) ile düzyazı
  // (niyet) çelişiyor — bu backend-agent'ın tek taraflı çözebileceği bir belirsizlik değil.
  // Bu implementasyon şemaya (Locale) sadık kalır: `warnings` alanı EKLEMEZ. `isDefault`
  // devri yine de doğru çalışır (bkz. aşağıdaki transaction); yalnızca istemciye ayrı bir
  // "kaç URL etkilenecek" sayısı dönmez — admin UI bu uyarıyı ŞİMDİLİK kendi tarafında
  // (ör. "varsayılan dili değiştirmek TÜM prefix'siz URL'leri değiştirir" sabit metniyle)
  // göstermelidir.
  server.patch(
    "/:code",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: LocaleCodeParamSchema, body: LocaleUpdateRequestSchema, response: { 200: ApiSuccessSchema(LocaleSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.locale.findUnique({ where: { code: request.params.code } });
      if (!existing) throw new NotFoundError("Dil bulunamadı.");

      const body = request.body;

      // "Tam olarak BİR varsayılan dil" — mevcut varsayılanı doğrudan false'a çekmek YASAK;
      // önce başka bir dil `isDefault: true` ile devralmalıdır (bkz. openapi.yaml PATCH açıklaması).
      if (body.isDefault === false && existing.isDefault) {
        throw new ValidationError("Varsayılan dil doğrudan kaldırılamaz; önce başka bir dili varsayılan yapın.", {
          isDefault: ["Sistemde her zaman tam olarak bir varsayılan dil olmalıdır."],
        });
      }

      const finalEnabled = body.enabled !== undefined ? body.enabled : existing.enabled;
      const finalIsDefault = body.isDefault !== undefined ? body.isDefault : existing.isDefault;
      // Varsayılan dil `enabled: false` YAPILAMAZ (422, bkz. openapi.yaml PATCH açıklaması).
      if (finalIsDefault && !finalEnabled) {
        throw new ValidationError("Varsayılan dil devre dışı bırakılamaz.", {
          enabled: ["isDefault: true iken enabled: false gönderilemez."],
        });
      }

      const becomingDefault = body.isDefault === true && !existing.isDefault;

      const updated = await app.prisma.$transaction(async (tx) => {
        // `isDefault: true` devri TEK transaction'da yürür: eski varsayılanın bayrağı düşürülür,
        // yenisi kaldırılır (bkz. .claude/architect-scope-i18n.md §9 backend-agent madde 3).
        if (becomingDefault) {
          await tx.locale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }

        return tx.locale.update({
          where: { code: existing.code },
          data: {
            ...(body.label !== undefined ? { label: body.label } : {}),
            ...(body.nativeLabel !== undefined ? { nativeLabel: body.nativeLabel } : {}),
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            ...(body.hreflang !== undefined ? { hreflang: body.hreflang } : {}),
            ...(becomingDefault ? { isDefault: true } : {}),
          },
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "localization.locale_update",
        targetType: "Locale",
        targetId: existing.code,
        // Varsayılan dil değişimi TÜM prefix'siz servis edilen URL'leri değiştirir (bkz.
        // openapi.yaml PATCH açıklaması) — bu, denetim kaydında ayırt edilebilir olmalıdır.
        metadata: { changes: body, becameDefault: becomingDefault },
        ipAddress: request.ip,
      });

      const translatedContentCount = await app.prisma.contentSlug.count({ where: { locale: updated.code } });
      return reply.send(ok(toLocaleDto(updated, translatedContentCount)));
    }
  );

  server.delete(
    "/:code",
    {
      preHandler: requireSiteRole("ADMIN"),
      schema: { params: LocaleCodeParamSchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.locale.findUnique({ where: { code: request.params.code } });
      if (!existing) throw new NotFoundError("Dil bulunamadı.");

      // Varsayılan dil SİLİNEMEZ (422, bkz. openapi.yaml DELETE açıklaması).
      if (existing.isDefault) {
        throw new ValidationError("Varsayılan dil silinemez.", { code: ["Önce başka bir dili varsayılan yapın."] });
      }

      // Silme, bu dile ait TÜM ContentSlug satırlarını (Locale→ContentSlug `onDelete: Cascade`
      // ile OTOMATİK) ve içeriklerdeki `translations.<code>` JSON anahtarlarını (BURADA elle,
      // 4 tabloda) KALICI olarak kaldırır — çöp kutusu YOK, geri alınamaz (bkz. openapi.yaml
      // DELETE açıklaması). `?` ve `-` jsonb operatörleri Prisma DSL'inde YOKTUR, bu yüzden
      // `$executeRaw` kullanılır (parametreler Prisma tarafından otomatik bind edilir — SQL
      // enjeksiyonuna KAPALI).
      // `::text` cast'leri ZORUNLU — cast olmadan Postgres, jsonb `-`/`?` operatörlerinin
      // birden fazla overload'ı (text/integer/text[]) arasında parametrenin tipini
      // belirleyemeyip "could not determine data type of parameter" hatası verir.
      await app.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "pages" SET "translations" = "translations" - ${existing.code}::text WHERE "translations" ? ${existing.code}::text`;
        await tx.$executeRaw`UPDATE "blog_posts" SET "translations" = "translations" - ${existing.code}::text WHERE "translations" ? ${existing.code}::text`;
        await tx.$executeRaw`UPDATE "products" SET "translations" = "translations" - ${existing.code}::text WHERE "translations" ? ${existing.code}::text`;
        await tx.$executeRaw`UPDATE "portfolio_items" SET "translations" = "translations" - ${existing.code}::text WHERE "translations" ? ${existing.code}::text`;
        await tx.locale.delete({ where: { code: existing.code } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "localization.locale_delete",
        targetType: "Locale",
        targetId: existing.code,
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );
}

/**
 * `/locales` prefix'i altında bağlanır — public. Site dil değiştirici ve `[lang]` rota
 * doğrulaması bu ucu okur. Yalnızca `enabled: true` diller, `sortOrder` artan sırada.
 */
export async function publicLocalesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(z.array(LocaleSchema)) } } }, async (_request, reply) => {
    const locales = await app.prisma.locale.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok(locales.map((locale) => toLocaleDto(locale))));
  });
}
