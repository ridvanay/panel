-- architect-scope-products-catalog.md §2 (bağlayıcı) — salt-ekleme migration, mevcut
-- veri/kolon SİLİNMEZ. `ProductVariant.variantKey` ve `Product.priceCents`/
-- `discountPriceCents` KANONİK kalır; bu migration'daki tüm yeni kolonlar TÜRETİLMİŞ/
-- denormalizedir (tek üretim noktası: backend `lib/product-pricing.ts::derivePriceColumns`
-- ve `modules/products/lib/variants.ts::deriveOptionValueSlugs`, bkz. §2.4).

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "optionValueSlugs" TEXT[];

-- Backfill (§2.2, bağlayıcı) — `variantKey`'in ("beden:l|renk:antrasit") DETERMİNİSTİK
-- dizi hâli, tam olarak `variantKey.split("|")` karşılığı. Bu, [EPT] §1.4'teki "elle SQL
-- yazma" yasağının kapsamı DIŞINDADIR (o yasak Prisma şemasında karşılığı olmayan
-- yapılar içindi, ör. kısmi indeks); geriye dönük veri doldurma bir sonraki
-- `prisma migrate dev` çalıştırmasında sürüklenme (drift) uyarısı ÜRETMEZ.
UPDATE "product_variants" SET "optionValueSlugs" = string_to_array("variantKey", '|');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "discountPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "effectivePriceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill (§2.3, bağlayıcı) — `effectivePriceCents`/`discountPercent`, mevcut
-- `priceCents`/`discountPriceCents`'ten deterministik türetilir (bkz.
-- `derivePriceColumns`, canlıda TEK üretim noktası).
UPDATE "products" SET "effectivePriceCents" = COALESCE("discountPriceCents", "priceCents"),
  "discountPercent" = CASE WHEN "discountPriceCents" IS NULL OR "priceCents" <= 0 THEN 0
    ELSE ROUND((1 - "discountPriceCents"::numeric / "priceCents") * 100) END;

-- Backfill (§2.3, bağlayıcı) — `salesCount`, PAID/SHIPPED/FULFILLED sipariş kalemlerinin
-- adet toplamıdır (REFUNDED/CANCELLED v1'de DÜŞÜLMEZ, bkz. openapi
-- `ProductListItem.salesCount`). Canlıda artırım `modules/webhooks/stripe.routes.ts`
-- içindeki mevcut `runSerializable` bloğundadır (§5.2, backend-agent sahası); bu
-- yalnızca geçmiş veri için tek seferlik doldurmadır.
UPDATE "products" p SET "salesCount" = COALESCE(s.total, 0) FROM (
  SELECT oi."productId" AS pid, SUM(oi.quantity) AS total FROM "order_items" oi
  JOIN "orders" o ON o.id = oi."orderId" WHERE o.status IN ('PAID','SHIPPED','FULFILLED')
  GROUP BY oi."productId") s WHERE p.id = s.pid;

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "shippingEstimatedDaysMax" INTEGER,
ADD COLUMN     "shippingEstimatedDaysMin" INTEGER;

-- CreateIndex
CREATE INDEX "product_categories_parentId_idx" ON "product_categories"("parentId");

-- CreateIndex
CREATE INDEX "product_variants_optionValueSlugs_idx" ON "product_variants" USING GIN ("optionValueSlugs" array_ops);

-- CreateIndex
CREATE INDEX "products_status_deletedAt_effectivePriceCents_idx" ON "products"("status", "deletedAt", "effectivePriceCents");

-- CreateIndex
CREATE INDEX "products_status_deletedAt_salesCount_idx" ON "products"("status", "deletedAt", "salesCount");

-- CreateIndex
CREATE INDEX "products_status_deletedAt_discountPercent_idx" ON "products"("status", "deletedAt", "discountPercent");

-- CreateIndex
CREATE INDEX "products_status_deletedAt_publishedAt_idx" ON "products"("status", "deletedAt", "publishedAt");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
