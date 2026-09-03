# architect-scope: `ecommerce-pro` — "Modern Storefront & E-Ticaret" demo şablonu + varyasyon/döküman/kargo genişlemesi

**Durum:** BAĞLAYICI karar dokümanı. `docs/architecture/openapi.yaml` ile birlikte TEK
doğruluk kaynağıdır; çelişkide **openapi.yaml kazanır** (`.claude/CLAUDE.md` "Çakışma
Çözümü").

**Üst doküman:** `.claude/architect-scope-demo-template-import.md` (bundan sonra **[DTI]**).
Bu doküman onu **DEĞİŞTİRMEZ, GENİŞLETİR.** [DTI]'nin tüm kararları (iki fazlı importer,
`asset:`/`ref:` token'ları, idempotency/`force`/`confirm`, ADMIN-only yazma, hız sınırı,
telafi/rollback, PNG varlık politikası, "yeni blok tipi YOK") **aynen geçerlidir.**
Bu dokümanın [DTI]'ye getirdiği **tek resmi tadilat** §4.6'da tek yerde listelenmiştir.

**Branş:** `feature/ecommerce-pro-template`.
**Orkestratöre not:** şu an `feature/admin-user-password-reset` üzerindeyiz; ilk ajan
(db-agent) çalışmaya başlamadan ÖNCE `master`'dan yeni branş açılmalıdır. Branş açma/geçiş
architect'in işi değildir.

---

## 0. Bir cümlede karar

Bu iş **iki ayrı iştir ve karıştırılmamalıdır:** (A) storefront'un KENDİSİNİN kalıcı
yetenek genişlemesi — `ProductVariant` + `ProductDocument` + mağaza geneli sabit kargo
bedeli/ücretsiz kargo eşiği + PDP/sepet arayüzü; (B) bu yetenekleri **sergileyen** ikinci
bir demo şablonu (`ecommerce-pro`) — mevcut `demo-templates` altyapısına yalnızca **veri**
ekleyen bir `templates/ecommerce-pro.ts` dosyası. (A) olmadan (B) anlamsızdır; (B), (A)'nın
üzerine hiçbir yeni altyapı KOYMAZ. **Örnek/sahte siparişler KAPSAM DIŞIDIR (§4.5).**

---

## 1. Varyasyon modeli (db-agent + backend-agent — BAĞLAYICI)

### 1.1 KARAR: Yeni `ProductVariant` tablosu + `Product.variantOptions Json`

Eksen TANIMI (Renk/Beden ve değerleri) JSON, eksen KOMBİNASYONU (satılabilir birim) TABLO.
Melez bir karar, iki gerekçeyle:

| Parça | Karar | Gerekçe |
|---|---|---|
| Eksen tanımı (`[{name:"Renk",type:"SWATCH",values:[...]}]`) | **`Product.variantOptions Json`** | Kimse ona FK vermez, sorgulanmaz, ürüne aittir ve şekli Zod ile korunur — `Product.translations` / `Page.blocks` / `Slide.layers` ile AYNI sınıf. `ProductOption`+`ProductOptionValue` tabloları açmak, iki tabloyu her okumada join etmek ve `.claude/architect-scope-i18n.md §1.2`'deki "ayrı tablo BİLİNÇLİ olarak açılmadı" kararının tersine dönmek olurdu. |
| Kombinasyon (sku/fiyat/stok/görsel) | **`ProductVariant` TABLOSU** | Bu satır **stok tutar, para taşır, FK ile referans edilir** (`CartItem`, `OrderItem`), benzersizlik kısıtı ister ve transaction içinde ATOMİK güncellenir. JSON'da stok tutmak, `runSerializable` ile korunan check-then-act akışını (webhook stok düşürme) doğrudan bozardı. |

**`Product` üzerinde genişleme (varyasyonu kolonlara açmak) REDDEDİLDİ** — "her kombinasyona
özel sku/price/stock/image" tanımı gereği N satırdır, sabit sayıda kolona sığmaz.

Sınırlar (Zod ile zorlanır): en fazla **2 eksen**, eksen başına en fazla **12 değer**, ürün
başına en fazla **60 varyasyon** (2×12 matrisin tavanı 144'tür; 60 pratik bir güvenlik
tavanıdır ve admin arayüzünü savunulabilir tutar).

### 1.2 Stok NEREDE yaşar — "satılan seviyede" (bağlayıcı, tek cümlelik değişmez)

> **Bir ürünün EN AZ BİR `ProductVariant` satırı varsa, satın alınabilir birim
> VARYASYONDUR; stok ve fiyat varyasyondan okunur ve `Product.stockQuantity` o ürün için
> YOK SAYILIR. Hiç varyasyonu yoksa mevcut davranış BİREBİR korunur.**

- **Denormalize `Product.hasVariants` bayrağı EKLENMEZ.** Bayrak ile gerçeklik arasında
  sürüklenme (drift) üretir ve DB hiçbir şekilde tutarlılığını zorlayamaz; "varyasyonu var
  mı" bilgisi `variants`/`_count.variants` ile TÜRETİLİR.
- `Product.stockQuantity` kolonu **KALDIRILMAZ** (varyasyonsuz ürünlerin ve mevcut
  `PATCH /admin/products/{id}/stock` ucunun tek doğruluk kaynağıdır).
- Varyasyonlu üründe admin arayüzü ürün-seviyesi stok alanını **salt-okunur** gösterir ve
  "toplam: Σ varyasyon stoğu" yazar; `PATCH .../stock` varyasyonlu üründe **`409 CONFLICT`**
  döner (sessizce yok sayılan bir yazma, en kötü seçenektir).
- Public storefront ucu (`GET /products/{slug}`) `stockQuantity`'yi ZATEN dönüyor; varyasyon
  stoğu da aynı yüzeyde döner ve "Son 3 ürün!" uyarısını besler. **`GET /public/*` (API
  anahtarı) yüzeyi ETKİLENMEZ** — orada `[DTI] dışı` bir karar olan §10.13.5 gereği ham stok
  DÖNMEZ; `PublicProductSchema`'ya varyasyon eklenirse yalnızca `inStock: boolean` türetilir.

### 1.3 `CartItem` ve `OrderItem` — `variantId` EKLENİR (zorunlu, gerekçeli)

`variantId` olmadan sepet "Antrasit/L" ile "Beyaz/S"yi ayırt edemez ve sipariş hangi birimin
satıldığını kaydedemez; snapshot disiplini (`OrderItem.productTitle`) tam da bunun için var.

- `CartItem.variantId String?` → `ProductVariant` (**onDelete: Cascade** — varyasyon
  silinince sepet satırı geçersizdir, yaşamasına izin vermek "sepette olmayan bir şey" üretir).
- `OrderItem.variantId String?` (**onDelete: SetNull**) + `OrderItem.variantLabel String?`
  (SNAPSHOT, ör. `"Antrasit / L"`). `OrderItem.productSku` **satılan birimin** SKU'sunu
  taşır (varsa varyasyonunki) — ayrı bir `variantSku` kolonu EKLENMEZ.

### 1.4 `@@unique([cartId, productId])` → `@@unique([cartId, productId, variantId])` ve NULL tuzağı (backend-agent — ATLANIRSA SESSİZ HATA)

PostgreSQL'de `NULL` değerler unique kısıtında **birbirine eşit sayılmaz**: varyasyonsuz bir
ürün için `(cartId, productId, NULL)` satırı **iki kez** yazılabilir. Yani üçlü unique'e
geçmek, varyasyonsuz ürünlerdeki mevcut DB seviyesi korumayı **zayıflatır.**

**Karar:** kısıt yine de üçlüye genişletilir; kaybedilen koruma **uygulama katmanında** telafi
edilir ve bu **bilinçli, dokümante bir zayıflatmadır**:

1. `POST /cart/items` arama anahtarı **`(productId, variantId ?? null)`** olur
   (`cart.items.find(...)` — mevcut find-then-update akışı zaten upsert kullanmıyor).
2. qa-agent, "aynı varyasyonsuz ürünü iki kez ekle → sepette TEK satır, miktar 2" testini
   **regresyon koruması** olarak yazar (§9 QA-3).
3. **Kısmi (partial) unique index (`... WHERE variant_id IS NULL`) EKLENMEZ** — depodaki 47
   migration'ın hiçbirinde elle yazılmış SQL yoktur; Prisma şemasında karşılığı olmayan bir
   indeks, sonraki `prisma migrate dev` çalıştırmalarında sürüklenme (drift) uyarısı ve
   "kim düşürdü?" sınıfı hatalar üretir. Tek bir demo şablonu için migration disiplinini
   bozmak orantısızdır.

### 1.5 Fiyat çözümleme — TEK üretim noktası

`ProductVariant.priceCents Int?` → **`null` = ürünün fiyatını MİRAS AL**; dolu ise MUTLAK
fiyattır (fark/delta DEĞİL — delta, indirimli fiyatla birleşince negatif tutar üretebilir).

Bağlayıcı: `backend/src/lib/product-pricing.ts::resolveUnitPriceCents(product, variant)`
**tek fonksiyondur** ve şu üç yerin ÜÇÜ de onu çağırır: sepete ekleme (fiyat dondurma),
sepet DTO'su (`currentPriceCents`), checkout (taze okuma). Üç yerde üç kopya mantık,
`sliders/shortcode.ts::buildSliderShortcode`'un kaçındığı hatanın ta kendisidir.

### 1.6 Stok düşürme — mevcut Serializable paterni DEĞİŞMEZ, hedefi değişir

`modules/webhooks/stripe.routes.ts` içindeki `runSerializable` bloğu **aynı kalır**; içindeki
tek satır genelleşir:

```
her OrderItem için:
  item.variantId ? tx.productVariant (oku → yetersizse FAILED → decrement)
                 : tx.product        (mevcut davranış, DEĞİŞMEDEN)
```

- Okuma ve düşürme **AYNI transaction içinde** kalır (yarış koşulu koruması buradan gelir).
- Yetersiz stok davranışı (`Order.status = FAILED`, `errorSummary`) **değişmez**.
- Bu değişiklik `checkout.routes.ts` ve `webhooks/stripe.routes.ts` dosyalarında olduğu için
  **integration-agent'ın** sahasıdır (§9); backend-agent yalnızca saf yardımcıyı
  (`resolveSellableUnit`) sağlar.

### 1.7 Prisma şeması (db-agent — doğrudan uygulanabilir)

```prisma
// Ürün varyasyonları — bkz. .claude/architect-scope-ecommerce-pro-template.md §1 (bağlayıcı).
// EKSEN TANIMI Product.variantOptions JSON kolonundadır; BU TABLO yalnızca satılabilir
// KOMBİNASYONU tutar (stok/para/FK taşıdığı için JSON DEĞİL tablo — §1.1).
// BAĞLAYICI DEĞİŞMEZ: bir ürünün en az bir varyasyonu varsa stok/fiyat BURADAN okunur ve
// Product.stockQuantity o ürün için YOK SAYILIR (§1.2). Denormalize `hasVariants` bayrağı
// BİLİNÇLİ olarak YOKTUR.
model ProductVariant {
  id                 String   @id @default(uuid())
  seq                Int      @unique @default(autoincrement())
  productId          String
  // Normalize + deterministik kombinasyon anahtarı: "beden:l|renk:antrasit"
  // (eksen adları slugify + alfabetik sıralı). Aynı kombinasyonun iki kez yazılmasını
  // DB seviyesinde engeller — sunucu türetir, istemci ASLA göndermez.
  variantKey         String
  // { "Renk": "Antrasit", "Beden": "L" } — anahtarlar Product.variantOptions[].name ile
  // BİREBİR eşleşmek zorundadır (uygulama katmanı doğrular, DB zorlayamaz).
  optionValues       Json
  sku                String?  @unique
  // null = Product.priceCents MİRAS ALINIR (§1.5). Dolu ise MUTLAK fiyat (delta DEĞİL).
  priceCents         Int?
  discountPriceCents Int?
  stockQuantity      Int      @default(0)
  mediaId            String?
  order              Int      @default(0)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  product    Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  media      Media?       @relation("ProductVariantImage", fields: [mediaId], references: [id], onDelete: SetNull)
  cartItems  CartItem[]   @relation("CartItemVariant")
  orderItems OrderItem[]  @relation("OrderItemVariant")

  @@unique([productId, variantKey])
  @@index([productId])
  @@index([mediaId])
  @@map("product_variants")
}

// Ürün teknik dökümanı (PDF) — ProductImage ile AYNI sıralı join tablosu deseni (§2).
// URL/boyut BURADA KOPYALANMAZ, Media'dan okunur.
model ProductDocument {
  id        String @id @default(uuid())
  productId String
  mediaId   String
  title     String
  order     Int    @default(0)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  media   Media   @relation("ProductDocumentMedia", fields: [mediaId], references: [id], onDelete: Cascade)

  @@unique([productId, mediaId])
  @@index([mediaId])
  @@map("product_documents")
}
```

Mevcut modellere eklenecekler:

```prisma
// Product:
  variantOptions Json @default("[]")   // §1.1 eksen tanımı
  variants  ProductVariant[]
  documents ProductDocument[]

// CartItem:
  variantId String?
  variant   ProductVariant? @relation("CartItemVariant", fields: [variantId], references: [id], onDelete: Cascade)
  @@unique([cartId, productId, variantId])   // ESKİ @@unique([cartId, productId]) KALDIRILIR — §1.4 NULL uyarısı!
  @@index([variantId])

// OrderItem:
  variantId    String?
  variantLabel String?
  variant      ProductVariant? @relation("OrderItemVariant", fields: [variantId], references: [id], onDelete: SetNull)
  @@index([variantId])

// Order:
  shippingCents Int @default(0)        // §3

// SiteSettings:
  shippingFlatFeeCents       Int?      // §3 — null = kargo hesaplanmaz (mevcut davranış)
  freeShippingThresholdCents Int?

// Media (zorunlu karşı-ilişkiler):
  productVariantImages ProductVariant[]  @relation("ProductVariantImage")
  productDocuments     ProductDocument[] @relation("ProductDocumentMedia")
```

**Tek migration:** `add_product_variants_documents_shipping`. Salt-ekleme + tek kısıt
değişimi (`cart_items` unique), `ALTER TYPE` YOK, veri kaybı YOK.

---

## 2. Teknik dökümanlar (PDF)

### 2.1 KARAR: `ProductDocument` tablosu — `Product.documents Json` DEĞİL

`translations Json` emsali BURAYA UYMAZ: o, FK'sız, serbest anahtarlı bir i18n override
sözlüğüdür. Döküman ise **yüklenmiş bir dosyaya (`Media`) işaret eder.** JSON'da URL string'i
tutmak (a) FK bütünlüğünü yok eder — medya silinince ölü link kalır, (b) "bu dosya nerede
kullanılıyor?" sorusunu cevaplanamaz kılar, (c) `ProductImage`'ın **aynı şemada, 20 satır
yukarıda duran** emsalinden sapar. Alan seti (başlık/url/boyut) zaten `title` + `Media.url` +
`Media.sizeBytes` ile karşılanır; **boyut ve URL kopyalanmaz.**

### 2.2 PDF, medya boru hattına EKLENİR — ama tek kapıdan (security-agent'a bağlayıcı talimat)

Mevcut boru hattı **yalnızca görsel** kabul ediyor (`mime-detect.ts` görsel-özel,
`ALLOWED_MIME_TYPES` 4 tür). PDF gerçekten yeni bir yetenektir ve şu kurallarla açılır:

1. Tespit **AYNI dosyada** (`lib/mime-detect.ts`) genişletilir: `%PDF-` magic byte'ı
   (`25 50 44 46 2D`) + `MIME_TO_EXTENSION["application/pdf"] = ".pdf"`. İkinci bir tespit
   modülü **YAZILMAZ** (dosya başlığındaki "iki modül de aynı kod yolundan geçer" disiplini).
   `detectImageMimeType`'ın **adı ve görsel-özel sözleşmesi korunur**; PDF için aynı dosyada
   `detectUploadMimeType()` sarmalayıcısı eklenir ve görsel çağıranlar DEĞİŞMEZ.
2. **SVG kararı DELİNMEZ** — [DTI] §4.1 aynen geçerli.
3. Servis: `/uploads/*` için görsel OLMAYAN türlerde **`Content-Disposition: attachment`** +
   **`X-Content-Type-Options: nosniff`** (`@fastify/static` `setHeaders`). Gerekçe: PDF
   JavaScript taşıyabilir ve API origin'inde satır içi açılan bir dosya phishing/İÇERİK
   yüzeyi üretir; indirme olarak servis etmek bunu kapatır ve zaten istenen davranıştır
   ("PDF indirme kartları").
4. Boyut: mevcut global 5 MB (`MAX_UPLOAD_BYTES`) yeterlidir, **ayrı bir override YOK.**
5. **Tür karışması engellenir (bağlayıcı):** görsel bekleyen tüm FK slotları
   (`Product.coverMediaId`, `ProductImage`, `PortfolioItem`/`PortfolioImage`,
   `Slide.bgMediaId`, `SiteAppearance.pageHeaderBackgroundMediaId`,
   `ProductVariant.mediaId`) `mimeType` `image/` ile başlamıyorsa **`422`** döner;
   `ProductDocument.mediaId` ise `application/pdf` DEĞİLSE `422`.
6. `GET /admin/media` yeni `type=image|document` filtresi alır (openapi'ye eklendi) —
   `MediaPicker` görsel modunda PDF göstermez.

**security-agent'a devir:** yukarıdaki 6 maddeyi denetle; ek olarak PDF'in `imageSize()`
çağrısından geçmediğini (`width/height` null kalır), yükleme yetkisinin
ADMIN/MANAGER/EDITOR'da değişmeden kaldığını ve indirilen dosyanın uzantısının **beyandan
değil tespitten** türetildiğini doğrula.

---

## 3. Kargo: `ShippingRule` tablosu YOK — `SiteSettings`'te İKİ alan

### 3.1 Bulgu (kanıt)

`checkout.routes.ts` bugün **hiç kargo bedeli hesaplamıyor**: `totalCents = subtotalCents`,
Stripe'a yalnızca ürün satırları gidiyor, `Order`'da kargo bedeli kolonu yok. Yani
"ücretsiz kargo eşiği kargo bedelini sıfırlar" cümlesinin bugün **sıfırlayacağı bir şey
yoktur.** Eşiği anlamlı kılmak için minimum bir kargo bedeli mekanizması ZORUNLUDUR.

### 3.2 KARAR

`SiteSettings` singleton'ına **iki nullable Int kolonu**:
`shippingFlatFeeCents` (mağaza geneli SABİT kargo bedeli) ve `freeShippingThresholdCents`.

- **`shippingFlatFeeCents = null` → kargo hiç hesaplanmaz, hiçbir yerde gösterilmez =
  BUGÜNKÜ davranışın birebir aynısı.** Varsayılan kurulumda hiçbir şey değişmez; bu, geriye
  dönük uyumluluğun kanıtıdır.
- Eşik `null` iken bedel her zaman uygulanır; eşik doluyken `subtotal >= threshold` ise 0.

**`ShippingRule` tablosu REDDEDİLDİ:** bir "kural" tablosu, kaçınılmaz olarak eşleşme
ölçütleri (bölge/ağırlık/kargo firması/ürün grubu), kural sırası, çakışma çözümü, admin CRUD
ekranı ve API yüzeyi demektir — hiçbiri istenmedi ve hiçbirini bu şablon sergilemiyor. İki
kolon, istenen davranışın TAMAMINI karşılar. Gerçek çok kurallı kargo isteği gelirse:
backlog `feature/shipping-rules` (o zaman bu iki alan kuralın "varsayılan satırı" olur).

**"Mağaza geneli VEYA şablon ayarı" belirsizliği çözülür:** değer **mağaza genelidir**
(`SiteSettings`); demo şablonu bu iki alanı **yazabilir** (§4.4), ama sahibi ayar tablosudur.
Şablona özgü, ayrı bir kargo ayarı **YOKTUR**.

### 3.3 Hesaplama TEK yerde, ve tahsil EDİLİR

`backend/src/lib/shipping.ts::computeShipping(subtotalCents, settings)` → `CartShipping`
DTO'su. Üç tüketici: sepet DTO'su, checkout, `Order.shippingCents` snapshot'ı.

**Bağlayıcı:** kargo bedeli sepette gösteriliyorsa **Stripe oturumuna da ayrı bir satır
olarak eklenir ve tahsil edilir** (`Order.shippingCents`, `totalCents = subtotal - discount +
shipping`). Gösterilen tutar ile tahsil edilen tutarın farklı olması hem güven hem Mesafeli
Satış mevzuatı açısından kabul edilemez. Stripe `shipping_options`/adres toplama
yapılandırması **KULLANILMAZ** (adres akışı `feature/checkout-address-from-book` kapsamında,
bkz. `schema.prisma::Address` notu) — tek `price_data` satırı yeterlidir.

Bu değişiklik `checkout.routes.ts` + `webhooks/stripe.routes.ts` dosyalarında olduğundan
**integration-agent'ın sahasıdır**; backend-agent `lib/shipping.ts`'i yazar ve sepet DTO'suna
bağlar, ödeme sağlayıcısına DOKUNMAZ.

---

## 4. `DemoTemplateDefinition` genişletmesi

### 4.1 Yeni alanlar (`backend/src/modules/demo-templates/types.ts`)

```ts
export interface DemoTemplateDefinition {
  // ... [DTI] §3'teki TÜM mevcut alanlar DEĞİŞMEDEN ...

  /** null = bu şablon ticaret verisi getirmiyor (modern-architecture: null). */
  commerce: {
    /** §3.2 — SiteSettings'e YAZILIR. null bırakılırsa ayar DEĞİŞTİRİLMEZ. */
    shippingFlatFeeCents: number | null;
    freeShippingThresholdCents: number | null;
    categories: { name: string; slug: string }[];
    products: DemoTemplateProduct[];
  } | null;

  /** §4.3 — ana sayfa DIŞINDAKİ sayfalar (yasal yer tutucular + kurumsal sayfalar). */
  extraPages: DemoTemplateExtraPage[];
}

export interface DemoTemplateProduct {
  title: string; slug: string; excerpt: string | null; descriptionHtml: string;
  priceCents: number; currency: string;
  discountPriceCents: number | null;
  sku: string | null;
  /** Varyasyonsuz üründe stok; varyasyonlu üründe 0 yazılır ve YOK SAYILIR (§1.2). */
  stockQuantity: number;
  categorySlug: string | null;
  coverAssetKey: string | null;          // assets[].key → Product.coverMediaId
  galleryAssetKeys: string[];            // → ProductImage.mediaId
  variantOptions: ProductVariantOption[];// [] = varyasyonsuz
  variants: {
    optionValues: Record<string, string>;
    sku: string | null;
    priceCents: number | null;           // null = ürün fiyatını miras al (§1.5)
    discountPriceCents: number | null;
    stockQuantity: number;
    imageAssetKey: string | null;        // → ProductVariant.mediaId
    isActive: boolean;
  }[];
  documents: { title: string; assetKey: string }[];  // assets[].kind === "document"
  seoTitle: string | null; seoDescription: string | null;
  status: "PUBLISHED";                   // [DTI] §6.5 — şablon YALNIZCA PUBLISHED üretir
}

export interface DemoTemplateExtraPage {
  title: string; slug: string;
  seoTitle: string | null; seoDescription: string | null;
  blocks: PageNode[];
  /** true → Page.isLegalDocument. §7.3'teki yer tutucu metin kuralı ZORUNLU olur. */
  isLegalDocument: boolean;
}
```

`DemoTemplateAsset` tek bir opsiyonel alanla genişler:

```ts
  /** Varsayılan "image". "document" → application/pdf; imageSize() ÇAĞRILMAZ, altText başlık olarak kullanılır. */
  kind?: "image" | "document";
```

### 4.2 `page.blocks` aynasına eklenen düğümler — YENİ BLOK TİPİ YOK

[DTI] §8'in felsefesi korunur: frontend'de **var olmayan** hiçbir blok icat edilmez. Backend
aynasına (`types.ts::PageNode`) yalnızca **zaten var olan** iki frontend bloğunun yapısal
kopyası eklenir:

| Eklenen ayna düğümü | Frontend karşılığı | Neden gerekli |
|---|---|---|
| `DemoFeaturedProductsNode` (`{heading?, limit, categoryId?}`) | `FeaturedProductsBlock` (mevcut) | Ürün ızgaraları |
| `DemoImageNode` (`{url, alt, caption?, radius?, lightbox?}`) | `ImageBlock` (mevcut) | Kategori kartları / rozet barı görselleri |

**Yeni token ailesi (bağlayıcı, [DTI] §3.4'e ek):**
`ref:product-category:<slug>` → import sırasında oluşturulan `ProductCategory.id`.
Gerekçe kanıta dayalıdır: `featured-products-block.tsx` kategori filtresini **`categoryId`
eşitliğiyle** uyguluyor ve şablon yazım anında bu uuid mevcut değil. Çözümleyici
(`lib/asset-tokens.ts`) genelleştirilir; `ref:slider` ile AYNI mekanizma, AYNI dosya.
Çözülemeyen token yine **FATAL → `422`** ([DTI] §3.4 kural 3).

**Kompozisyon eşlemesi (bağlayıcı, backend-agent bu tabloya sadık kalır):**

| İstenen bölüm | Karşılığı |
|---|---|
| Hero kampanya slider'ı | `advanced-slider` + `ref:slider` (mevcut, [DTI] §3.1 ile aynı) |
| Öne çıkan kategoriler | `container(row)` → 4 × `container` → `image`(`asset:`) + `heading` + `button`(`/products?category=<slug>`) |
| Ürün ızgaraları | 2 × `featured-products` (biri `categoryId: "ref:product-category:<slug>"`) |
| Güvenlik/kargo rozet barı | `container(row)` → 4 × `icon-box` |
| "Çok Satanlar" sekmesi | **KAPSAM DIŞI** — bkz. §8 |

`ProductCategory`'ye görsel kolonu **EKLENMEZ** (kategori kartı görseli blok içindeki `image`
düğümündedir) — tek bir demo uğruna ticaret şemasına kolon açmak sahiplik tersine çevirmedir.

### 4.3 Yasal sayfalar — üretilir, ama METİN ÜRETİLMEZ (bağlayıcı)

`ecommerce-pro`, `isLegalDocument: true` ile **KVKK Aydınlatma Metni**, **Mesafeli Satış
Sözleşmesi**, **Ön Bilgilendirme Formu**, **İptal & İade Koşulları** sayfalarını
**yer tutucu** olarak oluşturur ve footer'dan bağlar.

**Gövde metni gerçek hukuki metin OLAMAZ.** [DTI] §3.2'de `ContactForm`'un KVKK onay
metninin şablondan çıkarılma gerekçesi ("bir demo şablonunun onay metni yazması hukuki
risktir") burada birebir geçerlidir ve daha ağırdır: bu sayfalar tüketiciye karşı
sözleşmedir. Her yasal sayfanın gövdesi **tek tip uyarı bloğu + boş iskelet başlıklar**
olur; ilk cümle ZORUNLU:

> "Bu metin bir **yer tutucudur** ve hukuki geçerliliği yoktur. Yayına almadan önce
> hukuk danışmanınızla birlikte doldurmanız zorunludur."

Import sonucunda ayrıca bir `warnings[]` girdisi döner: *"4 yasal sayfa YER TUTUCU olarak
oluşturuldu; yayına almadan önce içeriklerini doldurun."* (compliance-agent onaylar, §7.3.)

### 4.4 Yıkıcılık matrisi eki ([DTI] §6.1'e ek satırlar)

| Alan | Davranış |
|---|---|
| `ProductCategory` / `Product` / `ProductImage` / `ProductVariant` / `ProductDocument` | **EKLENİR** — kullanıcı ürünleri ASLA silinmez; slug çakışmasında [DTI] §6.5 benzersizleştirmesi |
| `Page` (extraPages) | **EKLENİR** (aynı kural) |
| `SiteSettings.shippingFlatFeeCents` / `freeShippingThresholdCents` | `commerce != null` ise **ÜZERİNE YAZILIR** — [DTI] §6.2'nin 5 alanlık listesi bu iki alanla **7'ye çıkar**; eski değerler audit `metadata.previousShipping`'e düşer |
| `Order` / `CartItem` / `User` | **ASLA YAZILMAZ** (§4.5) |

Importer FAZ 2 sırasına eklenen adımlar (2.7'den sonra, 2.8'den önce):
`2.7a productCategory.create → 2.7b product.create → productImage/productVariant/productDocument.createMany → 2.7c extraPages: page.createMany`.
Transaction timeout **30 sn** yeterlidir ([DTI] §5.3 değeri korunur); ~90 ek satır eklenir.

`products` modülü kapalıysa import yine `201` döner + `warnings[]`: *"Ürünler modülü kapalı
olduğu için içe aktarılan ürünler sitede görünmeyecek."* ([DTI] §6.6 deseni.)

### 4.5 Örnek siparişler — **KAPSAM DIŞI** (bağlayıcı, gerekçeli ret)

İstenen "2 örnek sipariş" **üretilmeyecektir.** Beş bağımsız gerekçeden her biri tek başına
yeterlidir:

1. **`Order.customerEmail` zorunludur ve tanımı gereği kişisel veridir.** Sahte de olsa,
   sisteme "tamamlanmış ticari işlem" görünümlü kayıtlar yazmak PII disiplinini bulanıklaştırır.
2. **Bu kayıtlar SİLİNEMEZ.** `schema.prisma::Order` üzerindeki compliance-agent kararı
   (2026-08-07) siparişleri KVKK md.5/2-c ve VUK gerekçesiyle **saklanması gereken** kayıt
   sınıfına koyar ve otomatik silme sweeper'ını bilinçli olarak reddeder; sistemde
   `DELETE /admin/orders` **yoktur.** Demo verisi, kalıcı ve silinemez muhasebe gürültüsü olur.
3. **İş metriklerini bozar.** `/admin/stats`, rapor/dışa aktarma işleri ve her muhasebe
   entegrasyonu `Order` toplamlarını okur — sahte ciro, sessiz veri bozulmasıdır.
4. **Ödeme değişmezlerini bozar.** `status: PAID` ama `stripePaymentIntentId` yok bir kayıt,
   webhook/iade/mutabakat akışlarında hiçbir zaman ortaya çıkmaması gereken bir durumdur;
   `POST /admin/orders/{id}/refund` böyle bir siparişte Stripe'a gider ve patlar.
5. **Yıkıcılık sözleşmesini bozar.** [DTI] §6.1 gereği şablon yalnızca kullanıcının
   SİLEBİLECEĞİ içerik ekler. Sipariş, sistemin kasıtlı olarak sildirmediği tek sınıftır.

**Yerine:** admin "Siparişler" ekranı boş kalır; şablon sonuç ekranında *"Örnek sipariş
oluşturulmaz — ilk gerçek siparişiniz burada görünecek."* notu gösterilir.
Backlog: `feature/demo-seed-orders` — importer'da DEĞİL, yalnızca geliştirme ortamında
çalışan ayrı bir `prisma/seed` script'i olarak (`NODE_ENV=production` ise reddeder).

### 4.6 [DTI]'ye resmi tadilatlar (TEK liste — başka tadilat yoktur)

| [DTI] maddesi | Tadilat |
|---|---|
| §3 `DemoTemplateDefinition` | `commerce` + `extraPages` alanları eklendi; `DemoTemplateAsset.kind?` eklendi |
| §3.3 `MAX_TEMPLATE_ASSETS = 24` | **`40`** (8 ürün × kapak+galeri + varyasyon görselleri + 3 PDF + kategori kartları). `MAX_TEMPLATE_ASSET_BYTES` (512 KB/dosya) **DEĞİŞMEZ.** Yeni tavanlar: `MAX_TEMPLATE_PRODUCTS = 12`, `MAX_TEMPLATE_PRODUCT_VARIANTS = 12`, `MAX_TEMPLATE_PRODUCT_DOCUMENTS = 3`, `MAX_TEMPLATE_EXTRA_PAGES = 8` |
| §3.4 token tablosu | `ref:product-category:<slug>` eklendi |
| §6.2 yazılan `SiteSettings` alanları | 5 → 7 (§4.4) |
| §3.2 "`Product` yazılmaz" satırı | **Kaldırıldı** — `commerce != null` olan şablonlar ürün yazar. `BlogPost`/`User` satırları AYNEN geçerlidir. |

Diğer her şey (uçlar, RBAC, hız sınırı, `confirm`, `force`, telafi, PNG politikası) **aynen
geçerlidir.**

---

## 5. Storefront geliştirmesi ≠ şablon (bağlayıcı sınır)

Varyasyon seçici, PDF indirme kartları, stok uyarısı, sepet çekmecesi ve ücretsiz kargo
ilerleme çubuğu **`ecommerce-pro`'ya ait DEĞİLDİR.** Bunlar mevcut storefront'un
(`products/[slug]`, `cart`, `products`) kalıcı yetenekleridir ve **`demo-templates` modülünün
DIŞINDA** geliştirilir. Şablon yalnızca bu yetenekleri **sergileyen veriyi** sağlar.

Pratik sonucu (ihlal edilirse architect'e eskale): `frontend/src/app/[lang]/(site)/**` ve
`frontend/src/components/site/**` altındaki hiçbir bileşen `templateKey`/`ecommerce-pro`
bilmez, bu isme koşullanmaz. Şablon silinse bile PDP/sepet aynen çalışır.

**URL segmenti kararı:** kullanıcının metnindeki `/urun/[slug]` **REDDEDİLDİ**; route
`products/[slug]` KALIR. Değiştirmek `ContentSlug`/i18n çözümlemesini, sitemap'i,
`canonicalUrl` üretimini, mevcut bağlantıları ve `featured-products`/`product-card`
bağlantılarını aynı anda kırar — kazanç yalnızca kozmetiktir. Türkçe rota segmentleri
istenirse bu, i18n'in kapsamıdır: backlog `feature/localized-route-segments`.

---

## 6. API sözleşmesi — `docs/architecture/openapi.yaml`'a EKLENENLER (bu turda YAPILDI)

| Ekleme | Yer |
|---|---|
| `ProductVariantOption`, `ProductVariant`, `ProductDocument`, `UpsertProductVariantRequest`, `AddProductDocumentRequest` | `components.schemas` |
| `Product`: `variantOptions`, `variants`, `documents` | `Product` |
| `CreateProductRequest`/`UpdateProductRequest`: `variantOptions` (update'te tam-replace + yetim varyasyon varsa `409`) | — |
| `POST/PATCH/DELETE /admin/products/{productId}/variants[/{variantId}]` | `paths` |
| `POST/DELETE /admin/products/{productId}/documents[/{documentId}]` | `paths` |
| `CartItem.variantId`/`variantLabel`, `AddCartItemRequest.variantId`, `CartShipping`, `Cart.shipping`, `Cart.totalCents` | — |
| `OrderItem.variantId`/`variantLabel` + `productSku` anlam netleştirmesi, `Order.shippingCents` | — |
| `SiteSettings` + `UpdateSiteSettingsRequest`: `shippingFlatFeeCents`, `freeShippingThresholdCents` | — |
| `MediaTypeFilter` (`GET /admin/media?type=image\|document`) + `POST /admin/media` PDF politikası | — |
| `VariantId`, `DocumentId` yol parametreleri | `components.parameters` |

**Yeni ÜST DÜZEY uç açılmadı:** kargo ayarları mevcut `PATCH /admin/settings` üzerinden
yönetilir (ADMIN-only, ayrıcalık yüzeyi genişlemez); ayrı bir `/admin/shipping` ucu YOKTUR.
`GET /products/{slug}` ve `GET /products` yanıt ŞEKLİ `Product` şemasından türediği için
otomatik genişler — **yeni public uç yoktur.**

---

## 7. Telif ve kişisel veri (compliance-agent — BAĞLAYICI)

[DTI] §9'un TAMAMI aynen geçerlidir. Bu şablona özgü EK kurallar:

### 7.1 Marka ve ürün adları
- **YASAK:** gerçek marka, model adı, tescilli ürün adı, gerçek mağaza adı, gerçek fiyat
  listesi, gerçek ürün fotoğrafı, internetten/stok görsel, AI ile üretilmiş fotogerçekçi
  ürün görseli.
- 4 kategori ve 8 ürün **jenerik ve tanımlayıcı** adlandırılır (ör. kategori: "Aydınlatma",
  "Oturma Grubu", "Depolama", "Aksesuar"; ürün: "Meşe Kaplama Yan Sehpa"). Ürün adı bir
  markayı çağrıştırıyorsa compliance-agent **reddeder.**
- Kurgusal mağaza adı compliance-agent tarafından **marka çakışması taraması yapılarak**
  belirlenir ([DTI] §9.4'teki "Mimarist" emsali).
- `sku` değerleri kurgusaldır ve gerçek bir GTIN/EAN/barkod formatına **benzemez**
  (ör. `DEMO-SEH-001`); geçerli görünen bir barkod başkasının ürününü işaret edebilir.

### 7.2 Görseller ve PDF'ler
- Görseller yalnızca [DTI] §4.3 boru hattıyla, depoda ÜRETİLİR (PNG, `_source/*.svg`'den).
- PDF'ler de **üretilir**: `backend/scripts/build-template-assets.ts` genişletilir ve
  bağımlılıksız (yalnızca `node:zlib`/düz PDF sözdizimi) 1 sayfalık, "ÖRNEK TEKNİK DÖKÜMAN
  — YER TUTUCU" başlıklı PDF'ler yazar. Hazır/indirilmiş PDF **KOMMİT EDİLMEZ.**
- Ürün açıklamaları anlamlı ama kurgusal Türkçe; teknik özellik tabloları gerçek bir
  üreticinin veri sayfasından KOPYALANMAZ.

### 7.3 PII ve yasal metinler
- **Şablon hiçbir kişisel veri üretmez** — sipariş yok (§4.5), müşteri hesabı yok, e-posta
  yok. İletişim yer tutucuları [DTI] §9.5 ile aynıdır (`info@example.com`, `+90 212 000 00 00`).
- Yasal sayfalar §4.3'teki **yer tutucu** kuralına uyar; compliance-agent gövde metinlerini
  madde madde denetler ve **gerçek sözleşme metni varsa PR'ı bloklar.**
- Ücretsiz kargo eşiği bir **ticari taahhüttür**: arayüzdeki metin ("Ücretsiz kargoya son
  X TL!") ile checkout'ta tahsil edilen tutar birebir tutarlı olmalıdır (§3.3) —
  compliance-agent bunu Mesafeli Satış açısından doğrular.

---

## 8. Bilinçli KAPSAM DIŞI + backlog

| Öğe | Neden | Branş |
|---|---|---|
| Örnek/sahte siparişler | §4.5 (5 gerekçe) | `feature/demo-seed-orders` (dev-only seed) |
| "Çok Satanlar" sekmesi/sıralaması | Satış adedi toplaması (`OrderItem` group-by + önbellek) gerçek bir özelliktir; `featured-products` bloğunda sıralama alanı YOK ve blok sözleşmesini bir şablon uğruna genişletmek sahiplik tersine çevirmedir. v1: "Yeni Gelenler" + kategori bazlı ikinci ızgara | `feature/product-bestsellers` |
| Sekmeli (tab'lı) ürün ızgarası | `TabsBlock` içeriği HTML taşır, iç içe blok DESTEKLEMEZ | yukarıdaki ile birlikte |
| Çok kurallı kargo (bölge/ağırlık/kargo firması) | §3.2 | `feature/shipping-rules` |
| Checkout'ta adres defterinden adres seçimi | Mevcut karar: adresi Stripe toplar (`schema.prisma::Address` notu) | `feature/checkout-address-from-book` |
| Türkçe rota segmentleri (`/urun/...`) | §5 | `feature/localized-route-segments` |
| Varyasyon matrisini otomatik üretme (admin "tüm kombinasyonları oluştur" düğmesi) | v1'de satır satır ekleme yeterli | `feature/variant-matrix-generator` |
| Çok dilli şablon / varyasyon çevirileri | [DTI] §3.2 ile aynı gerekçe | `feature/demo-template-i18n` |
| Ürün karşılaştırma, beden tablosu modalı, stok bildirimi ("gelince haber ver") | İstenmedi | — |

---

## 9. Ajan sırası ve görev listeleri

Sıra: **db-agent → (backend-agent ∥ ui-designer) → (integration-agent ∥ frontend-agent) →
security-agent ∥ compliance-agent → code-quality-agent → qa-agent → documentation-agent →
devops-agent**. Sıralamanın operasyonel planı release-coordinator'ındır.

### 9.1 db-agent (İLK — herkes bunu bekler)
Dosyalar: `backend/prisma/schema.prisma`, `backend/prisma/migrations/<ts>_add_product_variants_documents_shipping/`.
- §1.7'deki `ProductVariant` + `ProductDocument` modelleri **birebir**.
- `Product.variantOptions`, `CartItem.variantId` (+ **unique kısıt değişimi**, §1.4 uyarısını
  migration dosyasına yorum olarak yaz), `OrderItem.variantId`/`variantLabel`,
  `Order.shippingCents`, `SiteSettings` iki kargo kolonu, `Media` karşı-ilişkileri.
- Kabul: `prisma migrate dev` temiz; `prisma generate` sonrası backend `typecheck` yalnızca
  BEKLENEN (henüz yazılmamış iş mantığı) hatalarını verir; elle yazılmış SQL YOK.

### 9.2 backend-agent
Dosyalar: `modules/products/products.routes.ts` + `products.schemas.ts`,
`modules/products/lib/variants.ts` (**YENİ**: `variantKey` türetme, `optionValues`↔`variantOptions`
doğrulama, `label` üretimi), `lib/product-pricing.ts` (**YENİ**, §1.5), `lib/shipping.ts`
(**YENİ**, §3.3), `modules/cart/cart.routes.ts` + `cart.schemas.ts`, `schemas/entities.ts`,
`mappers.ts`, `lib/mime-detect.ts`, `modules/media/media.routes.ts`,
`plugins/uploads.ts` (attachment/nosniff başlıkları), `modules/settings/*`.
- Variant/document uçları openapi ile **BİREBİR** (§6).
- Sepete ekleme: `variantId` zorunluluk kuralları, stok/aktiflik kontrolü, `(productId,
  variantId)` dedupe (§1.4).
- `GET /cart` yanıtına `shipping` + `totalCents`.
- PDF kapısı (§2.2 maddeleri 1-6) + `type` filtresi.
- **Ödeme/webhook dosyalarına DOKUNMAZ.**
- Birim test: `variantKey` deterministik + `optionValues` uyumsuzluğu `422`;
  `resolveUnitPriceCents` miras/override/indirim matrisi; `computeShipping` eşik sınırları
  (eşiğin 1 kuruş altı/tam üstü).

### 9.3 backend-agent (şablon parçası — ayrı commit)
Dosyalar: `modules/demo-templates/types.ts` (§4.1/§4.2), `lib/asset-tokens.ts`
(`ref:product-category:`), `importer.ts` (FAZ 2 yeni adımlar, §4.4), `registry.ts`,
`templates/ecommerce-pro.ts` (**YENİ**), `assets/ecommerce-pro/**` (PNG + PDF),
`scripts/build-template-assets.ts` (PDF üretimi).
- Kabul: `page.blocks` `PageBlockListSchema`'dan, `slides[].layers` `SlideLayersSchema`'dan
  geçer; her token çözülür; `assertDemoTemplateCaps` yeni tavanları zorlar.

### 9.4 integration-agent
Dosyalar: `modules/checkout/checkout.routes.ts`, `modules/webhooks/stripe.routes.ts`,
`lib/webhook-order-payload.ts`.
- Checkout: taze okuma sırasında satılan birimi çöz (`variantId` varsa varyasyon; pasif/
  yetersizse `409`), `resolveUnitPriceCents` + `computeShipping` çağır, `Order.shippingCents`
  + `totalCents` yaz, Stripe'a "Kargo" satırı ekle (fee > 0 ise), `OrderItem.variantId`/
  `variantLabel` snapshot'la.
- Webhook: `runSerializable` bloğunda stok hedefini §1.6'ya göre dallandır.
- **Fiyat/kargo matematiğini KENDİ YAZMAZ** — backend-agent'ın yardımcılarını çağırır.

### 9.5 ui-designer
Dosya: `.claude/design-notes-ecommerce-storefront.md` (kod DEĞİL).
- Renk swatch'ı (seçili/pasif/üstü çizili durumları), beden butonu, indirim rozeti, düşük
  stok uyarısı, ücretsiz kargo ilerleme çubuğu, sepet çekmecesi (slide-over) ve sticky
  "Sepete Ekle" barı için token/durum tanımları; **WCAG AA** kontrast doğrulaması
  (özellikle "Son 3 ürün!" uyarı rengi ve pasif swatch üstü çizgisi).
- `ecommerce-pro` şablonunun `SiteAppearance` paleti + `preview.webp` ([DTI] §4.5).
- Mevcut `--site-*` token sistemi DIŞINA çıkan tek seferlik sınıf ÖNERMEZ ([DTI] §7.2).

### 9.6 frontend-agent
Dosyalar: `app/[lang]/(site)/products/[slug]/page.tsx` + yeni istemci bileşenleri
(varyasyon seçici, galeri/zoom, döküman kartları, sticky sepete ekle),
`components/site/cart-drawer.tsx` (**YENİ**), `components/site/free-shipping-progress.tsx`
(**YENİ**), `app/[lang]/(site)/cart/page.tsx`, `components/site/product-card.tsx`,
`components/site/blocks/featured-products-block.tsx` (gerekirse), `lib/api/cart.ts`,
`lib/api/products.ts`, `lib/api/types.ts`, admin tarafında ürün düzenleyiciye varyasyon +
döküman panelleri, `app/admin/demo-templates/demo-templates-view.tsx` (yeni kart/etiketler).
- Varyasyon seçimi: URL'de durum tutulur (`?variant=<id>`, paylaşılabilir/derin bağlantı),
  seçim fiyatı + galeri görselini + stok uyarısını günceller; stoksuz kombinasyon **üstü
  çizili ve tıklanamaz**; varyasyonlu üründe hiçbir seçim yapılmadan "Sepete Ekle" **pasif**.
- Kargo çubuğu ve kargo satırı **yalnızca** `cart.shipping.configured === true` ise render
  edilir; **para matematiği frontend'de YAPILMAZ** (`remainingCents` sunucudan gelir).
- PDF kartı: başlık + boyut (`Media.sizeBytes`'tan biçimlendirilmiş) + `download` bağlantısı.
- SEO/meta'ya DOKUNMAZ (seo-agent alanı); `templateKey`'e koşullanan bileşen YAZMAZ (§5).

### 9.7 security-agent
- §2.2'nin 6 maddesi; PDF servis başlıkları; medya tür karışması (`422`) testleri.
- Varyasyon uçlarında IDOR (`variantId`↔`productId` sahiplik) ve `sku` sızıntısı.
- `variantId` üzerinden fiyat manipülasyonu: sepete ekleme ve checkout'un **fiyatı istemciden
  ASLA** almadığını doğrula (mevcut checkout yorumundaki değişmez).
- Kargo bedelinin istemciden gelmediğini (yalnızca `SiteSettings`'ten türediğini) doğrula.

### 9.8 compliance-agent
- §7'nin madde madde imzası; kategori/ürün/mağaza adlarında marka çakışması taraması.
- Yasal yer tutucu sayfaların gövdesinde **gerçek sözleşme metni olmadığını** doğrula (§4.3).
- §4.5'in (sipariş üretilmemesi) kodda fiilen doğru olduğunu doğrula: importer'da
  `order`/`orderItem`/`user` yazan HİÇBİR çağrı bulunmamalı.

### 9.9 qa-agent
`frontend/tests/e2e/` altında:
1. PDP: renk seçimi görseli+fiyatı değiştiriyor; stoksuz beden üstü çizili ve seçilemiyor.
2. PDP: düşük stokta "Son N ürün!" görünüyor; stok yüksekken görünmüyor.
3. **Sepet dedupe (regresyon, §1.4):** varyasyonsuz aynı ürünü iki kez ekle → TEK satır,
   miktar 2. Aynı ürünün İKİ FARKLI varyasyonu → İKİ satır.
4. PDF: döküman kartından indirme 200 + `content-type: application/pdf` +
   `content-disposition: attachment`.
5. Kargo: eşik altındayken kargo satırı > 0 ve "son X TL" metni doğru; eşiğe ulaşınca kargo
   **0** ve toplam ara toplama eşit; `shippingFlatFeeCents = null` iken kargo arayüzü HİÇ
   görünmüyor (regresyon).
6. Sepet çekmecesi: sepete ekleme çekmeceyi açıyor, miktar güncelleme toplamı değiştiriyor.
7. Şablon: ADMIN olarak `ecommerce-pro` uygula → `201`; 8 ürün + 4 kategori + varyasyonlar +
   dökümanlar oluştu; 4 yasal sayfa `isLegalDocument: true` ile oluştu ve **hiçbir `Order`
   satırı YARATILMADI** (§4.5 kabul kriteri).
8. Şablon: `products` modülü kapalıyken import → `201` + ilgili `warnings[]`.
9. RBAC/idempotency/`confirm`/`force`/hız sınırı testleri [DTI] §12'den **miras alınır**,
   yeniden yazılmaz — yalnızca yeni `templateKey` ile parametrize edilir.

### 9.10 code-quality-agent / documentation-agent / devops-agent
- code-quality: lint/format, yeni bağımlılık YOK (PDF/PNG üretimi bağımlılıksız), `any` yok.
- documentation: `ARCHITECTURE.md` §10.9.2'ye varyasyon/döküman/kargo bölümleri, `README`,
  `CHANGELOG.md`.
- devops: `assets/ecommerce-pro/**` (PNG **ve PDF**) `dist/`e kopyalanıyor ve Docker imajında
  mevcut — [DTI] §13'teki kopyalama adımı PDF uzantısını da kapsamalı.

---

## 10. Definition of Done

- [ ] Migration uygulandı; `CartItem` unique değişimi ve §1.4 uyarısı migration'da yorumlu (db-agent)
- [ ] Variant/document uçları + sepet/kargo DTO'ları openapi ile BİREBİR (backend-agent)
- [ ] Fiyat/kargo matematiği TEK yardımcıda; üç tüketici de onu çağırıyor (backend-agent)
- [ ] Checkout kargoyu tahsil ediyor; webhook varyasyon stoğunu Serializable içinde düşürüyor (integration-agent)
- [ ] PDF yükleme/servis politikası (§2.2, 6 madde) uygulandı ve denetlendi (backend-agent → security-agent)
- [ ] `ecommerce-pro` tanımı Zod + token testlerinden geçiyor; tavanlar (§4.6) zorlanıyor (backend-agent + qa-agent)
- [ ] PDP/sepet çekmecesi/kargo çubuğu; hiçbir bileşen `templateKey` bilmiyor (§5) (frontend-agent)
- [ ] Tasarım tokenleri + WCAG AA doğrulandı (ui-designer)
- [ ] Telif/marka/PII kontrol listesi (§7) imzalandı; sahte sipariş üretilmediği kodda doğrulandı (compliance-agent)
- [ ] E2E 1-9 yeşil (qa-agent)
- [ ] ARCHITECTURE.md + CHANGELOG (documentation-agent) — CI yeşil, varlıklar imajda (devops-agent)
