import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { TaxRateSchema } from "../../schemas/entities";
import { toTaxRateDto } from "../../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { CreateTaxRateRequestSchema, DeleteTaxRateQuerySchema, TaxRateIdParamSchema, UpdateTaxRateRequestSchema } from "./tax.schemas";

/**
 * Merkezi KDV oranı mimarisi (bkz. lib/tax.ts, prisma/schema.prisma::TaxRate) — `/admin/tax-rates`
 * prefix'i altında bağlanır (bkz. app.ts). `.claude/architect-scope-rbac-5-tier.md` §5.3 tablosuyla
 * AYNI seviye: `GET`: ADMIN+MANAGER (panel kapısı yeterli, `settings.routes.ts::adminSettingsRoutes`
 * ile AYNI eşik); `POST`/`PATCH`/`DELETE`: yalnızca ADMIN (fiyatlandırma/vergi mevzuatını
 * etkileyen, istisnai/geri alınamaz — `orders.routes.ts::ADMIN_ONLY_TARGETS` İLE AYNI karar sınıfı).
 */
export async function adminTaxRatesRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(z.array(TaxRateSchema)) } } }, async (_request, reply) => {
    const rows = await app.prisma.taxRate.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    return reply.send(ok(rows.map(toTaxRateDto)));
  });

  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { body: CreateTaxRateRequestSchema, response: { 201: ApiSuccessSchema(TaxRateSchema) } },
    },
    async (request, reply) => {
      const { name, ratePercent, description, isDefault, sortOrder } = request.body;

      const existingByName = await app.prisma.taxRate.findUnique({ where: { name } });
      if (existingByName) throw new ConflictError(`"${name}" adında bir KDV oranı zaten kayıtlı.`);

      // Partial unique index (`tax_rates_single_default`, bkz. db-agent migration notu) — en
      // fazla BİR `isDefault: true` satır olabilir. `localization.routes.ts::PATCH /:code`
      // İLE AYNI "önce eskisini devre dışı bırak, sonra yenisini kaldır" deseni.
      const rate = await app.prisma.$transaction(async (tx) => {
        if (isDefault) {
          await tx.taxRate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }
        return tx.taxRate.create({
          data: {
            name,
            ratePercent,
            description: description ?? null,
            isDefault: isDefault ?? false,
            sortOrder: sortOrder ?? 0,
          },
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "tax_rate.create",
        targetType: "TaxRate",
        targetId: rate.id,
        metadata: { name: rate.name, ratePercent: Number(rate.ratePercent), isDefault: rate.isDefault },
        ipAddress: request.ip,
      });

      return reply.code(201).send(ok(toTaxRateDto(rate)));
    }
  );

  server.patch(
    "/:taxRateId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: TaxRateIdParamSchema, body: UpdateTaxRateRequestSchema, response: { 200: ApiSuccessSchema(TaxRateSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.taxRate.findUnique({ where: { id: request.params.taxRateId } });
      if (!existing) throw new NotFoundError("KDV oranı bulunamadı.");

      const { name, ratePercent, description, isDefault, sortOrder } = request.body;

      if (name !== undefined && name !== existing.name) {
        const clash = await app.prisma.taxRate.findUnique({ where: { name } });
        if (clash) throw new ConflictError(`"${name}" adında bir KDV oranı zaten kayıtlı.`);
      }

      // Varsayılanı doğrudan `false`'a çekmek YASAK (`localization.routes.ts::PATCH /:code` İLE
      // AYNI karar) — sistemde en az bir varsayılan oran KALMALI değildir (KDV hiç tanımlanmamış
      // olabilir, bkz. SiteSettings.defaultTaxRateId notu), ama BİLİNÇLİ bir "varsayılanı kaldır"
      // yerine "başka bir oranı varsayılan yap" akışı tercih edilir (öngörülebilirlik).
      if (isDefault === false && existing.isDefault) {
        throw new ValidationError("Varsayılan KDV oranı doğrudan kaldırılamaz; önce başka bir oranı varsayılan yapın.", {
          isDefault: ["Sistemde en fazla bir varsayılan KDV oranı olabilir; kaldırmak için başka bir oranı varsayılan yapın."],
        });
      }

      const becomingDefault = isDefault === true && !existing.isDefault;

      const updated = await app.prisma.$transaction(async (tx) => {
        if (becomingDefault) {
          await tx.taxRate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }
        return tx.taxRate.update({
          where: { id: existing.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(ratePercent !== undefined ? { ratePercent } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            ...(becomingDefault ? { isDefault: true } : {}),
          },
        });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "tax_rate.update",
        targetType: "TaxRate",
        targetId: existing.id,
        metadata: { changes: request.body, becameDefault: becomingDefault },
        ipAddress: request.ip,
      });

      return reply.send(ok(toTaxRateDto(updated)));
    }
  );

  server.delete(
    "/:taxRateId",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: TaxRateIdParamSchema, querystring: DeleteTaxRateQuerySchema, response: { 204: z.undefined() } },
    },
    async (request, reply) => {
      const existing = await app.prisma.taxRate.findUnique({ where: { id: request.params.taxRateId } });
      if (!existing) throw new NotFoundError("KDV oranı bulunamadı.");

      if (existing.isDefault) {
        throw new ConflictError("Varsayılan KDV oranı silinemez. Önce başka bir oranı varsayılan yapın.", {
          reason: ["TAX_RATE_IS_DEFAULT"],
        });
      }

      const { reassignToId } = request.query;
      const productCount = await app.prisma.product.count({ where: { taxRateId: existing.id } });

      if (productCount > 0 && !reassignToId) {
        throw new ConflictError(`Bu KDV oranını kullanan ${productCount} ürün var. Silmeden önce ürünleri başka bir orana taşıyın.`, {
          reason: ["TAX_RATE_IN_USE"],
        });
      }

      if (productCount > 0 && reassignToId) {
        if (reassignToId === existing.id) {
          throw new ValidationError("Ürünler silinecek oranın KENDİSİNE taşınamaz.", {
            reassignToId: ["reassignToId, silinecek oranla AYNI olamaz."],
          });
        }
        const target = await app.prisma.taxRate.findUnique({ where: { id: reassignToId } });
        if (!target) {
          throw new ValidationError("Belirtilen hedef KDV oranı bulunamadı.", {
            reassignToId: ["Belirtilen hedef KDV oranı bulunamadı."],
          });
        }
      }

      await app.prisma.$transaction(async (tx) => {
        if (productCount > 0 && reassignToId) {
          await tx.product.updateMany({ where: { taxRateId: existing.id }, data: { taxRateId: reassignToId } });
        }
        await tx.taxRate.delete({ where: { id: existing.id } });
      });

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: "tax_rate.delete",
        targetType: "TaxRate",
        targetId: existing.id,
        metadata: { name: existing.name, reassignedProductCount: productCount, reassignToId: reassignToId ?? null },
        ipAddress: request.ip,
      });

      return reply.code(204).send();
    }
  );
}
