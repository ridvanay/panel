-- CreateTable
CREATE TABLE "locales" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "nativeLabel" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hreflang" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locales_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "content_slugs" (
    "id" TEXT NOT NULL,
    "entityType" "ContentEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_slugs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locales_enabled_sortOrder_idx" ON "locales"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "content_slugs_entityType_entityId_idx" ON "content_slugs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "content_slugs_locale_entityType_idx" ON "content_slugs"("locale", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "content_slugs_locale_slug_key" ON "content_slugs"("locale", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "content_slugs_entityType_entityId_locale_key" ON "content_slugs"("entityType", "entityId", "locale");

-- AddForeignKey
ALTER TABLE "content_slugs" ADD CONSTRAINT "content_slugs_locale_fkey" FOREIGN KEY ("locale") REFERENCES "locales"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- §10.5 Çoklu Dil & Yerelleştirme — .claude/architect-scope-i18n.md §2.1/§2.4
-- (bağlayıcı karar dokümanı). Aşağıdaki adımlar İDEMPOTENTTİR: bu dosya elle
-- ikinci kez çalıştırılsa bile veri bozulmaz / çift satır oluşmaz.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Adım 1: "tam olarak bir varsayılan dil" kısıtı — Prisma DSL bunu ifade
-- edemez (bkz. §2.1). Kolon adı "isDefault" (camelCase) — bu tabloda @map
-- kullanılmadığı için fiziksel kolon adı Prisma alan adıyla birebir aynıdır
-- (bkz. yukarıdaki CreateTable ve locales_enabled_sortOrder_idx ile aynı
-- konvansiyon). CREATE UNIQUE INDEX ... IF NOT EXISTS: elle yeniden
-- çalıştırmaya karşı güvenli.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "locales_single_default" ON "locales" ("isDefault")
WHERE "isDefault" = true;

-- ----------------------------------------------------------------------------
-- Adım 2: Zorunlu seed — tr (varsayılan) + en (bkz. §2.1 "Seed (zorunlu...)").
-- ON CONFLICT DO NOTHING: idempotent.
-- ----------------------------------------------------------------------------
INSERT INTO "locales" ("code", "label", "nativeLabel", "isDefault", "enabled", "sortOrder", "hreflang", "createdAt", "updatedAt")
VALUES
  ('tr', 'Türkçe', 'Türkçe', true, true, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('en', 'İngilizce', 'English', false, true, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ----------------------------------------------------------------------------
-- Adım 3: translations.EN (büyük harf) -> translations.en (küçük harf), 4 tabloda.
-- jsonb_set + "-" operatörü (bkz. §2.4 madde 1). Idempotent: "EN" anahtarı
-- taşındıktan sonra WHERE koşulu bir daha eşleşmez. Zaten hem "EN" hem "en" varsa
-- (beklenmeyen ön koşul) mevcut "en" verisi SESSİZCE EZİLMEZ — "EN" olduğu gibi
-- kalır (backend'in büyük-harf okuma toleransı bunu geçici olarak karşılar,
-- bkz. §2.4 "Backend geriye dönük okuma toleransı").
-- ----------------------------------------------------------------------------
UPDATE "pages"
SET "translations" = jsonb_set("translations" - 'EN', '{en}', "translations" -> 'EN', true)
WHERE "translations" ? 'EN' AND NOT ("translations" ? 'en');

UPDATE "blog_posts"
SET "translations" = jsonb_set("translations" - 'EN', '{en}', "translations" -> 'EN', true)
WHERE "translations" ? 'EN' AND NOT ("translations" ? 'en');

UPDATE "products"
SET "translations" = jsonb_set("translations" - 'EN', '{en}', "translations" -> 'EN', true)
WHERE "translations" ? 'EN' AND NOT ("translations" ? 'en');

UPDATE "portfolio_items"
SET "translations" = jsonb_set("translations" - 'EN', '{en}', "translations" -> 'EN', true)
WHERE "translations" ? 'EN' AND NOT ("translations" ? 'en');

-- ----------------------------------------------------------------------------
-- Adım 4: Mevcut içerikten ContentSlug satırları üret (bkz. §2.4 madde 2-4).
--   - TÜM kayıtlar için 'tr' (kanonik slug kolonu).
--   - 'en' altında dolu `title` olan kayıtlar için 'en' (translations.en.slug
--     varsa o, yoksa kanonik slug).
-- Çakışma olursa (aynı locale+slug, entityType SINIRI YOK — bkz. ContentSlug
-- @@unique([locale, slug])) ikinci kayda -2, -3... eki verilir ve RAISE NOTICE
-- ile raporlanır. İşleme sırası deterministiktir: Page -> BlogPost -> Product ->
-- PortfolioItem, her tabloda `seq` (oluşturulma sırası) artan. Idempotent: bir
-- (entityType, entityId, locale) için content_slugs satırı zaten varsa atlanır.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "__i18n_next_available_slug"(
  p_locale TEXT,
  p_base TEXT,
  p_entity_type "ContentEntityType",
  p_entity_id TEXT
) RETURNS TEXT AS $fn$
DECLARE
  v_candidate TEXT := p_base;
  v_n INT := 1;
BEGIN
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM "content_slugs"
      WHERE "locale" = p_locale AND "slug" = v_candidate
    );
    v_n := v_n + 1;
    v_candidate := p_base || '-' || v_n;
  END LOOP;

  IF v_candidate <> p_base THEN
    RAISE NOTICE 'i18n slug migration: CAKISMA locale=%, entityType=%, entityId=%, istenen slug="%" -> atanan="%"',
      p_locale, p_entity_type, p_entity_id, p_base, v_candidate;
  END IF;

  RETURN v_candidate;
END;
$fn$ LANGUAGE plpgsql;

DO $$
DECLARE
  r RECORD;
  v_slug TEXT;
  v_en_title TEXT;
  v_en_slug_source TEXT;
BEGIN
  FOR r IN
    SELECT 'PAGE'::"ContentEntityType" AS entity_type, id, slug, translations, seq, 1 AS table_order FROM "pages"
    UNION ALL
    SELECT 'BLOG_POST'::"ContentEntityType", id, slug, translations, seq, 2 FROM "blog_posts"
    UNION ALL
    SELECT 'PRODUCT'::"ContentEntityType", id, slug, translations, seq, 3 FROM "products"
    UNION ALL
    SELECT 'PORTFOLIO_ITEM'::"ContentEntityType", id, slug, translations, seq, 4 FROM "portfolio_items"
    ORDER BY table_order, seq
  LOOP
    -- 'tr' (varsayılan dil) — TÜM kayıtlar.
    IF NOT EXISTS (
      SELECT 1 FROM "content_slugs"
      WHERE "entityType" = r.entity_type AND "entityId" = r.id AND "locale" = 'tr'
    ) THEN
      v_slug := "__i18n_next_available_slug"('tr', r.slug, r.entity_type, r.id);
      INSERT INTO "content_slugs" ("id", "entityType", "entityId", "locale", "slug", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, r.entity_type, r.id, 'tr', v_slug, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    END IF;

    -- 'en' — yalnızca translations.en.title dolu olan kayıtlar (bkz. §1.4 "çevrildi mi?").
    v_en_title := NULLIF(TRIM(BOTH FROM (r.translations -> 'en' ->> 'title')), '');
    IF v_en_title IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM "content_slugs"
        WHERE "entityType" = r.entity_type AND "entityId" = r.id AND "locale" = 'en'
      ) THEN
        v_en_slug_source := COALESCE(NULLIF(TRIM(BOTH FROM (r.translations -> 'en' ->> 'slug')), ''), r.slug);
        v_slug := "__i18n_next_available_slug"('en', v_en_slug_source, r.entity_type, r.id);
        INSERT INTO "content_slugs" ("id", "entityType", "entityId", "locale", "slug", "createdAt", "updatedAt")
        VALUES (gen_random_uuid()::text, r.entity_type, r.id, 'en', v_slug, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      END IF;
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION "__i18n_next_available_slug"(TEXT, TEXT, "ContentEntityType", TEXT);
