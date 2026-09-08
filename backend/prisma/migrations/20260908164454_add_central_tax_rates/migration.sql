-- Merkezi KDV oranı mimarisi (bkz. schema.prisma TaxRate modeli üstündeki not) —
-- ürün bazlı serbest `products.taxRatePercent` alanının yerini `tax_rates` tablosundan
-- SEÇİLEN, isimlendirilmiş oranlar alır. `taxRatePercent` kolonu ŞİMDİ DÜŞÜRÜLMEZ
-- (bkz. Product.taxRatePercent @deprecated notu) — ayrı bir migration'da
-- (chore/drop-product-tax-rate-percent) kaldırılacak.

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRatePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "taxRateId" TEXT;

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "defaultTaxRateId" TEXT,
ADD COLUMN     "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_name_key" ON "tax_rates"("name");

-- CreateIndex
-- Postgres kısmi (partial) unique index: yalnızca isDefault=true olan satırlar arasında
-- benzersizliği zorlar, böylece en fazla BİR TaxRate satırı "mağaza varsayılanı"
-- olabilir. Prisma şemasında ifade edilemeyen bir kısıttır, bu yüzden raw SQL.
CREATE UNIQUE INDEX "tax_rates_single_default" ON "tax_rates" ("isDefault") WHERE "isDefault";

-- CreateIndex
CREATE INDEX "products_taxRateId_idx" ON "products"("taxRateId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Baseline (varsayılan) KDV oranları — seed.ts idempotent upsert (name üzerinden)
-- ile AYNI 3 satırı üretir; burada da eklenmesinin nedeni prod ortamında `seed.ts`
-- ÇALIŞTIRILMAYABİLİR (yalnızca dev fixture'ı) ama backfill'in (aşağıda) eşleşecek
-- en az bir TaxRate satırına ihtiyacı vardır. "name" üzerinde ON CONFLICT DO NOTHING
-- ile idempotent: migration ileride yeniden çalıştırılmaz ama savunma amaçlı eklendi.
-- ----------------------------------------------------------------------------
INSERT INTO "tax_rates" ("id", "name", "ratePercent", "description", "isDefault", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'Standart KDV', 20.00, NULL, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'İndirimli KDV', 10.00, NULL, false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Muaf', 0.00, NULL, false, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- ----------------------------------------------------------------------------
-- Backfill: mevcut ürünlerin serbest `taxRatePercent` değerini, MUTLAK FARKI EN
-- KÜÇÜK olan `tax_rates.ratePercent`'e eşleyip `products.taxRateId`'yi doldurur.
-- Fark > 0.01 ise (baseline 3 orana yakın DEĞİLSE) ürüne özel "Özel %X" adında yeni
-- bir TaxRate satırı oluşturulup ürün ona bağlanır — aynı özel değere sahip sonraki
-- ürünler, bu yeni satır artık tabloda olduğundan doğrudan (fark=0) ona eşleşir.
-- `taxRatePercent` NULL olan ürünler NULL kalır (mağaza varsayılanına düşerler,
-- kod tarafı — SiteSettings.defaultTaxRateId — bunu çözer, DB'de fallback YOK).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_nearest_id TEXT;
  v_nearest_rate DECIMAL(5,2);
  v_diff DECIMAL(6,2);
  v_rate_text TEXT;
  v_custom_name TEXT;
  v_custom_id TEXT;
  v_next_sort_order INT;
BEGIN
  FOR r IN
    SELECT "id", "taxRatePercent" FROM "products"
    WHERE "taxRatePercent" IS NOT NULL
    ORDER BY "seq"
  LOOP
    SELECT "id", "ratePercent" INTO v_nearest_id, v_nearest_rate
    FROM "tax_rates"
    ORDER BY ABS("ratePercent" - r."taxRatePercent") ASC, "sortOrder" ASC
    LIMIT 1;

    v_diff := ABS(v_nearest_rate - r."taxRatePercent");

    IF v_diff <= 0.01 THEN
      UPDATE "products" SET "taxRateId" = v_nearest_id WHERE "id" = r."id";
    ELSE
      -- Sondaki gereksiz sıfırları/noktayı budayarak okunabilir bir etiket üret
      -- (ör. 7.50 -> "Özel %7.5", 15.00 -> "Özel %15", 8.05 -> "Özel %8.05").
      v_rate_text := TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM r."taxRatePercent"::TEXT));
      v_custom_name := 'Özel %' || v_rate_text;

      SELECT "id" INTO v_custom_id FROM "tax_rates" WHERE "name" = v_custom_name;
      IF v_custom_id IS NULL THEN
        v_custom_id := gen_random_uuid()::text;
        SELECT COALESCE(MAX("sortOrder"), 0) + 1 INTO v_next_sort_order FROM "tax_rates";
        INSERT INTO "tax_rates" ("id", "name", "ratePercent", "description", "isDefault", "sortOrder", "createdAt", "updatedAt")
        VALUES (
          v_custom_id,
          v_custom_name,
          r."taxRatePercent",
          'Ürün bazlı serbest KDV alanından backfill ile otomatik oluşturuldu (add_central_tax_rates migration).',
          false,
          v_next_sort_order,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("name") DO NOTHING;

        IF v_custom_id IS NULL THEN
          SELECT "id" INTO v_custom_id FROM "tax_rates" WHERE "name" = v_custom_name;
        END IF;
      END IF;

      UPDATE "products" SET "taxRateId" = v_custom_id WHERE "id" = r."id";
    END IF;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- SiteSettings singleton — "Standart KDV"yi mağaza varsayılanı yap ve
-- pricesIncludeTax'i (bugünkü tek davranışla uyumlu) true olarak sabitle. Satır
-- lazy-upsert deseniyle henüz hiç oluşmamış olabilir (bkz. modules/settings/
-- settings.routes.ts), bu yüzden INSERT ... ON CONFLICT kullanılır.
-- ----------------------------------------------------------------------------
INSERT INTO "site_settings" ("id", "updatedAt", "pricesIncludeTax", "defaultTaxRateId")
VALUES (
  'singleton',
  CURRENT_TIMESTAMP,
  true,
  (SELECT "id" FROM "tax_rates" WHERE "name" = 'Standart KDV')
)
ON CONFLICT ("id") DO UPDATE SET
  "defaultTaxRateId" = EXCLUDED."defaultTaxRateId",
  "pricesIncludeTax" = true;
