# Architect — Kapsam Kararı: Müşteri & E-Ticaret Alanı (Customer Portal)

Durum: v1 (2026-08-24) · Sahibi: architect · **BAĞLAYICI**
Etkilenen ajanlar: db-agent → backend-agent → ui-designer → frontend-agent → security-agent → qa-agent → documentation-agent
İlgili kararlar: `ARCHITECTURE.md` §10.9 (modül yönetimi), §10.9.3 (sepet/checkout), **§10.21** (5 kademeli RBAC),
`.claude/architect-scope-rbac-5-tier.md` §7.4/§8.3, `docs/architecture/openapi.yaml` (tek doğru kaynak).

> Bu doküman, iş isteğini MEVCUT mimariyle uzlaştırır. İstek metniyle bu doküman çelişirse **bu doküman
> geçerlidir**; gerekçesi her maddede yazılıdır. Kod ile bu doküman çelişirse **openapi.yaml** hakemdir.

---

## 0. Yönetici özeti — bir bakışta 10 karar

| # | Konu | KARAR | İstekten sapma? |
|---|---|---|---|
| 1 | API namespace | `/api/customer/*` **AÇILMAZ** — mevcut `/users/me/*` deseni genişletilir | ✔ Sapma (gerekçe §1) |
| 2 | Sipariş uçları | `GET /users/me/orders` (mevcut) + **yeni** `GET /users/me/orders/{orderId}` | Uyumlu |
| 3 | Adres defteri | `GET/POST /users/me/addresses`, `PATCH/DELETE /users/me/addresses/{addressId}` (PUT DEĞİL) | Kısmi sapma (§2.2) |
| 4 | Favoriler | `GET/POST /users/me/wishlist`, `DELETE /users/me/wishlist/{productId}` | Uyumlu |
| 5 | Modül guard'ı — favoriler | `requireModuleEnabled("products")` → modül kapalıyken **404** | Uyumlu |
| 6 | Modül guard'ı — **siparişler** | Guard **UYGULANMAZ**; API açık kalır, kapanma YALNIZCA ön yüzdedir | ⚠ **Sapma — §3, risk ADR** |
| 7 | Rota yapısı | `/hesabim` sekmeli kabuk + alt rotalar; `/hesabim` → `/hesabim/profil` | Uyumlu |
| 8 | Eski `/siparislerim` | Silinmez → **kalıcı yönlendirme** `/hesabim/siparislerim` | İstekte yoktu, eklendi |
| 9 | Şema | Yeni `Address`, `WishlistItem`; `Order`'a `trackingNumber`+3 alan; `OrderStatus`'a `SHIPPED` | Genişletme (§5, §6) |
| 10 | Giriş yönlendirmesi | `/giris?redirect=` **YOK** → mevcut `/login?next=<pathname>` kullanılır | ⚠ Sapma (§7.2) |

---

## 1. KARAR: Yeni `/api/customer/*` namespace'i AÇILMAZ

Tüm müşteri paneli uçları **`/users/me/*`** altında yaşar (nihai yol: `/api/v1/users/me/...`).

**Gerekçe (bağlayıcı):**

1. **§10.21.7 ile doğrudan çelişirdi.** O bölümün bağlayıcı cümlesi: *"CUSTOMER ile USER'ın API'de farkı
   YOKTUR… Rol guard'ı EKLENMEYECEKTİR — gerçek kontrol sahipliktir (`Order.siteUserId = me`)."*
   `/api/customer/*` adı, adının gereği bir **rol kapısı** vaat eder. O kapıyı koyarsak, `USER → CUSTOMER`
   terfisi Stripe webhook'uyla geldiği için terfi gecikirse kullanıcı **kendi** siparişini/adresini göremez;
   koymazsak namespace adı yalan söyler ve bir sonraki ajan "burada bir rol guard'ı eksik" diye ekler
   (drift kaynağı).
2. **Sahiplik zaten tek yetkilendirme eksenidir.** Adres ve favori de tıpkı sipariş gibi `userId = me`
   filtresiyle korunur — CUSTOMER'a özel bir kaynak DEĞİLDİR (bir ADMIN de adres kaydedebilir).
3. **Tutarlılık:** `GET /users/me/orders`, `GET/PATCH /users/me`, `POST /users/me/change-password` ZATEN
   üretimde. Dördüncü bir "ben" yüzeyi açmak, aynı kavram için ikinci bir yol üretir; `frontend/src/lib/api/users.ts`
   bölünür, openapi'de `Users` tag'i ikiye ayrılır.
4. **Maliyet:** yeni bir prefix, `app.ts` kaydı, yeni bir plugin scope'u ve panel-guard route-tablosu testinin
   (`admin-panel-guard-route-table.test.ts` deseni) yeni bir dal öğrenmesi demektir. Karşılığında kazanılan tek
   şey estetik.

**Reddedilen alternatif:** `/api/customer/*` + `requireSiteRole("CUSTOMER")` → §10.21.7 ihlali, terfi yarışı riski.
**Reddedilen alternatif:** `/api/customer/*` + rol guard'sız → aynı şeyin iki adı (`/users/me/orders` ve
`/api/customer/orders`), kaçınılmaz drift.

---

## 2. Kontrat (openapi.yaml deltası) — BAĞLAYICI

Zarf: mevcut `ApiSuccessEnvelope` / `ApiErrorEnvelope`. Hata kodları `lib/errors.ts` ile aynı:
`UNAUTHORIZED(401)`, `FORBIDDEN(403)`, `NOT_FOUND(404)`, `CONFLICT(409)`, `VALIDATION_ERROR(422)`.
Tümü `Users` tag'i altına, `authenticate` preHandler'lı `usersRoutes` içine yazılır.

### 2.1 Siparişler

| Uç | Yetki | Notlar |
|---|---|---|
| `GET /users/me/orders` | authenticated | **MEVCUT.** Rol guard'ı YOK, sahiplik filtresi. Modül guard'ı YOK (§3) |
| `GET /users/me/orders/{orderId}` | authenticated | **YENİ.** `where: { id, siteUserId: me }` → bulunamazsa **404** (403 DEĞİL: başkasının sipariş id'sinin VARLIĞI sızdırılmaz). `items` dahil, `customerEmail` MASKELENMEZ, `trackingNumber`/`shippingCarrier` dahil |

`GET /users/me/orders` sorgu parametreleri: `cursor`, `limit`, `status` (kod zaten `status`'ü destekliyor,
openapi'de eksik — §10.1 drift maddesi).

### 2.2 Adres defteri

| Uç | Başarı | Hatalar |
|---|---|---|
| `GET /users/me/addresses` | 200, `Address[]` (sayfalama YOK — üst sınır 20, §5.1) | 401 |
| `POST /users/me/addresses` | 201, `Address` | 401, 409 (20 adres sınırı), 422 |
| `PATCH /users/me/addresses/{addressId}` | 200, `Address` | 401, 404 (sahibi değilse de 404), 422 |
| `DELETE /users/me/addresses/{addressId}` | 204 | 401, 404 |

**`PUT` yerine `PATCH` (sapma, bilinçli):** proje genelinde tekil kaynak güncellemesi `PATCH`'tir
(`PATCH /users/me`, `PATCH /admin/users/{id}/role`, `PATCH /admin/orders/{id}/status`); `PUT` yalnızca
tüm-koleksiyonu-değiştiren `PUT /admin/navigation` için kullanılıyor. Tek bir adres için `PUT` bu ayrımı bozar.

**Varsayılan adres:** `isDefault: true` gönderen bir `POST`/`PATCH`, aynı kullanıcının diğer adreslerini tek
transaction içinde `isDefault: false` yapar (uygulama katmanında; kısmi unique index KULLANILMAZ). İlk adres
otomatik varsayılandır. Varsayılan adres silinirse `seq` en küçük kalan adres varsayılan olur.

### 2.3 Favoriler (wishlist)

| Uç | Başarı | Hatalar |
|---|---|---|
| `GET /users/me/wishlist` | 200, `WishlistItem[]` (ürün DTO'su gömülü) | 401, **404 (modül kapalı)** |
| `POST /users/me/wishlist` (`{ productId }`) | 201, `WishlistItem`; zaten varsa **200** (idempotent, 409 DEĞİL — kalp ikonuna iki kez basmak hata değildir) | 401, 404 (modül kapalı **veya** ürün yok/yayında değil), 409 (100 kayıt sınırı), 422 |
| `DELETE /users/me/wishlist/{productId}` | 204 (kayıt yoksa da 204 — idempotent) | 401, 404 (modül kapalı) |

`GET` yanıtı yalnızca **görünür** ürünleri döner (`deletedAt: null`, `status: PUBLISHED`); silinmiş/taslak
ürünün satırı DB'de kalır ama listede/sayaçta görünmez (yeniden yayınlanırsa favori geri gelir).

`DELETE` yolunun anahtarı `productId`'dir (`wishlistItemId` DEĞİL): ön yüz ürün kartında elinde `productId`
tutar, ekstra bir eşleme tablosu taşımak zorunda kalmaz; `@@unique([userId, productId])` bunu tekil kılar.

### 2.4 Admin tarafı — kargo bilgisi

`PATCH /admin/orders/{orderId}/status` gövdesi genişler:
`{ status, trackingNumber?, shippingCarrier? }`. `status: SHIPPED` iken `trackingNumber` **ZORUNLUDUR**
(eksikse 422). Ayrı bir `/shipping` ucu AÇILMAZ — durum geçişi, kargo bilgisi, audit kaydı ve
`ORDER_STATUS_CHANGED` webhook'u tek atomik işlemde kalsın diye (bkz. `orders.routes.ts:97-136`).

`buildWebhookOrderPayload` çıktısına `trackingNumber` + `shippingCarrier` eklenir (giden webhook sözleşmesi
değişikliği → `documentation-agent` CHANGELOG'a yazar; integration-agent'a bilgi verilir).

---

## 3. ⚠ KARAR + RİSK KAYDI: `products` modülü kapalıyken sipariş geçmişi

**Karar:** `GET /users/me/orders` ve `GET /users/me/orders/{orderId}` uçlarına `requireModuleEnabled("products")`
**EKLENMEZ.** Modül kapatıldığında kullanıcının gördüğü davranış (sekme ve ikonların kaybolması, rotanın
yönlenmesi) **istekte tarif edildiği gibi birebir uygulanır** — ama yalnızca ön yüz katmanında.

**Uygulanan guard matrisi (bağlayıcı):**

| Uç | `products` kapalıyken |
|---|---|
| `/products/*`, `/cart/*`, `/checkout/*`, `/public/products/*` | 404 (MEVCUT davranış, değişmez) |
| `GET/POST/DELETE /users/me/wishlist*` | **404** (guard eklenir) |
| `GET /users/me/orders`, `GET /users/me/orders/{orderId}` | **200 (açık kalır)** |
| `GET/PATCH /users/me`, `/users/me/addresses*` | 200 (açık, "her zaman açık" sekmeler) |
| `/admin/orders/*`, `/admin/products/*` | 200 (MEVCUT karar: admin uçları modülden BAĞIMSIZ) |

**Gerekçe:**

1. **Ödenmiş sipariş bir "modül içeriği" değil, bir sözleşme kaydıdır.** `schema.prisma:1609-1632`'deki
   compliance-agent kararı bu kayıtları KVKK m.5/2-c (sözleşmenin ifası) ve m.5/2-ç (VUK saklama yükümlülüğü)
   kapsamında **saklanması zorunlu** olarak tanımlar. Parasını ödemiş bir müşterinin fatura/sipariş dökümüne
   erişimini bir site ayarının kapatması, tüketici mevzuatı ve güven açısından **erişilebilirlik yönünde** bir
   risktir (KVKK'nın tersi yönde bir sorun).
2. **Modül anahtarı bir SUNUM kill switch'idir.** Aynı ilke `ARCHITECTURE.md` §10.12.5'te bakım modu için
   ("SUNUM anahtarıdır, GÜVENLİK kontrolü DEĞİLDİR") ve admin uçlarının modülden bağımsız tutulmasında
   ("veri korunumu") zaten yazılıdır. Sipariş geçmişini kapatmak bu ilkeden sapmadır.
3. **Favori ile sipariş aynı sınıf veri değildir.** Favori: türetilmiş, kaybı zararsız, tamamen katalog
   bağımlı → kapanır. Sipariş: mali kayıt → kapanmaz.
4. **Kullanıcının gördüğü sonuç istekle aynıdır.** Sekmeler ve sepet/favori ikonları kaybolur,
   `/hesabim/siparislerim` → `/hesabim/profil`'e yönlenir. Fark yalnızca "URL'i elle yazan/bookmark'lı bir
   müşteri kendi faturasına hâlâ ulaşabilir" noktasındadır — ki 1. maddede istenen şey budur.

**Bu kararın maliyeti (açıkça kabul edilir):** modül kapalıyken `/api/v1/users/me/orders` istemek hâlâ veri
döndürür. Bu, "kapalı modülün varlığını sızdırma" ilkesinin dar bir ihlalidir; sızan bilgi çağıranın
**kendi** geçmişidir, üçüncü bir tarafa hiçbir şey açılmaz.

**Geri alma yolu (tek satır, compliance onayına bağlı):** site sahibi sert kapanma isterse
`users.routes.ts` içinde `/me/orders` ve `/me/orders/:orderId` route'larına
`preHandler: requireModuleEnabled("products")` eklenir; başka hiçbir yer değişmez. Bu değişiklik
**compliance-agent onayı OLMADAN yapılmayacaktır** ve yapılırsa e-posta ile fatura erişimi için alternatif
bir kanal (ör. admin'in manuel gönderimi) belgelenmelidir.
**Takip kalemi:** `chore/compliance-order-history-availability` — compliance-agent, KVKK/tüketici mevzuatı
açısından bu kararı teyit eder; itiraz ederse doküman güncellenir, kod değil (kod zaten muhafazakâr taraftadır).

---

## 4. KARAR: Ön yüz rota yapısı

### 4.1 Yeni ağaç

```
app/[lang]/(site)/hesabim/
  layout.tsx            ← YENİ: auth guard + modül farkındalığı + sol sekme menüsü (tek yer)
  page.tsx              ← redirect("/hesabim/profil")  (mevcut 759 satırlık içerik BURADAN TAŞINIR)
  profil/page.tsx       ← Profil + Şifre + 2FA + Aktif Oturumlar   (her zaman açık)
  adreslerim/page.tsx   ← YENİ                                       (her zaman açık)
  siparislerim/page.tsx ← eski (site)/siparislerim içeriği + detay linki
  siparislerim/[orderId]/page.tsx ← YENİ: sipariş/fatura detayı, kargo takip no
  favorilerim/page.tsx  ← YENİ: kart listesi + tek tık sepete ekle
app/[lang]/(site)/siparislerim/page.tsx  ← İÇERİĞİ BOŞALTILIR: kalıcı yönlendirme
```

### 4.2 Eski `/siparislerim`: silinmez, **kalıcı yönlendirilir**

`permanentRedirect("/hesabim/siparislerim")` (Server Component; locale prefix `withLocalePrefix` ile korunur).
Gerekçe: rota canlıdır, `site-header.tsx`'te bağlantısı vardır, kullanıcı bookmark'lamış olabilir ve
`ARCHITECTURE.md` §10.21.9 onu resmî bir rota olarak ilan etmiştir. Sessizce 404'e düşürmek geriye dönük
uyumluluğu kırar. Dosya, kalıcı yönlendirme kalıntısı olarak en az bir sürüm boyunca durur
(temizlik takip kalemi: `chore/drop-legacy-siparislerim-route`).

### 4.3 Sekme menüsü (sol) — görünürlük kuralı

| Sekme | Yol | Görünürlük |
|---|---|---|
| Profilim & Güvenlik | `/hesabim/profil` | Her zaman (5 rol) |
| Adreslerim | `/hesabim/adreslerim` | Her zaman (5 rol) |
| Siparişlerim | `/hesabim/siparislerim` | `products` **açık** iken (rol şartı YOK — §10.21.7) |
| Favori Ürünlerim | `/hesabim/favorilerim` | `products` **açık** iken |

- Modül durumu **sunucuda** `isModuleEnabledServer("products")` ile okunur (`(site)/products/layout.tsx` ile
  AYNI desen) ve `hesabim/layout.tsx`'te çözülür — istemcide flaş/yanıp sönme olmaz.
- Modül kapalıyken `/hesabim/siparislerim`, `/hesabim/siparislerim/[orderId]` ve `/hesabim/favorilerim`
  → `redirect("/hesabim/profil")` (404 DEĞİL: kullanıcı kendi panelinin içindedir, "sayfa yok" yerine
  "bu bölüm şu an kapalı" davranışı doğrudur; yönlendirme istekte de böyle tarif edilmiştir).
- Sekme görünürlüğü bir GÜVENLİK önlemi DEĞİLDİR (§10.21.9 ile aynı cümle).
- `role === "CUSTOMER"` koşulu sekmelerde KULLANILMAZ. Bir `USER` siparişler sekmesini görür ve boş durum alır —
  §10.21.7'nin terfi-gecikmesi gerekçesi burada da geçerlidir.

### 4.4 Üst bar (site-header)

`SiteHeader` yeni bir `productsModuleEnabled: boolean` prop'u alır (`(site)/layout.tsx` sunucuda hesaplar).
`false` iken: sepet ikonu, favori ikonu ve hesap menüsündeki "Siparişlerim" öğesi **render EDİLMEZ**.
`CartProvider` de o durumda ağaca eklenmez (kapalı modülde `/cart` uçları 404 döner → gereksiz hata gürültüsü).
Hesap menüsündeki "Siparişlerim" öğesi `/hesabim/siparislerim`'e işaret eder; `role === "CUSTOMER"` koşulu
KALDIRILIR, yerine modül koşulu gelir.

**Yeni:** favori ikonu (kalp) — yalnızca modül açık **ve** oturum açıkken; `/hesabim/favorilerim`'e gider.

---

## 5. KARAR: Prisma şeması (db-agent — TEK SAHİP)

### 5.1 `Address`

```prisma
/// Müşteri adres defteri — SALT müşteri profiline aittir. `Order` ile FK ile BAĞLANMAZ:
/// sipariş anındaki adres, `OrderItem`'daki fiyat/başlık snapshot mantığıyla aynı gerekçeyle
/// (adres sonradan değişse/silinse bile sipariş bozulmasın) ileride `Order`'a DENORMALİZE
/// kopyalanacaktır — v1'de checkout adresi Stripe tarafından toplanır, bu model onu ETKİLEMEZ.
model Address {
  id           String   @id @default(uuid())
  seq          Int      @unique @default(autoincrement())
  userId       String
  user         User     @relation("AddressOwner", fields: [userId], references: [id], onDelete: Cascade)
  title        String   // "Ev", "İş" — kullanıcı etiketi
  fullName     String
  phone        String
  country      String   @default("TR")
  city         String
  district     String
  neighborhood String?
  addressLine1 String
  addressLine2 String?
  postalCode   String?
  isDefault    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId])
  @@map("addresses")
}
```

- **`onDelete: Cascade` (bilinçli, `Order.siteUser`'ın `SetNull`'undan FARKLI):** adres saf kişisel veridir,
  muhasebe değeri YOKTUR; kullanıcı kalıcı silindiğinde birlikte gitmesi KVKK veri minimizasyonuyla uyumludur.
  Sipariş ise mali kayıttır, bu yüzden orada `SetNull` doğrudur. Bu asimetri kasıtlıdır.
- **Sınır:** kullanıcı başına en fazla **20** adres (aşımda 409). Sayfalama gerektirmez.
- **PII:** `fullName`, `phone`, adres satırları doğrudan kişisel veridir. `schema.prisma`'daki `Order` notunun
  "yeni bir alan eklenmeden önce compliance-agent'a danışılmalı" maddesi gereği bu model üzerine
  **compliance-agent'ın bilgilendirilmesi zorunludur** (bu iş akışında compliance-agent yoktu → takip kalemi
  `chore/compliance-address-book-pii`). Log/audit'e adres alanları YAZILMAZ.
- `User` modeline karşı-ilişki: `addresses Address[] @relation("AddressOwner")`.

### 5.2 `WishlistItem` (tek tablo — `Wishlist` kapsayıcısı YOK)

```prisma
model WishlistItem {
  id        String   @id @default(uuid())
  seq       Int      @unique @default(autoincrement())
  userId    String
  user      User     @relation("WishlistOwner", fields: [userId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation("WishlistItemProduct", fields: [productId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userId, productId])
  @@index([productId])
  @@map("wishlist_items")
}
```

- **Neden `Cart`/`CartItem` gibi iki tablo DEĞİL:** `Cart`'ın ayrı bir kapsayıcıya ihtiyacı `tokenHash`
  (misafir sahipliği), `currency` ve `expiresAt` yüzündendir. Favori **oturum gerektirir**, süresi dolmaz ve
  para taşımaz → sahibi doğrudan `User`'dır, boş bir kapsayıcı tablo eklemek ölü şema olurdu.
- `onDelete: Cascade` (ürün silinince favori satırı gider) — `OrderItem`'ın `SetNull` + snapshot deseninden
  FARKLIDIR ve bilinçlidir: favori bir işaretçidir, tarihsel kanıt değildir, snapshot ALINMAZ.
- **Sınır:** kullanıcı başına en fazla **100** favori (aşımda 409).
- `User`: `wishlistItems WishlistItem[] @relation("WishlistOwner")`; `Product`: `wishlistItems WishlistItem[] @relation("WishlistItemProduct")`.

### 5.3 `Order` — kargo alanları

```prisma
  trackingNumber  String?    // kargo takip numarası — SHIPPED'a geçişte zorunlu (uygulama katmanı)
  shippingCarrier String?    // "Yurtiçi Kargo" vb. serbest metin; enum v1'de AÇILMAZ
  shippedAt       DateTime?  // `paidAt` ile AYNI desen
  deliveredAt     DateTime?
```

`shippingCarrier` için enum açılmaz (kargo firması listesi site sahibine göre değişir, migration maliyeti
gereksizdir; ileride `SiteModule.settings` altında bir liste tanımlanabilir).

### 5.4 Migration sıralaması (BAĞLAYICI — üç ayrı migration)

1. `add_order_status_shipped` — **yalnızca** `ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';`
   Tek başına ve İLK gönderilir: PostgreSQL'de yeni enum değeri, onu **ekleyen transaction içinde**
   kullanılamaz. §10.21.2'deki `CREATE TYPE`+cast+`DROP`+`RENAME` deseni burada GEREKMEZ — o desen bir değer
   KALDIRILDIĞI için zorunluydu; burada saf bir EKLEMEDİR (geri alınamaz olması kabul edilir).
2. `add_order_shipping_fields` — `Order`'a 4 nullable kolon. Veri geçişi yok, mevcut satırlar `NULL`.
3. `add_address_and_wishlist` — iki yeni tablo + indeksler + `User`/`Product` karşı-ilişkileri.

Hiçbir migration mevcut veriyi yeniden yazmaz; hepsi geri alınabilir/ileri uyumludur (1 hariç).

---

## 6. KARAR: Sipariş durumu terminolojisi (tek sözlük — admin + storefront AYNI)

`OrderStatus` enum'ına **yalnızca `SHIPPED`** eklenir. `DELIVERED` **eklenmez**: `FULFILLED` zaten terminal
başarı durumudur; ikisini birlikte tutmak "hangisi bitmiş?" belirsizliği ve ölü durum üretir. Bunun yerine
`FULFILLED`'ın **etiketi** netleşir.

| Enum | Etiket (TR — tek doğru kaynak `frontend/src/lib/order-status.ts`) | Ton |
|---|---|---|
| `PENDING` | Ödeme Bekleniyor *(eski: "Beklemede")* | warning |
| `PAID` | **Hazırlanıyor** *(eski: "Ödendi")* | info/warning |
| `SHIPPED` | **Kargoda** | info |
| `FULFILLED` | **Teslim Edildi** *(eski: "Tamamlandı")* | success |
| `FAILED` | Başarısız | danger |
| `CANCELLED` | İptal Edildi | neutral |
| `EXPIRED` | Süresi Doldu | neutral |
| `REFUNDED` | İade Edildi | neutral |

Etiketler admin ve storefront'ta AYNIDIR (CLAUDE.md "ortak terminoloji" kuralı) — iki sözlük tutulmaz.

**Geçiş tablosu** (`ALLOWED_TRANSITIONS` artık `Record<OrderStatus, OrderStatus[]>` olur):

| Kaynak | İzinli hedefler |
|---|---|
| `PENDING` | `CANCELLED` |
| `PAID` | `SHIPPED`, `FULFILLED` |
| `SHIPPED` | `FULFILLED` |
| diğerleri | — (409) |

`PAID → FULFILLED` KORUNUR (dijital/kargosuz ürün akışı kırılmasın). `REFUNDABLE_STATUSES`'a `SHIPPED` eklenir.

**"Fatura detayı" kapsamı:** `/hesabim/siparislerim/[orderId]` sipariş dökümünü gösterir (kalemler, birim
fiyat, ara toplam, indirim, KDV ayrıştırması, toplam, ödeme tarihi, kargo firması + takip no). **PDF fatura /
e-Arşiv üretimi KAPSAM DIŞIDIR** (takip: `feature/order-invoice-pdf`).

---

## 7. KARAR: Erişim guard'ları

### 7.1 CUSTOMER → `/admin/*`

- **Backend: değişiklik GEREKMEZ.** `requirePanelAccess()` (= `requireSiteRole(...ROLES_PANEL)`) her `/admin/*`
  plugin scope'unda kayıtlıdır; `CUSTOMER`/`USER` 403 + `FORBIDDEN` audit alır. `admin-panel-guard-route-table.test.ts`
  bunu zaten zorluyor. **Doğrulandı.**
- **Frontend: GERÇEK BİR AÇIK VAR.** `frontend/src/app/admin/layout.tsx` yalnızca `status === "unauthenticated"`
  durumunu ele alıyor; **rol kontrolü YOK.** Giriş yapmış bir CUSTOMER `/admin`'e giderse admin kabuğu
  render edilir ve her panel isteği 403 döner (kırık ekran + gürültü).
  **Düzeltme (frontend-agent, zorunlu):** `status === "authenticated"` ve rol `ADMIN|MANAGER|EDITOR` değilse
  → `router.replace("/hesabim/profil")`; yönlendirme tamamlanana kadar EDITOR dashboard'unda kullanılan
  `redirectingEditorFromDashboard` deseniyle **hiçbir alt bileşen mount edilmez**.
  Bu, sunucu kararının yerine geçmez (derinlemesine savunma).

### 7.2 Giriş yapmamış kullanıcı → `/hesabim/*`

- **`/giris?redirect=` rotası bu projede YOKTUR.** Giriş sayfası `app/(auth)/login` ve proje genelinde
  kullanılan sözleşme `?next=<pathname>`'dir (7 çağrı yeri: `admin/layout.tsx`, `dashboard/layout.tsx`,
  `site-header.tsx`, `hesabim/page.tsx`, `siparislerim/page.tsx`, `invitations/.../accept`).
  **Karar:** `/login?next=${encodeURIComponent(pathname)}` KULLANILIR. İkinci bir giriş yüzeyi/parametre adı
  İCAT EDİLMEZ. (Türkçe `/giris` alias'ı istenirse ayrı bir iş: `feature/turkish-auth-routes` — `proxy.ts`
  matcher'ı ve tüm çağrı yerleri birlikte değişmelidir.)
- **Guard'ın yeri:** `hesabim/layout.tsx` (tek yer). `status === "unauthenticated"` → `router.replace("/login?next=…")`.
  Mevcut sayfa-içi "Giriş yapın" kartları KALDIRILIR (istek "yönlendirilsin" diyor; ayrıca 2 sayfada
  kopyalanmış mantık tekilleşir). `status === "loading"` iken mevcut `Spinner` deseni korunur.

---

## 8. Ajan görev dağılımı ve sıra (bağlayıcı)

| # | Ajan | İş | Dosyalar |
|---|---|---|---|
| 1 | **db-agent** | §5'teki 3 migration + şema; `User`/`Product` karşı-ilişkileri | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` |
| 2 | **backend-agent** | §2 uçları (adres, favori, sipariş detayı), §2.4 admin kargo, §6 geçiş tablosu + etiket kaynağı, DTO/mapper/zod şemaları, unit test | `modules/users/*`, `modules/orders/*`, `schemas/entities.ts`, `mappers.ts`, `lib/webhook-order-payload.ts` |
| 2b | **architect (ben)** | Kontratın openapi.yaml'a işlenmesi — backend-agent PR'ında **benim onayımla** | `docs/architecture/openapi.yaml` |
| 3 | **ui-designer** | Sol sekme menüsü paterni (dikey liste / mobilde yatay kaydırma), adres kartı, favori kartı, sipariş durumu rozet tonları (§6 tablosu), boş durumlar | `.claude/design-notes-customer-portal.md` |
| 4 | **frontend-agent** | §4 rota ağacı + `hesabim/layout.tsx` guard'ı, §4.4 header prop'u, §7.1 admin layout rol guard'ı, API istemcisi | `app/[lang]/(site)/hesabim/**`, `app/[lang]/(site)/siparislerim/page.tsx`, `components/site/site-header.tsx`, `app/admin/layout.tsx`, `lib/api/users.ts`, `lib/order-status.ts` |
| 5 | **security-agent** | Sahiplik filtresi denetimi (IDOR: adres/sipariş/favori id'leriyle çapraz erişim), §3 kararının gözden geçirilmesi, PII log sızıntısı | denetim raporu |
| 6 | **qa-agent** | §9 test matrisi | `backend/tests/integration/customer-portal.test.ts`, `frontend/tests/e2e/customer-portal-module-toggle.spec.ts` |
| 7 | **documentation-agent** | CHANGELOG + `docs/architecture/ARCHITECTURE.md` §10.9/§10.21 çapraz referansları | dokümanlar |

**Not (frontend-agent):** `frontend/AGENTS.md` gereği Next.js 16 davranışları için önce
`node_modules/next/dist/docs/` okunacaktır (`redirect`/`permanentRedirect`, layout içinde veri çekme).

**Branş/commit:** `feature/customer-portal` · Conventional Commits (`feat(customer-portal): …`,
`feat(db): …`, `fix(admin): …`). Tek bir büyük commit YOK — ajan başına ayrı commit.

---

## 9. qa-agent test matrisi (BAĞLAYICI — modül açık/kapalı ikili doğrulama)

**Backend (integration):**

| # | Senaryo | Beklenen |
|---|---|---|
| 1 | `products` AÇIK, CUSTOMER: adres CRUD tam turu | 201/200/200/204 |
| 2 | Başkasının `addressId`'siyle `PATCH`/`DELETE` | **404** (403 değil) |
| 3 | 21. adres | 409 |
| 4 | `products` AÇIK: favori ekle/tekrar ekle/sil/tekrar sil | 201 / 200 / 204 / 204 |
| 5 | `products` **KAPALI**: `GET|POST|DELETE /users/me/wishlist*` | **404** |
| 6 | `products` **KAPALI**: `GET /users/me/orders` ve `/orders/{id}` | **200** (§3 — bu test kararın bekçisidir) |
| 7 | `products` KAPALI: `GET/PATCH /users/me`, `/users/me/addresses` | 200 |
| 8 | Başkasının `orderId`'si ile sipariş detayı | 404 |
| 9 | `USER` rolüyle tüm uçlar | 403 DEĞİL — boş liste / normal davranış |
| 10 | CUSTOMER ile herhangi bir `/admin/*` ucu | 403 + `FORBIDDEN` audit |
| 11 | `PATCH /admin/orders/{id}/status` → `SHIPPED` (takip no'suz) | 422 |
| 12 | `PAID→SHIPPED→FULFILLED` zinciri + `SHIPPED→PAID` denemesi | 200/200 + 409 |
| 13 | Favori listesinde soft-delete edilmiş/taslak ürün | listede görünmez, satır DB'de kalır |

**Frontend (e2e):**

| # | Senaryo | Beklenen |
|---|---|---|
| 14 | Modül AÇIK, CUSTOMER, `/hesabim` | `/hesabim/profil`'e yönlenir, 4 sekme görünür |
| 15 | Modül KAPALI | Siparişlerim/Favorilerim sekmeleri YOK; header'da sepet+favori ikonu YOK |
| 16 | Modül KAPALI, `/hesabim/siparislerim`'e doğrudan git | `/hesabim/profil`'e yönlenir |
| 17 | Modül KAPALI, `/hesabim/favorilerim`'e doğrudan git | `/hesabim/profil`'e yönlenir |
| 18 | Oturumsuz `/hesabim/adreslerim` | `/login?next=%2Fhesabim%2Fadreslerim` |
| 19 | Eski `/siparislerim` | kalıcı yönlendirme → `/hesabim/siparislerim` |
| 20 | CUSTOMER ile `/admin` | `/hesabim/profil`'e yönlenir, admin kabuğu HİÇ render edilmez |
| 21 | Favori kartında "Sepete Ekle" | sepet rozeti +1, favori listede kalır |
| 22 | Sipariş detayında kargo takip no | `SHIPPED` siparişte görünür, `PAID`'de görünmez |

---

## 10. Mevcut kodda tespit edilen drift (bu iş kapsamında düzeltilecek)

1. **`GET /users/me/orders` sıralaması kontrata AYKIRI.** openapi.yaml:545 "**`seq desc`, en yeni önce**"
   diyor; `users.routes.ts:129` `orderBy: { seq: "asc" }` — müşteri en ESKİ siparişini ilk görüyor
   (`/admin/orders` de aynı şekilde `asc`). **Hakemlik: kontrat kazanır** → müşteri listesi `desc` olacak
   ve cursor mantığı buna göre (`seq: { lt: cursorSeq }`) düzeltilecektir. `/admin/orders` için aynı
   düzeltme önerilir; kontrat orada `desc` demiyorsa openapi güncellenir — backend-agent iki ucu birlikte
   raporlar, ben karar veririm.
2. **`status` sorgu parametresi** kodda var (`ListOrdersQuerySchema`), openapi'de `/users/me/orders`
   parametrelerinde yok → kontrata eklenecek.
3. **`app/admin/layout.tsx` rol guard'ı yok** → §7.1.
4. `ORDER_STATUS_LABELS` yorumu "Admin sipariş listesi/detayında" diyor; artık storefront da tüketiyor →
   yorum güncellenir (tek sözlük, §6).

---

## 11. Kapsam dışı (bilinçli)

- PDF/e-Arşiv fatura üretimi (`feature/order-invoice-pdf`).
- Adresin checkout'a bağlanması / `Order`'a adres snapshot'ı (`feature/checkout-address-from-book`) —
  v1'de adres yalnızca profil verisidir.
- Misafir siparişini hesaba bağlama (`feature/order-account-linking`, §10.21.10'dan devam).
- Favori paylaşımı/public wishlist, favoriden toplu sepete ekleme.
- Kargo firması entegrasyonu / otomatik takip durumu çekme — bir 3. parti entegrasyondur, gerekirse
  **integration-agent**'ın işidir; v1'de takip no elle girilir.
- Sipariş iptali/iade talebinin MÜŞTERİ tarafından başlatılması (bugün yalnızca admin `POST /:orderId/refund`).
- `/giris` Türkçe auth rotası (`feature/turkish-auth-routes`, §7.2).
- Bildirim (kargoya verildi e-postası) — **notification-agent** kapsamı, bu işte YOK; takip:
  `feature/order-shipped-notification`.
