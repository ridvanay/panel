# architect-scope: Header canlı ürün arama + sipariş yaşam döngüsü e-postaları

Statü: **BAĞLAYICI**. Çelişki hâlinde `docs/architecture/openapi.yaml` kazanır.
Kontrat ve `docs/architecture/ARCHITECTURE.md` §10.23 bu kapsamla birlikte GÜNCELLENDİ.
Ajanlar tahmin yürütmez; burada YAZMAYAN bir alan/uç/enum değeri İCAT EDİLMEZ.

## 0. Karar özeti

| # | Konu | Karar |
|---|---|---|
| 1 | Arama ucu | **`GET /api/v1/products/search`** — `publicProductsRoutes` içinde, mevcut `requireModuleEnabled("products")` hook'unun altında |
| 2 | Query parametresi | **`search`** (`q` DEĞİL) — `trim().min(2).max(100)`, ZORUNLU; 1 karakter → 422 |
| 3 | Yanıt | `{ data: { products: ProductSearchHit[], categories: ProductCategory[] } }` — **`meta` YOK** |
| 4 | Limitler | Sunucu sabiti: **5 ürün / 3 kategori**. `limit` query parametresi **AÇILMAZ** |
| 5 | Fiyat alan adları | `priceCents` / `discountPriceCents` / `currency` — `price`/`salePrice` **REDDEDİLDİ** |
| 6 | Görsel alan adı | `coverMedia: Media \| null` — `coverImage`/`coverImageUrl` **REDDEDİLDİ** |
| 7 | Kategori DTO'su | Mevcut `ProductCategory` **AYNEN** yeniden kullanılır (yeni tip yok) |
| 8 | Cache header | **EKLENMEZ** (`s-maxage` yok) — gerekçe §1.5 |
| 9 | Rate limit | **VAR** — `{ max: 60, timeWindow: "1 minute" }`, route-level override |
| 10 | Yeni indeks / `pg_trgm` | **EKLENMEZ** (v1) — db-agent'a bu konuda görev YOKTUR |
| 11 | i18n | `?locale=` **DESTEKLENMEZ** — yalnızca kanonik kolonlarda arar |
| 12 | Yeni e-posta amaçları | **`ORDER_SHIPPED`** + **`ORDER_ADMIN_NOTIFICATION`** |
| 13 | Yeni ayar alanı | **`SiteSettings.orderNotificationEmail String?`** |
| 14 | Public sızıntı | `orderNotificationEmail` public `GET /settings`'te **DÖNMEZ** → yeni `AdminSiteSettings` DTO'su (§2.3) |
| 15 | "Yeni sipariş" tetikleyicisi | `stripe.routes.ts::handleOrderPaid` (PENDING→PAID) — **`POST /api/orders` İCAT EDİLMEZ** (§2.1) |
| 16 | "Kargoya verildi" tetikleyicisi | `orders.routes.ts` `PATCH /:orderId/status`, `-> SHIPPED` dalı |
| 17 | Kargo takip linki | **YOK** — `tracking_number` düz metin olarak basılır (§2.2c) |
| 18 | `sendCustomerEmail` | Artık `CANCELLED` **VE** `SHIPPED` hedeflerinde gönderilebilir (§2.5) |

---

# §1 — Header canlı ürün arama (instant search autocomplete)

## 1.1 Uç noktası ve yerleşim

**`GET /api/v1/products/search`** — yeni bir `server.get("/search", …)`, `products.routes.ts`
içindeki **`publicProductsRoutes`** fonksiyonuna, `GET "/"` ile `GET "/:slug"` arasına eklenir.

Gerekçeler (bağlayıcı):

1. **Ayrı bir `/search` prefix'i AÇILMAZ.** Sonuçlar tamamen `products` modülüne aittir;
   `publicProductsRoutes`'un router seviyesindeki `requireModuleEnabled("products")` hook'u
   sayesinde modül kapatıldığında uç **otomatik olarak 404** döner. Ayrı bir router bu guard'ı
   elle kopyalamayı gerektirirdi (ikinci bir doğruluk kaynağı).
2. **`/products/search` ile `/products/:slug` ÇAKIŞMAZ.** Fastify'ın radix router'ı (find-my-way)
   statik segmenti parametrik segmentin ÖNÜNDE değerlendirir. Kabul edilen tek yan etki: slug'ı
   birebir `search` olan bir ürünün detay sayfası erişilemez hâle gelir — bilinçli, ihmal
   edilebilir risk; rezerve-slug listesi v1'de **açılmaz**.
3. `POST /:slug/view` gibi mevcut alt yollarla aynı sınıfta bir "products alt kaynağı"dır.

## 1.2 Query sözleşmesi

```ts
// products.schemas.ts (YENİ)
export const SearchProductsQuerySchema = z.object({
  search: z.string().trim().min(2).max(100),
});
```

- Parametre adı **`search`**'tür. `q` REDDEDİLDİ: depodaki her serbest metin araması
  (`ListProductsQuerySchema.search`, `ListCatalogProductsQuerySchema.search`, portfolio/blog
  admin listeleri, openapi `SearchQuery`/`CatalogSearch` parametreleri) `search` kullanıyor;
  ikinci bir kısaltma icat etmek CLAUDE.md "ortak terminoloji" kuralının ihlalidir.
- **ZORUNLUDUR** ve `min(2)`'dir (katalogdaki `min(1).optional()`'dan bilinçli sapma). 1 karakter
  → `422 VALIDATION_ERROR` (`error.details.search`). Sunucu "boş sonuç" DÖNMEZ — frontend zaten
  2 karakter altında istek atmamakla yükümlüdür (§1.6), 422 bu sözleşmenin ihlalini görünür kılar.
- `.trim()` `min` kontrolünden ÖNCE uygulanır: `"  a "` → 422.
- **`locale`/`limit`/`page`/`cursor` TANINMAZ.** Gönderilirlerse sessizce yok sayılırlar
  (querystring şeması `.strict()` DEĞİLDİR — depo genelindeki davranış).

## 1.3 Yanıt şeması

Zarf mevcut `ok(data)` yardımcısıyla üretilir; **`meta` YOKTUR** (gerekçe: §1.4 madde 5).

```ts
// schemas/entities.ts (YENİ)
export const ProductSearchHitSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  priceCents: z.number().int(),
  discountPriceCents: z.number().int().nullable(),
  currency: z.string(),
  sku: z.string().nullable(),
  coverMedia: MediaSchema.nullable(),
});
export type ProductSearchHitDto = z.infer<typeof ProductSearchHitSchema>;

export const ProductSearchResultSchema = z.object({
  products: z.array(ProductSearchHitSchema),
  categories: z.array(ProductCategorySchema),
});
```

**Alan adları — bağlayıcı hakemlik.** Görev tanımındaki `price`/`salePrice`/`coverImage`
adları **REDDEDİLMİŞTİR**. `ProductSearchHit`'in HER alanı `ProductListItem`/`Product`
DTO'sundaki **aynı adı ve aynı tipi** taşır (`priceCents`, `discountPriceCents`, `currency`,
`sku`, `coverMedia`). Gerekçe: aynı ürün iki farklı uçtan iki farklı alan adıyla dönerse
frontend'de iki ayrı fiyat/görsel formatlayıcı doğar; para birimi ve kuruş semantiği
(`Int`, float YOK) tek bir sözleşmeden okunmalıdır.

**`coverMedia` neden düz bir URL değil?** `Media` DTO'su `mappers/index.ts::toMediaDto` +
`absolutizeMediaUrl` üzerinden üretilir; `coverImageUrl: string` demek bu mutlaklaştırmayı
ikinci bir yerde kopyalamak olurdu. Ayrıca `width`/`height`/`altText` alanları olmadan
`SafeImage`/`next/image` doğru render edemez. Bayt tasarrufu bu tutarlılığın önünde DEĞİLDİR.

**Kategori tipi.** Yeni bir `CategorySearchHit` tipi **AÇILMAZ** — mevcut `ProductCategory`
(`id`, `name`, `slug`, `parentId`, `createdAt`) ve `toProductCategoryDto` aynen kullanılır.
İstenen `id/name/slug` üçlüsü bunun alt kümesidir; iki fazladan alan yeni bir tip açmayı
haklı çıkarmaz.

**Mapper.** `mappers/index.ts::toProductSearchHitDto` (YENİ). `toProductListItemDto`'nun
"alanları `toProductDto`'nun ÜRETTİĞİ objeden destructure et" kuralı burada
**UYGULANAMAZ** (o kural tam `WITH_RELATIONS` join'ini gerektirir, bu uç bilinçli olarak
dar bir `select` kullanır) — bu bir **projeksiyon** mapper'ıdır. Kural yerine qa-agent
şunu test eder: aynı ürün için `GET /products/search` hit'inin 8 alanı, `GET /products`
listesindeki `ProductListItem`'ın aynı adlı alanlarıyla **birebir eşit** olmalıdır.

## 1.4 Sorgu semantiği (bağlayıcı)

İki sorgu **`Promise.all` ile PARALEL** çalışır (`GET /products` handler'ındaki mevcut
`Promise.all([queryCatalog, getLocaleSet])` deseniyle aynı).

**1) Ürünler** (`take: 5`):

```
where: {
  status: "PUBLISHED",
  deletedAt: null,
  OR: [
    { title:    { contains: term, mode: "insensitive" } },
    { sku:      { contains: term, mode: "insensitive" } },
    { category: { name: { contains: term, mode: "insensitive" } } },
  ],
},
select: { id, title, slug, priceCents, discountPriceCents, currency, sku, coverMedia: true },
orderBy: [{ salesCount: "desc" }, { seq: "desc" }],
```

- `status`/`deletedAt` filtresi **ZORUNLUDUR** — taslak/çöpteki ürün başlığı public bir uçtan
  sızdırılamaz.
- **Sıralama tam deterministiktir:** `salesCount desc` (çok satan önce) → eşitlikte `seq desc`
  (yeni önce). `seq` `@unique` olduğu için toplam sıra kararlıdır; aynı terim aynı sonucu aynı
  sırada döner (qa-agent'ın flake görmemesi için gereklidir).
- **Alaka düzeyi (prefix/exact match önceliği) v1'de YOKTUR.** Ham SQL / `pg_trgm` similarity
  bilinçli olarak reddedildi: depoda tek bir `$queryRaw` katalog sorgusu yok, ilk kez burada
  açmak orantısız. performance-agent gerçek yavaşlama ölçerse yeniden değerlendirilir.

**2) Kategoriler** (`take: 3`):

```
where: {
  name: { contains: term, mode: "insensitive" },
  OR: [
    { products: { some: { status: "PUBLISHED", deletedAt: null } } },
    { children: { some: { products: { some: { status: "PUBLISHED", deletedAt: null } } } } },
  ],
},
orderBy: { seq: "asc" },
```

- İkinci `OR` dalı **ZORUNLUDUR**: `GET /products?category=<slug>` bir kategorinin ALT
  kategorilerindeki ürünleri de listeler, dolayısıyla ürünleri yalnızca çocuklarında olan bir
  kök kategori "boş" sayılıp elenirse arama, gerçekte dolu olan bir kategoriyi gizlerdi.
  Özyineleme GEREKMEZ — hiyerarşi `assertValidCategoryParent` ile **en fazla 2 seviyedir**
  (`.claude/architect-scope-products-catalog.md` §2.1).
- Hiçbir yayınlanmış ürünü olmayan kategori dönmez (çıkmaz sokak sonuç üretilmez).

**3) Eşleşme**: `contains` + `mode: "insensitive"` — admin `GET /admin/products?search=` ve
public `GET /products?search=` ile aynı davranış. `%`/`_` karakterleri Prisma tarafından
kaçırılmaz (LIKE joker'i olarak davranabilirler); sonuç kümesi 5+3 ile sabit tavanlı ve
yalnızca zaten public olan veriyi döndüğü için bu **kabul edilmiş** bir davranıştır
(security-agent teyit eder, kod değişikliği beklenmez).

**4) `excerpt` aranmaz.** `CatalogSearch` `excerpt`'i de tarar; burada bilinçli olarak
TARANMAZ — açılır kutuda eşleşmenin NEDEN görüldüğü kullanıcıya gösterilemediğinden
(sonuçta yalnızca başlık görünür) "alakasız" hissi yaratır.

**5) Toplam sonuç sayısı DÖNMEZ.** `meta.total` için her tuş vuruşunda ikinci bir `COUNT`
sorgusu çalıştırmak reddedildi. Frontend'in "Tüm sonuçları gör" bağlantısı koşulsuz olarak
`/products?search=<term>` katalog sayfasına gider (sayıyı orası zaten gösteriyor).

## 1.5 Rate limit, cache ve indeks kararları

**Rate limit — VAR.** `products.routes.ts` dosya başına, `checkout.routes.ts::CHECKOUT_RATE_LIMIT`
ile aynı desende:

```ts
const PRODUCT_SEARCH_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };
```

ve route'ta `config: { rateLimit: PRODUCT_SEARCH_RATE_LIMIT }`. Gerekçe: public + kimliksiz +
her tuş vuruşunda tetiklenebilen + iki DB sorgusu çalıştıran bir uç. Global taban
`env.RATE_LIMIT_MAX = 300/dk` **tüm** uçlar için ortaktır; arama tek başına o bütçeyi tüketip
gerçek sayfa isteklerini 429'a düşürmemelidir. 60/dk, 250 ms debounce ile yazan bir insan
kullanıcı için fazlasıyla yeterlidir. Aşımda mevcut `RATE_LIMITED` zarfı döner
(openapi: `TooManyRequests`).

**Cache header — EKLENMEZ.** İnceleme sonucu (bağlayıcı bulgu): `backend/src/` içinde
`Cache-Control`/`s-maxage` **hiç kullanılmıyor** — `GET /products` dahil hiçbir public uç
cache header'ı set etmiyor (tek `reply.header` kullanımları: `x-request-id`, `x-ratelimit-*`,
uploads `Content-Disposition`). "Mevcut deseni uygula" talimatının sonucu bu yüzden
**header eklememektir**; burada tek başına bir cache header'ı açmak depoda ikinci bir
önbellek stratejisi doğurur ve önünde paylaşılan bir CDN olmadığı için ölçülebilir bir
faydası da yoktur. Önbellek sorumluluğu **istemcide**dir (§1.6).

**Yeni indeks — EKLENMEZ.** `contains + insensitive` bir B-tree indeksinden zaten
yararlanamaz; işe yaraması için `pg_trgm` uzantısı + GIN indeksi gerekir. Bu, migration'a
`CREATE EXTENSION` sokmak demektir (ortam/yetki bağımlılığı) ve v1 veri hacmi için
gereksizdir. **db-agent bu özellik için indeks/uzantı EKLEMEYECEKTİR.** Yeniden değerlendirme
tetikleyicisi: ölçülmüş p95 > 200 ms — sahibi performance-agent.

## 1.6 §1 iş bölümü

**backend-agent** (TEK sahip):
- `backend/src/schemas/entities.ts` → `ProductSearchHitSchema`, `ProductSearchResultSchema`.
- `backend/src/modules/products/products.schemas.ts` → `SearchProductsQuerySchema`.
- `backend/src/mappers/index.ts` → `toProductSearchHitDto`.
- `backend/src/modules/products/products.routes.ts` → `PRODUCT_SEARCH_RATE_LIMIT` sabiti +
  `publicProductsRoutes` içinde `GET /search` handler'ı (`GET "/"` ile `GET "/:slug"` arasına).
- Birim testler: 2 karakter altı → 422; taslak/çöpteki ürün DÖNMEZ; SKU ile eşleşme;
  kategori adıyla eşleşme; 5/3 tavanı; boş sonuçta `{ products: [], categories: [] }` (404 DEĞİL);
  yayınlanmış ürünü olmayan kategori dönmez; yalnızca ALT kategorisinde ürünü olan kök
  kategori DÖNER; `products` modülü kapalıyken 404.

**ui-designer** (kod yazmaz): açılır kutu (popover/command palette) spesifikasyonu —
tetikleyicinin header'daki yeri ve dar ekran davranışı, panel genişliği/max yüksekliği/z-index
katmanı (mevcut nested flyout menüsüyle çakışmamalı), satır yüksekliği ve 40×40 küçük görsel
alanı, indirimli fiyatın üstü çizili gösterimi, "Ürünler"/"Kategoriler" grup başlıkları,
boş-sonuç ve yükleniyor (skeleton) durumları, klavye odak halkası. Mevcut tasarım tokenleri ve
`components/ui/*` primitifleri kullanılır; yeni primitif İCAT EDİLMEZ.

**frontend-agent**:
- `frontend/src/lib/api/types.ts` → `ProductSearchHit`, `ProductSearchResult` tipleri.
- `frontend/src/lib/api/products.ts` (veya yeni `search.ts`) → `searchProducts(term, signal)`.
- `frontend/src/lib/api/client.ts` → `RequestOptions`'a **`signal?: AbortSignal`** eklenir ve
  `fetch`'e geçirilir (geriye dönük uyumlu, tek satırlık genişletme). Ham `fetch` ile
  ikinci bir istemci yazılmaz.
- `frontend/src/components/site/site-header.tsx` + yeni `header-search.tsx` (client component).
- **Bağlayıcı istemci kuralları:** (a) < 2 karakterde istek ATILMAZ; (b) **≥ 250 ms debounce**;
  (c) yeni istek atılırken önceki `AbortController` ile iptal edilir (yarış → yanlış sonuç
  gösterimini engeller); (d) terim → sonuç eşlemesi bileşen ömrü boyunca bellekte tutulur
  (geri silerken aynı terim tekrar sorgulanmaz); (e) `coverMedia.url` doğrudan kullanılır —
  `toInternalMediaUrl` **UYGULANMAZ** (o yalnızca sunucu tarafı fetch içindir).
- `useMemo`/`useState` dışında yeni bir state kütüphanesi eklenmez.

**qa-agent**: e2e — header'a "ka" yazınca açılır kutuda ürün + kategori görünür; sonuca
tıklayınca doğru ürün sayfasına gider; 1 karakterde istek atılmaz; bulunamayan terimde boş
durum metni; katalog sayfasına "tüm sonuçlar" geçişi.

**security-agent**: hafif inceleme — yalnızca zaten public olan alanların döndüğü, `status`/
`deletedAt` filtresinin kaldırılmadığı, rate limit config'inin bağlı olduğu.

---

# §2 — Sipariş yaşam döngüsü e-postaları

## 2.1 Gerçek akışın tespiti (bağlayıcı)

Bu projede **`POST /api/orders` diye bir uç YOKTUR ve AÇILMAYACAKTIR.** Sipariş
`POST /api/v1/checkout/session` içinde `PENDING` olarak yaratılır, ödeme onayı Stripe'ın
GELEN webhook'unda (`checkout.session.completed` → `handleOrderPaid`) gerçekleşir. Bu yüzden:

- **"Yeni sipariş" olayının tek doğru karşılığı `PENDING -> PAID` geçişidir.**
  `checkout/session` anında bildirim göndermek, hiçbir zaman ödenmeyecek (`EXPIRED`/`FAILED`)
  siparişler için mağaza sahibine çöp bildirim üretirdi — **reddedildi**.
- Bu, mevcut `ORDER_CONFIRMATION` e-postasının tetiklendiği **aynı** noktadır; iki e-posta
  yan yana, birbirinden bağımsız `try/catch`'lerde gönderilir.

## 2.2 Yeni `EmailTemplatePurpose` değerleri

Enum'a **iki** değer eklenir. Sıra (prisma enum + zod mirror + openapi + frontend union):
`… ORDER_CONFIRMATION, ORDER_CANCELLATION, ORDER_SHIPPED, ORDER_ADMIN_NOTIFICATION,
ORG_INVITATION, CONTACT_FORM_NOTIFICATION, CUSTOM`.

### (a) `ORDER_SHIPPED` — müşteriye, "Kargoya verildi"

| değişken | kaynak (`orders.routes.ts` içinde) |
|---|---|
| `order_number` | `order.orderNumber` |
| `customer_name` | `order.customerName ?? order.customerEmail` |
| `items_summary` | `order.items.map(i => \`${i.productTitle}${i.variantLabel ? \` (${i.variantLabel})\` : ""} x${i.quantity}\`).join(", ")` |
| `total_formatted` | `formatMoney(order.totalCents, order.currency)` |
| `tracking_number` | `order.trackingNumber!` |
| `shipping_carrier` | `order.shippingCarrier ?? ""` |

İlk dördü `ORDER_CANCELLATION` ile **birebir aynı türetme ifadeleridir** — kod kopyalanacaksa
bile ifade birebir aynı kalır (üç e-posta arasında `items_summary` farklılaşamaz).

**`shipping_carrier` boş olabilir** (`shippingCarrier` opsiyonel serbest metindir). Şartlı
render (`{{#if}}`) şablon motorunda **yoktur ve eklenmeyecektir**. Bağlayıcı çözüm:
seed'lenen varsayılan şablon `{{shipping_carrier}}`'ı **KULLANMAZ** (yalnızca
`{{tracking_number}}`); değişken registry'de mevcut kalır, kargo firmasını her zaman dolduran
mağaza sahibi şablona kendisi ekleyebilir. Böylece varsayılan e-postada asla
"Kargonuz  ile yola çıktı." gibi bozuk bir cümle oluşmaz.

### (b) `ORDER_ADMIN_NOTIFICATION` — mağaza yöneticisine, "Yeni sipariş"

| değişken | kaynak (`stripe.routes.ts::handleOrderPaid` içinde) |
|---|---|
| `order_number` | `order.orderNumber` |
| `customer_name` | `order.customerName ?? order.customerEmail` |
| `customer_email` | `order.customerEmail` |
| `items_summary` | (§2.2a ile aynı ifade) |
| `total_formatted` | `formatMoney(order.totalCents, order.currency)` |
| `placed_at` | `order.createdAt.toLocaleString("tr-TR")` |
| `order_admin_url` | `` `${env.FRONTEND_URL}/admin/orders/${order.id}` `` |

`order_admin_url` + `placed_at`, `CONTACT_FORM_NOTIFICATION`'ın `submission_url` +
`submitted_at` ikilisinin birebir muadilidir (aynı "yöneticiye bildirim" sınıfı).
`customer_email` YALNIZCA bu amaçta vardır — müşteriye giden e-postalarda kendi adresini
tekrar basmanın anlamı yoktur.

### (c) Kargo takip linki — YOK

İnceleme sonucu: depoda kargo firması → takip URL'i eşlemesi **hiç yok**; `shippingCarrier`
kapalı bir enum değil, 100 karakterlik **serbest metindir** (`orders.schemas.ts`). Firma adından
URL türetmek uydurma olurdu, yanlış link ise müşteri güvenini doğrudan zedeler.
**Karar: harici takip linki üretilmez**, `{{tracking_number}}` düz metin olarak basılır.
Kapalı bir `ShippingCarrier` enum'u + URL şablonu ayrı bir iştir → backlog (§10.23.6).

## 2.3 `SiteSettings.orderNotificationEmail` ve public sızıntı kararı

```prisma
/// Yeni sipariş bildirimi (ORDER_ADMIN_NOTIFICATION) alıcısı. null/boş = bildirim KAPALI
/// (best-effort atlanır, hata DEĞİLDİR) — ContactForm.notifyEmail ile AYNI semantik.
orderNotificationEmail String?
```

- `DEFAULTS` (`settings.routes.ts`): `orderNotificationEmail: null as string | null`.
- Yazma doğrulaması (`settings.schemas.ts`), `contact.schemas.ts::notifyEmail` ile **aynı**:
  `z.string().email().max(254).nullable().optional()`. Boş string KABUL EDİLMEZ (422);
  bildirimi kapatmak için `null` gönderilir.
- **Alan adı gerekçesi:** `adminEmail`/`notifyEmail` değil `orderNotificationEmail` —
  ileride başka bildirim türleri (stok tükendi, yeni yorum) kendi alanlarını alabilsin ve
  bu alan "sitenin yöneticisinin adresi" gibi genel bir anlam kazanmasın.

**Sızıntı kararı (BAĞLAYICI, security/compliance).** `GET /settings` **PUBLIC**tir ve bugün
tüm `SiteSettingsSchema`'yı döner. Bu alan oraya EKLENİRSE mağaza sahibinin e-posta adresi
kimliksiz herkese açılır (spam/harvest + gereksiz PII ifşası). Emsal zaten mevcuttur:
`PublicContactForm`, `notifyEmail`'i bilinçli olarak DÖNMEZ (openapi ~satır 3747).

Karar: **`SiteSettingsSchema` DEĞİŞMEZ.** Yeni:

```ts
// schemas/entities.ts
export const AdminSiteSettingsSchema = SiteSettingsSchema.extend({
  orderNotificationEmail: z.string().nullable(),
});
```

- `mappers/index.ts`: `toSiteSettingsDto` **DEĞİŞMEZ**; yeni `toAdminSiteSettingsDto`
  (`{ ...toSiteSettingsDto(row), orderNotificationEmail: row.orderNotificationEmail }`).
- `settings.routes.ts`: `publicSettingsRoutes` `GET /` **DEĞİŞMEZ**.
  `adminSettingsRoutes` `GET /` ve `PATCH /` yanıt şeması → `AdminSiteSettingsSchema`,
  mapper → `toAdminSiteSettingsDto`. (`readSettings`'in satır yokken `DEFAULTS` dönmesi
  korunur; `DEFAULTS`'a eklenen alan public yanıtta zod tarafından zaten strip edilir.)
- openapi: yeni `AdminSiteSettings` şeması + `/admin/settings` GET/PATCH `data`'sı ona işaret
  eder; `/settings` `SiteSettings`'te KALIR.

## 2.4 Tetikleme noktaları (dosya + satır)

**(A) `ORDER_ADMIN_NOTIFICATION`** — `backend/src/modules/webhooks/stripe.routes.ts`,
`handleOrderPaid`, **mevcut `ORDER_CONFIRMATION` try/catch bloğundan HEMEN SONRA (satır ~244,
fonksiyonun sonu)**. Sıra bağlayıcıdır: stok/`PAID` transaction → `USER→CUSTOMER` terfisi →
`ORDER_PAID` webhook'u → müşteri onay e-postası → **yönetici bildirimi**. Müşteriye giden
e-posta her zaman önce denenir.

```
1. settings = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID },
      select: { orderNotificationEmail: true } })
2. const to = settings?.orderNotificationEmail; if (!to) return;   // bildirim kapalı — HATA DEĞİL
3. try { await sendTemplateEmail(app, "ORDER_ADMIN_NOTIFICATION", to, { …§2.2b }); delivered = true }
   catch (err) { app.log.error({ err, orderId: order.id }, "Yeni sipariş bildirimi gönderilemedi") }
4. await logAudit(app, { action: "order.admin_notify_email",
      status: delivered ? "SUCCESS" : "FAILURE", targetType: "Order", targetId: order.id,
      metadata: { emailDelivered: delivered } })
```

`contact.service.ts::sendNotificationBestEffort` ile aynı sözleşme: **alıcı boşsa sessizce
atlanır ve bu bir hata değildir**; gönderim hatası webhook yanıtını ASLA bozmaz (aksi hâlde
Stripe webhook'u yeniden dener ve ikinci kez e-posta gider). `ContactSubmission.notifiedAt`
muadili bir kolon `Order`'a **EKLENMEZ** — sipariş için zaten bir aktivite akışı vardır (aşağı).

**(B) `ORDER_SHIPPED`** — `backend/src/modules/orders/orders.routes.ts`,
`PATCH /:orderId/status`, **mevcut `CANCELLED` e-posta bloğundan (satır ~266-292) HEMEN
SONRA, `return reply.send(...)`'ten (satır ~294) ÖNCE**. `ORDER_CANCELLATION` bloğunun
yapısı **birebir taklit edilir**:

```
if (targetStatus === "SHIPPED" && sendCustomerEmail !== false && order.trackingNumber) {
  let delivered = false;
  try { await sendTemplateEmail(app, "ORDER_SHIPPED", order.customerEmail, { …§2.2a });
        delivered = true; }
  catch (err) { app.log.error({ err, orderId: order.id }, "Kargo bildirim e-postası gönderilemedi"); }
  await logAudit(app, { action: "order.shipped_email", status: delivered ? "SUCCESS" : "FAILURE",
                        targetType: "Order", targetId: order.id,
                        metadata: { emailDelivered: delivered } });
}
```

- `order.trackingNumber` koşulu **savunmacıdır**: şema `SHIPPED` hedefinde `trackingNumber`'ı
  zaten zorunlu kılar (422), ama takip numarasız bir "kargoya verildi" e-postası hiçbir
  koşulda gitmemelidir.
- **Yalnızca durum GEÇİŞİNDE tetiklenir.** `PATCH /admin/orders/{orderId}` (sipariş düzenleme)
  ile takip numarası sonradan değiştirilirse e-posta **YENİDEN GÖNDERİLMEZ** (o uca hiçbir
  e-posta mantığı eklenmez).
- Audit action adları (`order.shipped_email`, `order.admin_notify_email`) `order.` önekiyle
  başladığı için `GET /admin/orders/{orderId}/activity` akışında (`action: { startsWith:
  "order." }`) **otomatik olarak görünürler** — ek bir kod gerekmez.
- `order.status_change` audit `metadata`'sındaki `customerEmailRequested` alanı artık
  `CANCELLED` **veya** `SHIPPED` hedeflerinde yazılır.

**(C) `ORDER_CONFIRMATION` DEĞİŞMEZ.** Mevcut çağrısına audit log eklenmez, değişkenleri
değişmez, taşınmaz. (Onay e-postasının audit kaydı olmaması bilinen bir asimetridir →
backlog §10.23.6.)

## 2.5 `UpdateOrderStatusRequest` sözleşme değişikliği

Bugün `sendCustomerEmail`, `status !== "CANCELLED"` iken gönderilirse **422** üretiliyor
(`orders.schemas.ts` satır 64-70). `ORDER_SHIPPED` için bu daraltma gevşetilir:

- `sendCustomerEmail` artık **`CANCELLED` VEYA `SHIPPED`** hedeflerinde gönderilebilir;
  diğer hedeflerde hâlâ 422 (mesaj: `"sendCustomerEmail yalnızca status=CANCELLED veya
  status=SHIPPED iken gönderilebilir."`).
- `cancellationReason` ve `confirmWithoutRefund` daraltmaları **AYNEN KALIR** (yalnızca
  `CANCELLED`).
- Geriye dönük uyumludur: mevcut admin arayüzü `SHIPPED` isteğinde bu alanı hiç göndermiyor,
  `?? true` varsayılanı devreye girer.
- openapi: `UpdateOrderStatusRequest` açıklaması + `/admin/orders/{orderId}/status`
  "Yan etkiler" paragrafı güncellenir.

## 2.6 KVKK / güvenlik notları

- `ORDER_ADMIN_NOTIFICATION` müşteri adı + e-posta adresini mağaza yöneticisine taşır:
  siparişin ifası için **meşru menfaat/sözleşmenin ifası** kapsamındadır, alıcı zaten
  admin panelinde aynı veriyi görmektedir; yeni bir veri kategorisi/işleme amacı doğmaz.
- Audit `metadata`'ya **alıcı adresi YAZILMAZ** (yalnızca `emailDelivered`) —
  `order.cancel_email` için konmuş mevcut veri minimizasyonu kuralı aynen geçerlidir.
- `orderNotificationEmail` public uçtan dönmez (§2.3).
- compliance-agent: yeni saklama süresi/aydınlatma metni değişikliği **beklenmiyor**;
  yalnızca teyit istenir.

## 2.7 §2 iş bölümü

**db-agent** (TEK sahip — şema/migration):
- `backend/prisma/schema.prisma`: `enum EmailTemplatePurpose`'a `ORDER_SHIPPED` +
  `ORDER_ADMIN_NOTIFICATION` (satır ~1597, `ORDER_CANCELLATION`'dan sonra, açıklama yorumuyla);
  `model SiteSettings`'e `orderNotificationEmail String?` (satır ~1114 bloğu).
- Tek migration (salt-ekleme, geri dönüşsüz veri kaybı yok). Mevcut kısmi unique indeks
  `email_templates_active_purpose_key` yeni amaçları **otomatik kapsar** — yeni indeks YOK.
- `backend/src/schemas/entities.ts` satır ~959 `EmailTemplatePurposeSchema` zod mirror'ı
  (aynı sıra) + §2.3'teki `AdminSiteSettingsSchema`.
- **§1 için db-agent'a görev YOKTUR** (indeks/uzantı eklenmez).

**notification-agent** (TEK sahip — şablon/değişken):
- `backend/src/lib/email-variables.ts`: `SYSTEM_VARIABLES_BY_PURPOSE`'a §2.2a ve §2.2b
  listeleri (`Record<EmailTemplatePurpose, …>` olduğu için eksik anahtar derleme hatası verir).
  Türkçe `label` + gerçekçi `sampleValue` zorunludur.
- `backend/prisma/seed.ts`: iki yeni `emailTemplate.upsert` — `key`/`purpose` amaç adıyla
  birebir, `editorMode: "RAW"`, `isSystem: true`, `isActive: true`, `availableVariables`
  registry ile birebir. `{{shipping_carrier}}` varsayılan gövdede KULLANILMAZ (§2.2a).
  Mevcut beş şablon **DEĞİŞTİRİLMEZ** (upsert `update: {}` idempotency'si korunur).

**backend-agent**:
- §1'in tamamı (§1.6).
- `stripe.routes.ts` (§2.4A), `orders.routes.ts` (§2.4B), `orders.schemas.ts` (§2.5),
  `settings.routes.ts` + `settings.schemas.ts` + `mappers/index.ts` (§2.3).
- Birim testler: `orderNotificationEmail` null iken hiç e-posta/audit kaydı YOK;
  SMTP hatası 200'ü bozmaz ve `FAILURE` audit yazar; `sendCustomerEmail: false` +
  `SHIPPED` → e-posta ve audit kaydı HİÇ oluşmaz; `sendCustomerEmail` `FULFILLED` ile
  gönderilirse 422; public `GET /settings` yanıtında `orderNotificationEmail` YOK.

**frontend-agent**:
- `frontend/src/lib/api/types.ts`: `EmailTemplatePurpose` union'ına iki değer;
  `SiteSettings` tipi **değişmez**, yeni `AdminSiteSettings` tipi.
- `frontend/src/lib/email-blocks/purpose-labels.ts`: `EMAIL_PURPOSE_LABEL` bir
  `Record<EmailTemplatePurpose, string>` olduğu için **iki değer eklenmezse derleme kırılır** —
  `ORDER_SHIPPED: "Kargo Bildirimi"`, `ORDER_ADMIN_NOTIFICATION: "Yeni Sipariş Bildirimi"`;
  `EMAIL_PURPOSES` dizisine de aynı sırada eklenir.
- Ayarlar ekranına "Yeni sipariş bildirim e-postası" alanı (boş bırakılırsa bildirim kapalıdır
  ifadesiyle) — yalnızca ADMIN'in gördüğü site ayarları formunda.

**qa-agent**: e2e — `SHIPPED` geçişinde sipariş aktivite akışında `order.shipped_email`
kaydının görünmesi; `sendCustomerEmail: false` ile görünmemesi; ayarlarda bildirim adresinin
kaydedilip geri okunması.

---

## 3. Kapsam dışı / görev DÜŞMEYEN ajanlar

- **integration-agent**: yeni ödeme sağlayıcısı/webhook YOK. `stripe.routes.ts`'e eklenen
  e-posta çağrısı Stripe entegrasyonunu DEĞİL, bildirim akışını genişletir; imza doğrulama,
  event tipi işleme ve idempotency'ye **DOKUNULMAZ**. Yine de dosya sahibi olarak
  bilgilendirilir; entegrasyon davranışı değişirse hakem architect'tir.
- **seo-agent**: arama sonuçları client-side bir popover'dır, indekslenebilir sayfa
  üretmez — meta tag/sitemap/structured data etkisi YOKTUR.
- **performance-agent**: proaktif görev yok; tetikleyici §1.5'te tanımlı.
- **observability-agent**: yeni `app.log.error` çağrıları mevcut desendedir; ek
  enstrümantasyon istenmez.
- **devops-agent**: yeni env değişkeni/servis YOK. Tek not: db-agent'ın migration'ı deploy
  sırasında normal akışta uygulanır.
- **release-coordinator**: sıra §4'te sabittir; ek bir plan üretmesine gerek yoktur.

## 4. Sıra ve git

Bağımlılık sırası (bağlayıcı): **db-agent → notification-agent → backend-agent →
ui-designer → frontend-agent → qa-agent**. (notification-agent'ın registry'si
backend-agent'ın `sendTemplateEmail` çağrısından, o da db-agent'ın enum'undan önce
gelmelidir; aksi hâlde ara commit'ler derlenmez.)

Branş: `feature/header-search-and-order-emails`. Conventional Commits. Orkestratör tek bir
commit'te toplayacaksa mesaj: `feat(products,orders): header canlı ürün araması + kargo/yeni
sipariş e-postaları`.
