-- §1.4 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — NULL uyarısı:
-- Aşağıdaki "cart_items_cartId_productId_variantId_key" kısıtı PostgreSQL'de üçlü bir
-- UNIQUE kısıttır. Postgres'te NULL değerler unique kısıtta birbirine EŞİT SAYILMAZ,
-- yani varyasyonsuz bir ürün için (cartId, productId, NULL) satırı bu kısıt tarafından
-- TEK BAŞINA artık iki kez yazılmaktan korunmaz. Bu bilinçli, dokümante edilmiş bir
-- zayıflatmadır: kaybedilen koruma uygulama katmanında telafi edilir — `POST /cart/items`
-- arama anahtarı `(productId, variantId ?? null)` olur (bkz. cart.routes.ts, find-then-
-- update akışı; qa-agent bu davranışı regresyon testi olarak doğrular, §9 QA-3). Kısmi
-- (partial) unique index (`... WHERE "variantId" IS NULL`) BİLİNÇLİ olarak EKLENMEZ —
-- depodaki migration'ların hiçbirinde elle yazılmış SQL yoktur; Prisma şemasında
-- karşılığı olmayan bir indeks sonraki `prisma migrate dev` çalıştırmalarında sürüklenme
-- (drift) uyarısı üretir. Tek bir demo şablonu için migration disiplinini bozmak
-- orantısızdır.

-- DropIndex
DROP INDEX "cart_items_cartId_productId_key";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantLabel" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shippingCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "variantOptions" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "freeShippingThresholdCents" INTEGER,
ADD COLUMN     "shippingFlatFeeCents" INTEGER;

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "productId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "optionValues" JSONB NOT NULL,
    "sku" TEXT,
    "priceCents" INTEGER,
    "discountPriceCents" INTEGER,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "mediaId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_documents" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_seq_key" ON "product_variants"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE INDEX "product_variants_mediaId_idx" ON "product_variants"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_variantKey_key" ON "product_variants"("productId", "variantKey");

-- CreateIndex
CREATE INDEX "product_documents_mediaId_idx" ON "product_documents"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "product_documents_productId_mediaId_key" ON "product_documents"("productId", "mediaId");

-- CreateIndex
CREATE INDEX "cart_items_variantId_idx" ON "cart_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_variantId_key" ON "cart_items"("cartId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
