# architect-scope: Ürün Katalogu — Listeleme/Filtreleme (`/products`) + Ürün Detay (`/products/[slug]`)

**Durum:** BAĞLAYICI karar dokümanı. `docs/architecture/openapi.yaml` ile birlikte TEK
doğruluk kaynağıdır; çelişkide **openapi.yaml kazanır** (`.claude/CLAUDE.md` "Çakışma
Çözümü").

**Üst dokümanlar (aynen geçerli, bu doküman onları GENİŞLETİR, DEĞİŞTİRMEZ):**
- `.claude/architect-scope-ecommerce-pro-template.md` → bundan sonra **[EPT]**
  (varyasyon modeli §1, PDF dökümanlar §2, kargo §3, "storefront ≠ şablon" sınırı §5).
- `.claude/design-notes-ecommerce-storefront.md` → **[DNS]** (swatch/beden butonu/indirim
  rozeti/düşük stok/ücretsiz kargo çubuğu/sticky bar/PDF kartı token'ları).
- `.claude/architect-scope-i18n.md` → slug çözümleme, `ContentSlug`, `?locale=` semantiği.

**[EPT]'ye getirilen TEK resmi tadilat:** [EPT] §8, "Çok Satanlar sıralaması"nı
`feature/product-bestsellers` backlog'una atmıştı. Kullanıcı bu turda açıkça istedi;
**karar tersine çevrildi** ve §2.3'te (denormalize `Product.salesCount`) uygulanabilir bir
tasarımla kapsama alındı. [EPT] §8'in diğer TÜM kapsam-dışı maddeleri (sahte siparişler,
sekmeli ızgara, çok kurallı kargo, `/urun/` rota segmenti, varyasyon matris üreteci,
şablon i18n) **aynen kapsam dışıdır.**

**Branş:** `feature/products-catalog-ux`. Tüm iş TEK commit'te toplanır; commit'i
orkestratör atar (ajanlar commit ATMAZ).

---

## 0. Bir cümlede karar

`/products` **sunucuda render edilen, URL'i tek durum kaynağı olan** bir katalogdur
(filtre/sıralama/sayfa `searchParams`'ta yaşar, backend `GET /products` bunları SQL'e
çevirir ve facet sayaçlarını döner); `/products/[slug]` ise **iki kolonlu bir PDP**'ye
dönüştürülür ve bugünkü "başlıksız/boş" render'ı §4.1'deki üç somut kök nedenden
kurtarılır. Yeni bir veri modeli İCAT EDİLMEZ — [EPT]'nin `ProductVariant`/
`ProductDocument`/`SiteSettings` kargo modeli aynen tüketilir; DB'ye yalnızca
**sıralanabilir/filtrelenebilir olması için gereken 4 denormalize kolon + 1 hiyerarşi FK +
1 dizi kolonu** eklenir.

---

## 1. Mevcut durum — kanıt (varsayım değil, okundu)

| Bulgu | Kanıt | Sonuç |
|---|---|---|
| Public `GET /products` yalnızca `cursor`+`limit`+`locale` alıyor | `products.routes.ts:1121-1150` | Filtreleme/sıralama/arama/sayfa numarası **YOK** — sıfırdan yazılacak |
| Yanıt `orderBy: { seq: "asc" }` — yani ürünler EN ESKİDEN yeniye | aynı yer | "En yeniler" varsayılanı bile yanlış |
| `data` tam `Product` DTO'su (`descriptionHtml`, `translations`, `seoScoreIssues`, `author` dahil) | `ProductSchema`, `entities.ts:434` | Liste yükü gereksiz ağır → `ProductListItem` (§3.2) |
| `ProductCategory`'de `parentId` YOK — kategoriler DÜZ | `schema.prisma:605-615` | "Hiyerarşik kategori filtresi" bugün İMKÂNSIZ → §2.1 |
| Varyasyon değerleri yalnızca `optionValues Json` + `variantKey String` içinde | `schema.prisma:714-745` | Renk/beden ile SQL filtresi imkânsız → §2.2 |
| Fiyat sıralaması `COALESCE(discount, price)` gerektiriyor; Prisma `orderBy`'da ifade DESTEKLEMİYOR | `product-pricing.ts::resolveEffectivePrice` | Denormalize kolon → §2.3 |
| Public kategori ucu YOK (`/admin/products/categories` yalnızca admin) | `app.ts:165` | Kenar çubuğu kategorileri **facet'ten** gelecek, yeni public uç AÇILMAYACAK |
| `WishlistItem` + `FavoriteButton` ZATEN var | `schema.prisma:2079`, `favorite-button.tsx` | Favori için **hiçbir yeni tablo/uç yok** — yeniden kullan |
| `SiteSettings.shippingFlatFeeCents` / `freeShippingThresholdCents` var, public `GET /settings` bunları ZATEN dönüyor | `settings.routes.ts:38-41`, `entities.ts:705` | PDP kargo bildirimi için **backend işi yok** |
| `next.config.ts`'te `images` bloğu YOK; kodda `<img>` + `eslint-disable @next/next/no-img-element` yorumları var | `next.config.ts`, `product-gallery.tsx:64`, `product-card.tsx:32` | `next/image` isteğinin ÖN KOŞULU `remotePatterns` → §6.1 |
| Medya URL'leri `env.PUBLIC_URL` ile MUTLAKLAŞTIRILIYOR (S3/CDN'de zaten mutlak) | `mappers/index.ts:336` | `remotePatterns` env'e göre değişken olmalı, sabit host YAZILAMAZ |

---

## 2. Veri modeli kararları (db-agent — BAĞLAYICI)

Tek migration: **`add_product_catalog_facets`**. Hepsi salt-ekleme; `ALTER TYPE` yok,
kolon silme yok, veri kaybı yok.

### 2.1 `ProductCategory.parentId` — hiyerarşi EKLENİR, en fazla 2 seviye

```prisma
model ProductCategory {
  // ... mevcut alanlar DEĞİŞMEDEN ...
  // Katalog kenar çubuğu hiyerarşisi — EN FAZLA 2 SEVİYE (kök → alt). Derinlik tavanı DB'de
  // DEĞİL uygulama katmanında zorlanır (bkz. architect-scope-products-catalog.md §2.1).
  // onDelete: SetNull — üst kategori silinince alt kategoriler KÖK olur, ürünleriyle birlikte
  // sessizce kaybolmazlar (Cascade burada veri kaybı olurdu).
  parentId String?
  parent   ProductCategory?  @relation("ProductCategoryTree", fields: [parentId], references: [id], onDelete: SetNull)
  children ProductCategory[] @relation("ProductCategoryTree")

  @@index([parentId])
}
```

**Neden 2 seviye tavanı:** 3+ seviye, kenar çubuğunda açılır-kapanır ağaç, "breadcrumb
zinciri", özyinelemeli sayaç toplaması ve döngü tespiti demektir; hiçbirinin karşılığı
istekte yok. Tavan uygulama katmanındadır (`409 CONFLICT`), DB CHECK/trigger **YOK** —
`Address` "kullanıcı başına 20 adres" emsaliyle AYNI desen (`schema.prisma:2069`).

**Neden `BlogCategory`'ye EKLENMİYOR:** hiyerarşi ürün katalogunun bir ihtiyacıdır; blog
kategorilerine "simetri olsun diye" eklemek, hiçbir arayüzün kullanmadığı bir alan ve iki
ayrı döngü-tespit kodu üretir.

### 2.2 `ProductVariant.optionValueSlugs String[]` — renk/beden filtresi SQL'e taşınır

```prisma
model ProductVariant {
  // ... mevcut alanlar DEĞİŞMEDEN ...
  // `variantKey`'in ("beden:l|renk:antrasit") parçalarının DİZİ hâli — TAM OLARAK
  // `variantKey.split("|")`. Katalog filtresi (`?option=renk:antrasit`) bunun üzerinde
  // `hasSome` ile çalışır; JSON `optionValues` üzerinde SQL filtresi mümkün DEĞİLDİR
  // (eksen adı mağazaya/dile göre değişir). Sunucu türetir — istemci ASLA göndermez.
  optionValueSlugs String[]

  @@index([optionValueSlugs(ops: ArrayOps)], type: Gin)
}
```

- **Türetme TEK yerdedir:** `modules/products/lib/variants.ts::deriveVariantKey` zaten bu
  formatı üretiyor. Yeni yardımcı: `deriveOptionValueSlugs(optionValues) =
  deriveVariantKey(optionValues).split("|")`. İkinci bir normalizasyon mantığı YAZILMAZ.
- **Backfill (migration içinde, TEK satır, deterministik):**
  `UPDATE "product_variants" SET "optionValueSlugs" = string_to_array("variantKey", '|');`
  [EPT] §1.4'teki "elle SQL yazma" yasağı **Prisma şemasında karşılığı olmayan yapılar**
  içindi (kısmi indeks); geriye dönük veri doldurma bunun kapsamında DEĞİLDİR ve
  `prisma migrate` sürüklenme uyarısı ÜRETMEZ. Migration dosyasına bu gerekçe yorum
  olarak yazılır.
- **Neden ayrı bir `ProductVariantOptionValue` tablosu değil:** filtre yalnızca "bu ürünün
  şu değeri var mı" sorusunu sorar; join tablosu üç yeni indeks, bir cascade zinciri ve
  varyasyon CRUD'unda ikinci bir yazma yolu getirirdi. GIN indeksli `text[]`, aynı sorguyu
  tek tabloda cevaplar.

### 2.3 `Product` üzerinde 3 denormalize sıralama kolonu

```prisma
model Product {
  // ... mevcut alanlar DEĞİŞMEDEN ...
  // Katalog sıralama/filtreleme kolonları — TÜRETİLMİŞTİR, elle YAZILMAZ. Tek üretim
  // noktası: lib/product-pricing.ts::derivePriceColumns (bkz. §2.4).
  effectivePriceCents Int @default(0)   // = discountPriceCents ?? priceCents
  discountPercent     Int @default(0)   // = discount varsa round((1-d/p)*100), yoksa 0
  // PAID/SHIPPED/FULFILLED siparişlerdeki OrderItem.quantity toplamı — `sort=bestselling`
  // kaynağı. REFUNDED/CANCELLED DÜŞÜLMEZ (v1, bkz. openapi `ProductListItem.salesCount`).
  salesCount          Int @default(0)

  @@index([status, deletedAt, effectivePriceCents])
  @@index([status, deletedAt, salesCount])
  @@index([status, deletedAt, discountPercent])
  @@index([status, deletedAt, publishedAt])
}
```

**Backfill (migration içinde):**
```sql
UPDATE "products" SET "effectivePriceCents" = COALESCE("discountPriceCents", "priceCents"),
  "discountPercent" = CASE WHEN "discountPriceCents" IS NULL OR "priceCents" <= 0 THEN 0
    ELSE ROUND((1 - "discountPriceCents"::numeric / "priceCents") * 100) END;
UPDATE "products" p SET "salesCount" = COALESCE(s.total, 0) FROM (
  SELECT oi."productId" AS pid, SUM(oi.quantity) AS total FROM "order_items" oi
  JOIN "orders" o ON o.id = oi."orderId" WHERE o.status IN ('PAID','SHIPPED','FULFILLED')
  GROUP BY oi."productId") s WHERE p.id = s.pid;
```

**Neden denormalizasyon, "hesapla-anında" değil (gerekçe zorunlu, çünkü [EPT] §1.2
denormalize `hasVariants` bayrağını REDDETMİŞTİ):** o ret, **DB'nin zorlayabildiği bir
gerçeğin** (varyasyon var mı) kopyalanmasına karşıydı — `variants` ilişkisi zaten
sorgulanabilir olduğu için bayrak saf sürüklenme riskiydi. Buradaki üç kolon ise
**SQL'de ifade EDİLEMEYEN** sıralama anahtarlarıdır: Prisma `orderBy` bir `COALESCE`/oran
ifadesi kabul etmez, uygulama katmanında sıralamak ise `LIMIT/OFFSET`'i yok eder (tüm
katalogu belleğe çekmek gerekir). Sürüklenme riski §2.4'teki tek üretim noktasıyla
kapatılır.

**`sort=price_asc` ve varyasyon fiyatı — bilinçli, dokümante sınır:** bu kolonlar **ürün
seviyesindedir**; bir varyasyonun `priceCents` override'ı katalog sıralamasını/fiyat
aralığı filtresini ETKİLEMEZ (PDP'de doğru fiyat gösterilmeye devam eder). Aksi hâli, her
varyasyon yazımında ana ürünün min-fiyatını yeniden hesaplamak (fan-out) demektir ve
`ecommerce-pro`'daki 60+ varyasyonun neredeyse tamamı zaten `priceCents: null` (miras)
kullanıyor. Gerçek ihtiyaç doğarsa: backlog `feature/variant-aware-catalog-price`.

### 2.4 Türetilmiş kolonların TEK üretim noktası (backend-agent — ATLANIRSA SESSİZ SÜRÜKLENME)

`backend/src/lib/product-pricing.ts` içine (yeni dosya AÇILMAZ — fiyat mantığının zaten
tek evi orası):

```ts
export function derivePriceColumns(input: { priceCents: number; discountPriceCents: number | null }):
  { effectivePriceCents: number; discountPercent: number }
```

**Çağrılması ZORUNLU olan 5 yazma yeri (eksiksiz liste — biri atlanırsa katalog sessizce
yanlış sıralar):**
1. `modules/products/products.routes.ts` — `POST /admin/products` (`tx.product.create`, ~sat. 282)
2. `modules/products/products.routes.ts` — `PATCH /admin/products/:productId` (fiyat/indirim gövdede varsa)
3. `modules/products/products.routes.ts` — `PATCH /admin/products/:productId/stock` **HARİÇ** (fiyat değişmez)
4. `modules/demo-templates/importer.ts:393` — `tx.product.create`
5. `modules/import/import.worker.ts:1038` ve `:1123` — CSV içe aktarma (İKİSİ de)

`salesCount` bu yardımcının kapsamında DEĞİLDİR; §5.2'ye bakınız.

### 2.5 `SiteSettings` — tahmini teslimat süresi

```prisma
  shippingEstimatedDaysMin Int?   // null = tahmini süre GÖSTERİLMEZ
  shippingEstimatedDaysMax Int?
```

**Neden kod içine sabit metin yazılmıyor:** "1-3 iş günü içinde kargoda" cümlesi mağaza
sahibinin vermediği bir **ticari taahhüttür** (Mesafeli Satış; [EPT] §7.3 ücretsiz kargo
eşiği için aynı hükmü zaten koymuştu). İkisi de `null` iken PDP bu satırı HİÇ render
etmez. Bu dört kargo alanı (`flatFee`, `threshold`, `daysMin`, `daysMax`) için admin
arayüzü BUGÜN DE YOKTUR (mevcut boşluk, bu turda kapatılmıyor) → backlog
`feature/admin-shipping-settings-ui`.

---

## 3. API kontratı (backend-agent — openapi.yaml BİREBİR)

Kontrat `docs/architecture/openapi.yaml` içine **bu turda YAZILDI.** Aşağıdakiler
uygulama notlarıdır; alan adları/tipleri için kontrat esastır.

| Ekleme | Yer |
|---|---|
| `GET /products`: `page`, `perPage`, `limit`(geriye dönük), `search`, `category`, `minPrice`, `maxPrice`, `option`(tekrarlanabilir), `inStock`, `sort`, `facets`, `locale` | `paths./products.get.parameters` |
| `PageNumber`, `PerPage`, `CatalogSearch`, `CatalogCategory`, `CatalogMinPrice`, `CatalogMaxPrice`, `CatalogOption`, `CatalogInStock`, `CatalogSort`, `CatalogFacets` | `components.parameters` |
| `ProductListItem`, `ProductCategoryFacet`, `ProductOptionFacet`, `ProductCatalogFacets`, `ProductCatalogMeta` | `components.schemas` |
| `ProductCategory.parentId` + `Create/UpdateProductCategoryRequest.parentId` | `components.schemas` |
| `Product.salesCount`, `Product.discountPercent` (`readOnly`) | `components.schemas.Product` |
| `SiteSettings`/`UpdateSiteSettingsRequest`: `shippingEstimatedDaysMin/Max` | `components.schemas` |

### 3.1 Sayfalama — bu uçta `cursor` YOK (bilinçli sapma, gerekçeli)

Depodaki her liste ucu `seq` tabanlı cursor kullanır. Katalog, `seq` ile hiçbir ilişkisi
olmayan sıralamalar (`price_asc`, `bestselling`, `discount`) sunar; cursor bu sıralamalarda
tanımsızdır. Ayrıca arayüz "37 ürün bulundu", sayfa numaraları ve paylaşılabilir `?page=2`
ister. → **offset (`page`/`perPage`) + `meta.pagination`**.

- `limit` gönderilip `perPage` gönderilmezse `perPage = limit` (mevcut `sitemap.ts` ve
  `featured-products-block.tsx` çağrıları AYNEN çalışır — bu geriye dönük uyumluluk
  ZORUNLUDUR, iki dosyanın da değişmesi gerekmez).
- `page > totalPages` → `data: []`, **`404` DEĞİL** (kullanıcı elle URL yazabilir).
- Yanıt zarfı `ApiSuccessSchema` DEĞİL **`ApiSuccessWithMeta`** kullanır (dar `{nextCursor}`
  meta şeması `pagination`/`facets` alanlarını sessizce DÜŞÜRÜRDÜ — `schemas/common.ts`
  içindeki uyarı bunu açıkça söylüyor).

### 3.2 `ProductListItem` — tam `Product`'ın alt kümesi

Dışarıda bırakılanlar: `descriptionHtml`, `documents`, `translations`, `author`/`authorId`,
`status`, `taxRatePercent`, tüm SEO/OG alanları, `scheduledAt`, `deletedAt`, `seoScore`,
`seoScoreIssues`. İçeride TUTULMASI zorunlu olanlar ve nedenleri:
`localizations` + `updatedAt` (**`sitemap.ts` bunları okuyor** — düşürülürse sitemap
sessizce bozulur), `images` (kart hover'ındaki ikinci görsel), `variantOptions` + `variants`
(kartın renk noktaları ve "tükendi" durumu), `salesCount`/`discountPercent` (rozetler).

Backend'de `ProductListItemSchema = ProductSchema.omit({...})` olarak tanımlanır (ikinci bir
elle yazılmış şema YOK) ve `toProductListItemDto`, `toProductDto`'yu SARAR — iki mapper
arasında alan kopyalama YASAKTIR.

### 3.3 Filtre semantiği (bağlayıcı)

| Filtre | SQL karşılığı |
|---|---|
| taban | `status: PUBLISHED`, `deletedAt: null` (her zaman) |
| `search` | `title` ∨ `excerpt` ∨ `sku` üzerinde `contains`, `mode: "insensitive"`; yalnızca kanonik kolonlar (çeviri taranmaz) |
| `category` | slug → id çözümlenir, **kendisi + çocukları** (`categoryId: { in: [...] }`); bilinmeyen slug → boş sonuç |
| `minPrice`/`maxPrice` | `effectivePriceCents: { gte, lte }`; `minPrice > maxPrice` → `422` |
| `option` | eksen bazında grupla → her eksen için `variants: { some: { isActive: true, optionValueSlugs: { hasSome: [...] } } }`; eksenler arası **AND** (Prisma'da ayrı `some` blokları), eksen içi **OR** (`hasSome`) |
| `inStock=true` | `OR: [ { variants: { some: { isActive: true, stockQuantity: { gt: 0 } } } }, { AND: [ { variants: { none: {} } }, { stockQuantity: { gt: 0 } } ] } ]` — [EPT] §1.2 "satılan seviye" kuralının BİREBİR karşılığı |

`sort` → `orderBy` eşlemesi ve zorunlu `{ seq: "desc" }` eş-değer kırıcısı için kontrattaki
`CatalogSort` açıklamasına bakınız. **Eş-değer kırıcı atlanırsa** offset sayfalamada aynı
ürün iki sayfada görünür (PostgreSQL sıralamayı garanti etmez) — bu, qa-agent'ın test
edeceği somut bir regresyondur.

### 3.4 Facet hesabı (`?facets=true`)

Dört bağımsız sorgu, TEK `Promise.all` içinde (sıralı `await` zinciri YASAK):
1. `categories` — `groupBy({ by: ["categoryId"], _count })`, `category` filtresi ÇIKARILMIŞ
   taban üzerinde; ardından kategori ağacına yerleştirilir, kök sayacı = kendi + çocuklar.
2. `price` — `aggregate({ _min, _max })` `effectivePriceCents` üzerinde, fiyat filtresi
   ÇIKARILMIŞ küme.
3. `options` — `option` filtresi ÇIKARILMIŞ küme üzerinde
   `findMany({ select: { variantOptions: true, variants: { where: { isActive: true }, select: { optionValueSlugs: true } } }, take: PRODUCT_FACET_SCAN_LIMIT + 1 })`
   → uygulama katmanında toplanır (etiket/`swatchHex` `variantOptions` JSON'undan,
   sayaç `optionValueSlugs`'tan). `PRODUCT_FACET_SCAN_LIMIT = 2000` (env ile
   değiştirilebilir); aşılırsa `facets.truncated = true`.
4. `availability` — iki `count` (`inStock` filtresi uygulanmış / uygulanmamış).

**Disjunctive faceting (bağlayıcı):** her boyut, KENDİ filtresi kaldırılmış küme üzerinde
sayılır. Aksi hâlde "Antrasit" seçildiği anda diğer tüm renkler `(0)` olur ve kullanıcı
seçimini genişletemez — bu, filtre kenar çubuğunu kullanılamaz kılan klasik hatadır.

### 3.5 `GET /products/{slug}` — kontrat DEĞİŞMİYOR

Yanıt tam `Product` DTO'su olarak kalır (`variants`, `documents`, `category`,
`localizations` zaten dönüyor). **PDP için hiçbir yeni backend ucu/alanı gerekmez** —
kargo bilgisi `GET /settings`'ten, favori durumu mevcut wishlist uçlarından, sepete ekleme
mevcut `POST /cart/items`'tan gelir. `?variant=<id>` derin bağlantısı mevcut davranışıyla
korunur.

---

## 4. Ürün Detay Sayfası — "boş/bozuk render" kök nedenleri ve düzeltme (frontend-agent)

### 4.1 Kök nedenler (teşhis — tahmin değil)

1. **Sayfada `<h1>` YOK.** Ürün adı yalnızca `PageHeader`'da render ediliyor
   (`[slug]/page.tsx:87`), `PageHeader` ise `style === "HIDDEN"` iken `null` dönüyor
   (`page-header.tsx:50`). Yani `pageHeaderStyle: HIDDEN` ayarında PDP **ürün adı olmadan**
   açılıyor: galeri + fiyat + buton, başlıksız. Bu, bildirilen "boş render"ın birinci
   nedenidir ve aynı zamanda bir SEO/a11y hatasıdır (belge başlıksız).
2. **Görselsiz üründe sol kolon tamamen kayboluyor.** `ProductGallery`,
   `images.length === 0 && !highlightUrl` iken `null` dönüyor (`product-gallery.tsx:41`);
   üstünde de bir yer tutucu yok → sayfa gerçekten boş görünüyor.
3. **PDP tek kolon.** `max-w-4xl` `<article>` içinde galeri → fiyat → varyasyon →
   açıklama alt alta. Masaüstünde satın alma kutusu ekranın çok altında kalıyor; e-ticaret
   standardı olan "sol görsel / sağ satın alma" ızgarası yok. Breadcrumb, adet seçici,
   kargo/stok bildirimi, sekmeler de hiç yok.
4. **Layout shift.** Tüm görseller `width`/`height`'sız ham `<img>` (`product-gallery.tsx:65`,
   `product-card.tsx:33`) → CLS.

### 4.2 Hedef yapı (bağlayıcı iskelet)

```
PageHeader  →  KALDIRILIR (PDP'de). Yerine sayfa içi Breadcrumb + <h1>.
<article class="mx-auto max-w-6xl">           ← max-w-4xl DEĞİL (iki kolon sığmıyor)
  Breadcrumb: Ana Sayfa / Ürünler / {kategori} / {ürün}   ← kategori linki /products?category=<slug>
  grid lg:grid-cols-2 gap-8|10
    SOL  : ProductGallery (ana görsel + zoom + thumbnail şeridi) — sticky lg:top-24
    SAĞ  : <h1> · SKU/kategori · fiyat bloğu (üstü çizili liste + indirimli + kazanç rozeti)
           · varyasyon seçiciler · stok/kargo bildirimi · adet seçici · Sepete Ekle + Favori
  ProductTabs (mt-12): "Açıklama & Özellikler" | "Teknik Dökümanlar" | "İade & Garanti"
  StickyAddToCartBar (mobil, mevcut bileşen)
</article>
```

**Sekme davranışı (bağlayıcı):** sekmeler **URL'de yaşamaz** ve JS ile gizlenen paneller
`hidden` ile DOM'da KALIR (arama motoru ve `Ctrl+F` içeriği bulabilsin). `role="tablist"` /
`role="tab"` / `role="tabpanel"` + ok tuşu gezinmesi zorunlu. "Teknik Dökümanlar" sekmesi
`documents.length === 0` ise render EDİLMEZ (boş sekme gösterilmez). "İade & Garanti"
sekmesinin gövdesi **statik hukuki metin İÇERMEZ** — mevcut yasal sayfalara (`Page.isLegalDocument`)
bağlantı verir; uydurma iade/garanti şartı yazmak compliance ihlalidir ([EPT] §7.3).

---

## 5. Ajan görev dağılımı

Sıra: **db-agent → backend-agent → (ui-designer ∥ frontend-agent) → performance-agent →
seo-agent → qa-agent.** ui-designer, frontend-agent'ın filtre/kart/sekme bileşenlerine
başlamasından ÖNCE §5.3'teki token kararlarını yazar.

### 5.1 db-agent
**Dosyalar:** `backend/prisma/schema.prisma`,
`backend/prisma/migrations/<ts>_add_product_catalog_facets/migration.sql`.
- §2.1 `ProductCategory.parentId` + self-relation + `@@index([parentId])`.
- §2.2 `ProductVariant.optionValueSlugs String[]` + GIN indeksi + backfill.
- §2.3 `Product.effectivePriceCents` / `discountPercent` / `salesCount` + 4 bileşik indeks + backfill.
- §2.5 `SiteSettings.shippingEstimatedDaysMin/Max`.
- **Kabul:** `prisma migrate dev` temiz; `prisma generate` sonrası `typecheck` yalnızca
  BEKLENEN (henüz yazılmamış iş mantığı) hatalarını verir; backfill SQL'leri migration'a
  gerekçe yorumuyla eklenmiştir; mevcut 48 migration'a dokunulmamıştır.

### 5.2 backend-agent
**Dosyalar:** `modules/products/products.routes.ts`, `products.schemas.ts`,
`modules/products/lib/variants.ts` (`deriveOptionValueSlugs`),
`modules/products/lib/catalog-query.ts` (**YENİ** — filtre `where` + `orderBy` + facet
oluşturucu; route handler şişmemeli), `lib/product-pricing.ts` (`derivePriceColumns`),
`schemas/entities.ts` (`ProductListItemSchema`, facet şemaları), `mappers/index.ts`
(`toProductListItemDto`, `toProductCategoryDto`'ya `parentId`),
`modules/settings/settings.schemas.ts` + `settings.routes.ts` (`DEFAULTS`),
`modules/demo-templates/importer.ts` + `modules/import/import.worker.ts` (§2.4 çağrıları).
- `GET /products`'ı §3'e göre BİREBİR yaz. `publicProductsRoutes` içindeki mevcut
  `cursor` mantığı bu uçtan KALDIRILIR.
- Varyasyon CRUD'unda (`POST/PATCH .../variants`) `optionValueSlugs` yazılır;
  `PATCH` `optionValues` değiştiremediği için orada yeniden türetme GEREKMEZ (yalnızca
  `POST`) — ama savunmacı olarak `create` yolunda ZORUNLU.
- Kategori CRUD'una `parentId` + döngü/derinlik doğrulaması (`422`/`409`, §2.1).
- **`salesCount` canlı artırımı:** `modules/webhooks/stripe.routes.ts` içindeki MEVCUT
  `runSerializable` bloğunda, stok düşürmenin hemen yanına ürün başına
  `salesCount: { increment: quantity }`. Bu dosya [EPT] §9.4 gereği **integration-agent'ın
  sahasıdır**; orkestratör integration-agent'ı çalıştırmıyorsa, backend-agent bunu
  **yalnızca bu tek artırım satırıyla sınırlı, architect tarafından yazılı olarak
  yetkilendirilmiş bir istisna** olarak yapabilir — ödeme/fiyat/kargo mantığına
  DOKUNULMAZ. Bu satır olmadan `bestselling` sıralaması geçmiş veriye donar (kabul
  edilemez).
- **Birim test:** `derivePriceColumns` (indirimsiz/indirimli/0 fiyat kenar durumları);
  `deriveOptionValueSlugs` ↔ `deriveVariantKey` tutarlılığı; `buildCatalogWhere` için
  `inStock` (varyasyonlu/varyasyonsuz) ve çok eksenli `option` (AND/OR) matrisi;
  kategori derinlik/döngü reddi.
- **Ödeme, sepet, checkout iş mantığına DOKUNMAZ.**

### 5.3 ui-designer
**Dosya:** `.claude/design-notes-products-catalog.md` (kod DEĞİL).
[DNS]'i GENİŞLETİR, hiçbir kararını değiştirmez. Tanımlanacaklar:
- Filtre kenar çubuğu: bölüm başlığı, açılır-kapanır grup, seçili filtre "çip"leri,
  "Filtreleri Temizle" bağlantısı, mobil "Filtrele" alt sayfası (drawer) davranışı.
- Fiyat aralığı slider'ı: ray/tutamak/aktif aralık token'ları, klavye odak halkası,
  manuel giriş alanlarıyla hizalanma.
- Kenar çubuğu renk swatch'ı ve beden etiketi: [DNS] §1/§2'nin **küçük (24px)** varyantı +
  "seçili" durumu (PDP'dekiyle karışmamalı: burada çoklu seçim var, `role="checkbox"`).
- Ürün kartı: hover'da ikincil görsel geçişi (`transition` süresi/eğrisi), hızlı sepete
  ekle + favori ikon yerleşimi ([DNS] §3'ün "`right-2 top-2` çakışma kuralı" AYNEN
  geçerli — üçüncü bir köşe icat edilmez), tıklanabilir renk noktaları, "Yeni" rozeti
  (eşik: `publishedAt` son 14 gün) ve "Çok satan" rozeti tonları.
- Izgara/liste görünüm geçiş düğmesi; liste görünümünde kart iskeleti.
- PDP: iki kolon ızgara boşlukları, sticky sol kolon davranışı, adet seçici (−/+),
  "kazanç rozeti" (`1.200 TL kazanın`), sekme başlığı (aktif/pasif/odak) ve PDF döküman
  kartı ([DNS] §8 AYNEN kullanılır, yeni kart TASARLANMAZ).
- **WCAG AA doğrulaması zorunlu:** yeni rozet tonları, slider tutamağı odak halkası,
  seçili filtre çipi. `--site-radius` override kuralı ([DNS] giriş notu) her yeni
  interaktif yüzeyde uygulanır.

### 5.4 frontend-agent
**ÖN KOŞUL:** `frontend/AGENTS.md` — "This is NOT the Next.js you know". Sunucu bileşeni
`searchParams`/`params` API'leri ve `next/image` kullanımından ÖNCE
`node_modules/next/dist/docs/` içindeki ilgili rehber OKUNACAK.

**Dosyalar (liste):**
- `frontend/src/app/[lang]/(site)/products/page.tsx` — sunucu bileşeni; `searchParams`'ı
  okur, tek `fetchProductCatalogServer(...)` çağrısı yapar, `PageHeader` + kenar çubuğu +
  toolbar + ızgara + sayfalamayı render eder.
- `frontend/src/app/[lang]/(site)/products/[slug]/page.tsx` — §4.2 iskeleti; `PageHeader`
  KALDIRILIR, `<h1>` sayfa içine taşınır.
- `frontend/src/lib/api/server-products.ts` — `fetchProductCatalogServer(params)` (yeni),
  `fetchProductsServer` **imzası korunur** (sitemap/featured blok).
- `frontend/src/lib/api/types.ts` — `ProductListItem`, `ProductCatalogMeta`,
  `ProductCatalogFacets`, `ProductCategory.parentId`, `SiteSettings` kargo alanları.
- **YENİ** `frontend/src/components/site/catalog/`: `catalog-sidebar.tsx`,
  `category-filter-tree.tsx`, `price-range-filter.tsx`, `option-facet-filter.tsx`,
  `stock-filter-toggle.tsx`, `active-filter-chips.tsx`, `catalog-toolbar.tsx`
  (arama + sıralama + görünüm), `catalog-pagination.tsx`, `catalog-mobile-filters.tsx`.
- **YENİ** `frontend/src/lib/catalog-search-params.ts` — `searchParams` ⇄ API query
  dönüşümünün **TEK** yeri (parse + serialize + `URLSearchParams` üretimi). Her bileşenin
  kendi query birleştirme mantığını yazması YASAK.
- **YENİ** `frontend/src/components/site/product/product-tabs.tsx`,
  `product-breadcrumbs.tsx`, `quantity-selector.tsx`, `product-shipping-notice.tsx`.
- Değişecek mevcut bileşenler: `product-card.tsx` (hover ikinci görsel, rozetler, renk
  noktaları, hızlı sepete ekle, liste/ızgara varyantı, `next/image`),
  `product/product-gallery.tsx` (boş durumda yer tutucu, `next/image`, zoom),
  `product/product-purchase-panel.tsx` (adet seçici + kargo bildirimi + sağ kolon
  düzenine uyum), `add-to-cart-button.tsx` (`--site-radius` override, [DNS] giriş notu).
- `frontend/next.config.ts` — `images.remotePatterns` (§6.1). **Bu tek anahtar için
  architect yetkilendirmesi verilmiştir**; dosyanın geri kalanı (Sentry/standalone)
  devops-agent'ındır ve DEĞİŞTİRİLMEZ.

**Bağlayıcı davranış kuralları:**
1. **URL tek durum kaynağıdır.** Filtre/sıralama/sayfa/görünüm `searchParams`'ta yaşar;
   sayfa sunucuda render edilir. `useSearchParams` + `Suspense` KULLANILMAZ —
   `[slug]/page.tsx`'in `?variant=` için kullandığı "server'da oku, client'ta
   `router.replace`" deseni AYNEN sürdürülür.
2. Filtre değişiminde `router.replace` (push DEĞİL — geri tuşu 20 filtre tıklamasını geri
   almamalı), `{ scroll: false }`; **sayfa numarası değişiminde `router.push` + yukarı
   kaydırma.** Filtre değişince `page` HER ZAMAN 1'e sıfırlanır.
3. Arama girişi 300 ms debounce; boş dizeye inince parametre URL'den SİLİNİR (boş
   `?search=` bırakılmaz).
4. **Kartta hızlı sepete ekleme:** ürünün `variants` dizisi BOŞ DEĞİLSE hızlı ekleme
   butonu "Seçenekleri Gör" bağlantısına dönüşür ve PDP'ye götürür — varyasyon seçilmeden
   sepete ekleme `409` döner, kullanıcıya hata göstermek yerine seçim ekranına yollamak
   doğru davranıştır.
5. Kart/PDP'de gösterilen fiyat, stok ve "tükendi" durumu **satılan seviyeden** okunur
   ([EPT] §1.2). Kart, varyasyonlu üründe ürün seviyesi `stockQuantity`'yi ASLA kullanmaz.
6. Boş durumlar ayrı ayrı yazılır: "hiç ürün yok" ≠ "bu filtrelerle sonuç yok" (ikincisi
   **Filtreleri Temizle** butonu içerir).
7. `templateKey`/`ecommerce-pro` bilen tek bir satır bile yazılmaz ([EPT] §5).
8. Kullanıcıya dönük TÜM metinler Türkçe; kod/değişken adları İngilizce (`.claude/CLAUDE.md`).

### 5.5 performance-agent
- `next/image`: `remotePatterns`, `sizes` (ızgara kırılım noktalarıyla TUTARLI), ilk
  satırdaki kartlarda ve PDP ana görselinde `priority`, geri kalanında `loading="lazy"`;
  `aspect-square` çerçeve + `fill` ile **CLS = 0** hedefi.
- `fetchProductCatalogServer` için `next: { revalidate }` stratejisi (mevcut 60 sn ile
  tutarlı) ve filtreli isteklerin önbellek anahtarına etkisi.
- Facet sorgularının ölçümü (`?facets=true` ile/olmadan p95), `PRODUCT_FACET_SCAN_LIMIT`
  değerinin doğrulanması, §2.3 indekslerinin gerçekten kullanıldığının `EXPLAIN` ile
  gösterilmesi. **Ölçmeden değişiklik yapmaz.**
- Katalog sayfası bundle'ı: kenar çubuğu bileşenlerinin gereksiz `"use client"`
  yayılmaması (yalnızca etkileşimli yapraklar client olmalı).

### 5.6 seo-agent
- `/products`: `generateMetadata` (başlık/açıklama), **filtreli/sayfa>1 URL'lerde
  `canonical` filtresiz `/products`'a; `?page>1` ve herhangi bir filtre varsa `robots:
  noindex, follow`** (sonsuz kombinasyon = duplicate content).
- PDP: `Product` + `Offer` (`price`, `priceCurrency`, `availability`, `sku`) +
  `BreadcrumbList` JSON-LD. Mevcut `JsonLdScript` bileşeni ve
  `lib/page-builder/structured-data.ts::safeJsonLdString` kaçışlaması AYNEN kullanılır;
  `product.noIndex` ise JSON-LD **basılmaz** (mevcut sayfa emsali).
- `sitemap.ts`'in ürün girdilerinin `ProductListItem` geçişinden sonra da çalıştığını
  doğrular.
- **frontend-agent meta tag/JSON-LD YAZMAZ** (`.claude/CLAUDE.md` sınırı).

### 5.7 qa-agent
Playwright senaryoları (`e2e/`):
1. **Kategori filtresi:** alt kategori seçilince yalnızca o kategorinin ürünleri; ÜST
   kategori seçilince alt kategori ürünleri de DAHİL; sayaç badge'i sonuç sayısıyla uyumlu.
2. **Fiyat filtresi:** slider/manuel giriş → sonuçtaki hiçbir fiyat aralık dışında değil;
   **indirimli ürün indirimli fiyatına göre filtreleniyor** (§2.3 sözleşmesi).
3. **Renk (option) filtresi:** iki renk seçilince OR; renk + beden seçilince AND.
4. **Sıralama:** `price_asc` çıktısının monotonluğu; sayfa 1→2 geçişinde **tekrar eden
   ürün OLMAMASI** (§3.3 eş-değer kırıcı regresyonu).
5. **PDP varyasyon senkronu:** renk değişince ana görsel + fiyat + stok metni anlık
   güncelleniyor; stoksuz beden üzeri çizili ve tıklanamaz; `?variant=` URL'i paylaşılıp
   yeniden açıldığında aynı varyasyon seçili geliyor.
6. **PDF indirme:** "Teknik Dökümanlar" sekmesi → İndir → dosya adı/`Content-Type`
   doğrulaması (`page.waitForEvent("download")`).
7. **Sepete ekleme:** varyasyonlu üründe seçim yapılmadan buton disabled; seçim sonrası
   ekleme → sepet çekmecesi doğru varyasyon etiketiyle açılıyor; kartta varyasyonlu ürünün
   hızlı ekleme butonu PDP'ye götürüyor.
8. **Boş durum:** sonuç vermeyen filtre kombinasyonunda "Filtreleri Temizle" çalışıyor.
9. **PDP başlık regresyonu:** `pageHeaderStyle: HIDDEN` iken sayfada tam olarak bir `<h1>`
   ve içinde ürün adı var (§4.1 madde 1'in kalıcı koruması).

---

## 6. Ortak teknik kararlar

### 6.1 `next/image` — ön koşul ve sınır
`next.config.ts`'te `images` bloğu olmadığı için depo bugün her yerde `<img>` +
`eslint-disable` kullanıyor. Medya URL'leri `env.PUBLIC_URL` (yerel sürücü) veya S3/CDN
(mutlak) olabildiğinden **sabit bir host yazılamaz**: `remotePatterns` `NEXT_PUBLIC_API_URL`
/ `NEXT_PUBLIC_MEDIA_URL` gibi çalışma zamanı değişkenlerinden türetilir; çözümlenemezse
`unoptimized` yerine mevcut `<img>` davranışına düşülür (build KIRILMAZ). Bu turda
`next/image`'a geçirilecek yüzey **yalnızca ürün kartı ve PDP galerisidir**; depodaki
diğer `<img>` kullanımları KAPSAM DIŞIDIR (tek seferde toplu geçiş ayrı bir iştir:
backlog `chore/next-image-migration`).

### 6.2 Terminoloji (tüm ajanlar aynı sözcükleri kullanır)
`catalog` (liste sayfası), `facet` (sayaçlı filtre boyutu), `option`/`axis` (varyasyon
ekseni), `token` (`renk:antrasit`), `PDP` (ürün detay sayfası), `sellable unit` (satılan
birim: varyasyon ya da varyasyonsuz ürün). "filter"/"filtre" dışında eş anlamlı
(`refinement`, `attribute`) KULLANILMAZ.

### 6.3 Git
Branş `feature/products-catalog-ux`; Conventional Commits. Tek commit:
`feat(products): katalog filtreleme/sıralama + profesyonel ürün detay sayfası`.

---

## 7. Bilinçli KAPSAM DIŞI + backlog

| Öğe | Neden | Branş |
|---|---|---|
| `color`/`size` diye ayrı query parametreleri | Eksen adları mağazaya/dile göre değişir; `option=<eksen>:<değer>` genel çözümdür (kontrat: `CatalogOption`) | — |
| Varyasyon fiyat override'ının katalog sıralamasına yansıması | §2.3 (fan-out recompute) | `feature/variant-aware-catalog-price` |
| Kargo ayarları için admin arayüzü (4 alan) | Mevcut boşluk, bu turun konusu değil | `feature/admin-shipping-settings-ui` |
| Depo genelinde `<img>` → `next/image` geçişi | §6.1 | `chore/next-image-migration` |
| Ürün karşılaştırma, beden tablosu modalı, "gelince haber ver", ürün yorumları/puanlama | İstenmedi | — |
| Çeviri metinlerinde (`translations` JSON) arama | Admin araması da yapmıyor; ayrı bir iş | `feature/i18n-content-search` |
| Sonsuz kaydırma | Sayfa numarası + SEO tercih edildi | — |
| 3+ seviye kategori ağacı | §2.1 | — |
