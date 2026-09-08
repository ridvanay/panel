import { z } from "zod";

export const TaxRateIdParamSchema = z.object({
  taxRateId: z.string().uuid(),
});

/**
 * `POST /admin/tax-rates` — `name` benzersizdir (`TaxRate.name @unique`, bkz. prisma/schema.prisma).
 * `ratePercent` `Decimal(5,2)` koluna yazılır — 0..100 aralığı (v1 kapsamı, negatif/aşırı yüzek
 * KDV oranı desteklenmez). `isDefault: true` gönderilirse mevcut varsayılan transaction içinde
 * ÖNCE `false`'a çekilir, SONRA bu satır `true` yapılır (bkz. tax.routes.ts — partial unique index
 * çakışmasını önlemek için, db-agent migration notu).
 */
export const CreateTaxRateRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ratePercent: z.number().min(0).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const UpdateTaxRateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    ratePercent: z.number().min(0).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.ratePercent !== undefined || data.description !== undefined || data.isDefault !== undefined || data.sortOrder !== undefined,
    { message: "En az bir alan gönderilmelidir." }
  );

/**
 * `DELETE /admin/tax-rates/{taxRateId}?reassignToId=` — bu orana bağlı ürün varsa VE
 * `reassignToId` verilmemişse 409 CONFLICT (`details.reason: ["TAX_RATE_IN_USE"]`, bkz.
 * tax.routes.ts). `reassignToId`, silinen oranın KENDİSİ OLAMAZ — route handler'da kontrol edilir.
 */
export const DeleteTaxRateQuerySchema = z.object({
  reassignToId: z.string().uuid().optional(),
});
