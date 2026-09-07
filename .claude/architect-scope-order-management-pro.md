# Architect Scope — Sipariş Yönetimi Profesyonelleştirme (RBAC + ON_HOLD + İptal E-postası + Düzenleme Paneli)

> **Bu doküman BAĞLAYICIDIR.** Aşağıdaki kararlar `docs/architecture/openapi.yaml` ile birlikte
> tek doğru kaynaktır (single source of truth). Bir ajan bu dokümanla çelişen bir şey yapmak
> zorunda kaldığını düşünüyorsa **kod yazmadan önce architect'e eskale eder** (bkz.
> `.claude/CLAUDE.md` "Çakışma Çözümü").
>
> Bu doküman `.claude/architect-scope-customer-portal.md` §6'yı (sipariş durum modeli + geçiş
> tablosu) ve `.claude/architect-scope-rbac-5-tier.md` §5.3 satır 11'i (`orders` → "tümü: A, M")
> **REVİZE EDER**. O dokümanların ilgili satırları artık BURAYA yönlendirir; çelişki halinde bu
> doküman geçerlidir.

Branş: `feature/order-management-pro`
Commit: **TEK commit** (kullanıcı talebi) — `feat(orders): profesyonel sipariş yönetimi — ON_HOLD, ADMIN-only durum/düzenleme yetkisi, iptal e-postası ve aktivite günlüğü`

---

## 1. Kapsam

**İÇİNDE:**
- `OrderStatus` enum'ına **yalnızca `ON_HOLD`** eklenmesi (db-agent).
- `Order.cancellationReason` + `Order.adminNotes` kolonları (db-agent).
- `AuditLog` üzerine `@@index([targetType, targetId])` (db-agent) — sipariş bazlı aktivite okuması için.
- `EmailTemplatePurpose` enum'ına `ORDER_CANCELLATION` + seed'lenmiş sistem şablonu (notification-agent).
- `PATCH /admin/orders/{orderId}/status` genişlemesi: `ON_HOLD`/`PAID` hedefleri, `cancellationReason`,
  `sendCustomerEmail`, `confirmWithoutRefund` (backend-agent).
- YENİ `PATCH /admin/orders/{orderId}` — müşteri iletişim + teslimat/fatura adresi + `adminNotes`
  düzenleme ucu (backend-agent).
- YENİ `GET /admin/orders/{orderId}/activity` — sipariş bazlı aktivite günlüğü (backend-agent).
- Hedef-durum bazlı RBAC daraltması (§3.2) ve UI'da rol kapısı (backend-agent + frontend-agent).
- `/admin/orders/[orderId]` üst eylem çubuğu, iptal modalı, düzenleme modu, aktivite kartı
  (ui-designer + frontend-agent).
- Playwright e2e senaryoları (qa-agent).

**DIŞINDA (bu fazda YAPILMAZ — yapan ajan durur ve architect'e sorar):**
- **Mevcut `OrderStatus` değerlerinin yeniden adlandırılması** (`PENDING`→`PENDING_PAYMENT`,
  `PAID`→`CONFIRMED`, `FULFILLED`→`COMPLETED`). Gerekçe §3.1 — **REDDEDİLDİ**.
- **`SUPER_ADMIN` rolü eklemek.** Gerekçe §3.2 — mevcut 5 kademeli rol modeli değişmez.
- **Sipariş kalemi (ürün/adet/fiyat) düzenleme.** Gerekçe §3.6 — **REDDEDİLDİ**, kullanıcı isteğinin
  bu maddesi bilinçli olarak kapsam dışı bırakıldı.
- **Manuel "ödendi olarak işaretle" (`PENDING → PAID`) akışı.** Gerekçe §3.4 — açık madde (§8.1).
- `POST /admin/orders/{orderId}/refund` ucunun RBAC'ını değiştirmek (§8.2'de açık madde).
- Giden webhook payload'ını (`lib/webhook-order-payload.ts`) genişletmek — gerekçe §7.3.
- Sipariş kalemi bazlı kısmi iade (Stripe partial refund) — integration-agent alanı, ayrı faz.
- `cancellationReason`/`adminNotes` alanlarını müşteri yüzeyine (`/users/me/orders*`) açmak — §3.7.

---

## 2. Bugünkü durum (kod okunarak doğrulandı)

| Konu | Bugün | Sonra |
|---|---|---|
| `OrderStatus` | `PENDING, PAID, SHIPPED, FAILED, CANCELLED, EXPIRED, REFUNDED, FULFILLED` | **+ `ON_HOLD`** (tek yeni değer) |
| Geçiş tablosu | `PENDING→CANCELLED`, `PAID→SHIPPED\|FULFILLED`, `SHIPPED→FULFILLED` | §4.1 tablosu |
| `/admin/orders*` RBAC | Router hook: `requireSiteRole(...ROLES_ADMIN_MANAGER)` — TÜM uçlar | Okuma A+M, sevkiyat A+M, **istisnai/geri alınamaz A** (§3.2) |
| Roller | `ADMIN`, `MANAGER`, `EDITOR` (+ `CUSTOMER`, `USER`) — **`SUPER_ADMIN` YOK** | **DEĞİŞMEZ** |
| Aktivite günlüğü | `logAudit` + `AuditLog` + `GET /admin/logs` (yalnızca ADMIN) | Aynı mekanizma + sipariş bazlı okuma ucu (§5.4) |
| İptal e-postası | YOK | `EmailTemplatePurpose.ORDER_CANCELLATION` (§6) |
| `PAID` durumunun kaynağı | Stripe webhook (`handleOrderPaid`, stok düşer, `paidAt` yazılır) | **DEĞİŞMEZ** — §3.4 |
| İade | `POST /:orderId/refund` (gerçek Stripe iadesi, atomik claim + idempotencyKey) | **Davranış DEĞİŞMEZ**, yalnızca `ON_HOLD` iade edilebilir kaynaklara eklenir |
| Sipariş DTO'su | `toOrderDto` — hem `/admin/orders*` hem `/users/me/orders*` tarafından PAYLAŞILIR | Admin uçları AYRI `AdminOrder` DTO'suna geçer (§3.7) |

---

## 3. Mimari kararlar (gerekçeleriyle)

### 3.1 Enum YENİDEN ADLANDIRILMAZ — yalnızca `ON_HOLD` EKLENİR

Kullanıcının istediği yeni isimler mevcut değerlerle **kavramsal olarak birebir örtüşüyor**:

| Kullanıcının istediği | Mevcut değer | Görünen etiket (`frontend/src/lib/order-status.ts`) | Karar |
|---|---|---|---|
| `PENDING_PAYMENT` | `PENDING` | "Ödeme Bekleniyor" | KORUNUR |
| `CONFIRMED` (Onaylandı / Hazırlanıyor) | `PAID` | "Hazırlanıyor" | KORUNUR |
| `ON_HOLD` | — | — | **YENİ — TEK EKLENEN DEĞER** |
| `SHIPPED` | `SHIPPED` | "Kargoda" | KORUNUR |
| `COMPLETED` | `FULFILLED` | "Teslim Edildi" | KORUNUR |
| `CANCELLED` | `CANCELLED` | "İptal Edildi" | KORUNUR |
| `REFUNDED` | `REFUNDED` | "İade Edildi" | KORUNUR |
| — | `FAILED`, `EXPIRED` | "Başarısız", "Süresi Doldu" | KORUNUR (kullanıcı listesinde yok ama ödeme akışında ZORUNLU) |

**Yeniden adlandırmanın blast-radius'u (reddedilme gerekçesi):**
1. **Geri alınamaz veri migration'ı.** PostgreSQL'de enum değeri yeniden adlandırmak
   (`ALTER TYPE ... RENAME VALUE`) tek başına ucuzdur, ama `orders.status` üzerindeki TÜM tarihsel
   satırlar anlamını isimden alır; geri dönüş (rollback) bir başka veri migration'ı gerektirir.
2. **Dış API tüketicileri sessizce kırılır.** `WebhookEvent.ORDER_STATUS_CHANGED` payload'ı
   (`lib/webhook-order-payload.ts`) durumu **wire'da enum adıyla birebir** taşır (bkz.
   `schema.prisma::WebhookEvent` üstündeki bağlayıcı not). Aboneler `"PAID"` bekliyor; `"CONFIRMED"`
   göndermek kimseye hata vermeden entegrasyonları bozar. Aynı şey `public-api` ve `ExportJobType.REVENUE`
   raporları için de geçerlidir.
3. **Kod yüzeyi.** `ALLOWED_TRANSITIONS`, `REFUNDABLE_STATUSES`, `handleOrderPaid` (`status !== "PENDING"`
   idempotency kontrolü), `checkout`/`cart` akışları, `OrderStatusSchema`, `shared-types.ts`,
   frontend `types.ts` + iki ayrı sipariş ekranı, `tests/integration/webhook-order.test.ts` ve
   `frontend/tests/e2e/support/api.ts::createPendingOrderDirect` (ham SQL `'PENDING'` yazıyor).
4. **Kazanç sıfır.** Kullanıcının gerçekten istediği şey **görünen Türkçe etiketler**tir ve bunlar
   ZATEN doğru (yukarıdaki tablo). Enum adı iç bir tanımlayıcıdır; kullanıcı onu hiçbir ekranda görmez.

**Karar:** Mevcut 8 değer KORUNUR. `ON_HOLD` EKLENİR. Etiket sözlüğü (`frontend/src/lib/order-status.ts`)
**tek sözlük** olmaya devam eder (CLAUDE.md "ortak terminoloji"); `ON_HOLD: "Askıya Alındı"` eklenir,
diğer 8 etiket **DEĞİŞMEZ**.

`ON_HOLD` şema dosyasında okunabilirlik için `PAID`'in ARKASINA yazılır; migration'da PostgreSQL'in
`ALTER TYPE ... ADD VALUE` ifadesi değeri fiilen sona ekler. Bu sapma **zararsızdır ve zaten mevcuttur**
(`SHIPPED` de aynı şekilde eklendi, bkz. `migrations/20260824075808_add_order_status_shipped`) — projede
`ORDER BY status` yapan HİÇBİR sorgu yoktur.

### 3.2 RBAC: `SUPER_ADMIN` icat edilmez — yetki **eylemin geri alınabilirliğine** göre daraltılır

`SUPER_ADMIN` rolü projede YOKTUR ve bu görev için **eklenmez**: yeni bir rol kademesi
`SiteRole` enum'ını, `ROLES_*` sabitlerini, `permissions-matrix.ts`'i, davet/kullanıcı yönetimi
akışlarını, 5 kademeli RBAC dokümanının tamamını ve `admin-users-fixtures.ts`'i etkiler — sipariş
ekranı için ödenecek bedelin çok üstünde bir maliyet. Kullanıcının "yalnızca SUPER_ADMIN ve ADMIN"
isteği, **projenin en yüksek yetki seviyesi olan `ADMIN`'e daraltılarak** karşılanır (`ROLES_ADMIN`).

Ancak "tüm sipariş yazma uçlarını ADMIN'e kilitlemek" **kabul edilmez bir operasyonel gerileme**
üretirdi: `MANAGER` bugün `/admin/orders`'ın sahibi olan operasyon rolüdür ve **kargo işaretlemesi**
(`PAID→SHIPPED`, `→FULFILLED`) günlük iştir. Bunu ADMIN'e taşımak her sevkiyatı ADMIN darboğazına
sokar — ve kullanıcı bunu istemedi; kullanıcının saydığı üç eylem **Onayla / Askıya Al / İptal Et**tir.

**Karar — hedef duruma göre kademeli yetki:**

| İşlem | Rol | Gerekçe |
|---|---|---|
| `GET /admin/orders`, `GET /admin/orders/{id}` | **ADMIN + MANAGER** (değişmez) | Salt okuma; MANAGER operasyonu yürütebilmek için görmek ZORUNDA |
| `GET /admin/orders/{id}/activity` | **ADMIN + MANAGER** | Salt okuma, `ipAddress` DÖNMEZ (§5.4) — `/admin/logs`'un ADMIN-only kalmasıyla çelişmez |
| `PATCH .../status` → `SHIPPED`, `FULFILLED` | **ADMIN + MANAGER** (değişmez) | Sevkiyat = günlük operasyon, geri alınabilir, müşteriye para/ilişki riski yok |
| `PATCH .../status` → `ON_HOLD`, `PAID`, `CANCELLED` | **YALNIZCA ADMIN** | İstisnai; `CANCELLED` terminaldir, müşteriye e-posta tetikler ve para/stok mutabakatını etkiler |
| `PATCH /admin/orders/{id}` (iletişim/adres/`adminNotes`) | **YALNIZCA ADMIN** | Mali kaydın kimlik/teslimat snapshot'ını değiştirir |
| `POST .../refund` | ADMIN + MANAGER (**bu fazda DEĞİŞMEZ**) | §8.2 açık madde |

**Uygulama biçimi (backend-agent için bağlayıcı):**
- Router seviyesindeki `requireSiteRole(...ROLES_ADMIN_MANAGER)` hook'u **KALIR** (panel kapısı).
- `PATCH /:orderId` üzerinde route seviyesinde `preHandler: requireSiteRole(...ROLES_ADMIN)`
  (projedeki mevcut desen, bkz. `appearance.routes.ts:270`).
- `PATCH /:orderId/status` **hedef duruma göre** handler içinde kontrol edilir:
  `const ADMIN_ONLY_TARGETS: OrderStatus[] = ["ON_HOLD", "PAID", "CANCELLED"]`. Yetkisizse
  `ForbiddenError` **ve** `logAudit(status: "FORBIDDEN", action: "order.status_change",
  targetType: "Order", targetId, metadata: { from, to })` — yani reddedilen deneme sipariş aktivite
  akışında da GÖRÜNÜR (`requireSiteRole`'ün kendi FORBIDDEN kaydı `targetId` taşımadığı için orada görünmez).
- **Uçlar yalnızca sunucuda kilitlenir;** UI gizleme (§7.1) bir güvenlik önlemi DEĞİL, gürültü azaltmadır.

### 3.3 "Siparişi Onayla" = `ON_HOLD → PAID` (askıdan çıkarma), `PENDING → PAID` DEĞİL

Kullanıcının "Siparişi Onayla" butonu, **askıya alınmış bir siparişi yeniden işleme sokar**:
`ON_HOLD → PAID` ("Hazırlanıyor"a döner). Buton metni "Siparişi Onayla", yardımcı metni
"Sipariş yeniden **Hazırlanıyor** durumuna döner."

`PENDING → PAID` (manuel ödeme onayı) **bu uçtan AÇILMAZ** — gerekçe §3.4.

### 3.4 `PAID`, ödeme akışının TÜREVİDİR — elle yazılamaz

`PAID`'e geçiş `modules/webhooks/stripe.routes.ts::handleOrderPaid` içinde **tek bir Serializable
transaction**ta çok daha fazlasını yapar: stok/varyasyon stoğu düşer, `Product.salesCount` artar,
`paidAt` yazılır, `USER → CUSTOMER` terfisi tetiklenir, `ORDER_PAID` webhook'u ve `ORDER_CONFIRMATION`
e-postası gönderilir. Durum ucundan elle `PENDING → PAID` yazmak bunların **HİÇBİRİNİ** yapmaz →
**stoğu düşmemiş, ödemesi olmayan, "Hazırlanıyor" görünen bir sipariş** üretir (aşırı satış + tutarsız
mali kayıt).

Ayrıca `handleOrderPaid` idempotency'yi `if (order.status !== "PENDING") return;` ile kurar. Bu iki
sonucu doğurur:
- **`PENDING → ON_HOLD` de YASAKTIR** (§4.1): `PENDING` bir sipariş askıya alınırsa ve Stripe ödemeyi
  o sırada tamamlarsa, webhook `status !== "PENDING"` dalına düşer → **para tahsil edilir ama stok
  düşmez, onay e-postası gitmez, sipariş sonsuza dek `ON_HOLD` kalır.** Sessiz para kaybı senaryosu.
- `ON_HOLD` yalnızca `PAID`'den ulaşılabilir; dolayısıyla `ON_HOLD → PAID` dönüşünde `paidAt`
  ZATEN doludur ve **ÜZERİNE YAZILMAZ** (mevcut `shippedAt`/`deliveredAt` deseniyle aynı ilke).

Havale/EFT gibi kanal dışı ödeme onayı gerçek bir ihtiyaç hâline gelirse, çözüm bu uç DEĞİL,
`handleOrderPaid`'in transaction gövdesini paylaşan ayrı bir `POST /admin/orders/{id}/mark-paid`
ucudur — §8.1 açık maddesi.

### 3.5 Ödemesi alınmış sipariş "iptal" ile kapatılmaz — para geri ödenmeden terminal duruma geçilmez

`CANCELLED` bugün yalnızca `PENDING`'den (ödeme HİÇ alınmamış) ulaşılabilir; bu tesadüf değil,
tasarımdır. `ON_HOLD`'un eklenmesi `ON_HOLD → CANCELLED` yolunu açar ve `ON_HOLD` **her zaman ödenmiş**
bir siparişten gelir → "iptal ettim ama parayı iade etmedim" hatası mümkün hâle gelir.

**Karar:** `→ CANCELLED` geçişinde, `order.paidAt != null` ise istek gövdesinde
`confirmWithoutRefund: true` **ZORUNLUDUR**; yoksa `409 CONFLICT`:
> "Bu siparişin ödemesi alınmış. İptal etmek parayı OTOMATİK İADE ETMEZ — önce 'İade Et' ile Stripe
> iadesi yapın (durum `REFUNDED` olur) veya iadeyi kendiniz yürüteceğinizi onaylayın."

`PAID → CANCELLED` **doğrudan AÇILMAZ**: ödenmiş bir siparişi iptal etmek için admin önce
**Askıya Al** (geri alınabilir), sonra **İptal Et** (onay kutusuyla) adımlarını izler. Bu iki adımlı
sürtünme kasıtlıdır — tek tıkla para kaybı üretilemez.

Ek olarak `ON_HOLD`, `REFUNDABLE_STATUSES` listesine EKLENİR (`["PAID", "SHIPPED", "FULFILLED", "ON_HOLD"]`):
askıya alınmış bir sipariş için doğru kapanış yolu iadedir ve doğrudan erişilebilir olmalıdır.

### 3.6 Sipariş kalemi (ürün/adet) düzenleme **REDDEDİLDİ**

Kullanıcı "ürün adetleri" güncellemesi istedi. **Kapsam dışı** — gerekçe:
1. `OrderItem` bir **mali snapshot**tır; `quantity` değişimi `lineTotalCents` → `subtotalCents` →
   `taxCents` → `totalCents` zincirini değiştirir. Sipariş `PAID` ise Stripe'ta **tahsil edilmiş tutar**
   değişmez → DB'deki toplam ile gerçekte çekilen para ayrışır (fatura + muhasebe hatası).
2. `PENDING` siparişte de güvenli değildir: `stripeCheckoutSessionId` ile **line_items'ı sabitlenmiş**
   bir Stripe Checkout oturumu zaten AÇIKTIR; müşteri eski tutarı öder, biz yeni tutarı kaydederiz.
3. Stok mutabakatı `handleOrderPaid`'in Serializable transaction'ına aittir; adet değişimi stoğu
   ayrıca düzeltmeyi gerektirir → iki sahipli, yarış koşullu bir yazma yüzeyi doğar.
4. Doğru çözüm kısmi iade / ek tahsilat (integration-agent, Stripe partial refund) + fatura yeniden
   düzenlemedir; bu ayrı bir fazdır.

**Bu fazda desteklenen düzeltme yolları:** `adminNotes` (dahili kayıt), `İade Et` (para geri) ve
`Askıya Al → İptal Et` (kapatma). Sipariş detay ekranındaki ürün tablosu **salt okunur kalır** ve
bir yardım metni bunu açıkça söyler (§7.2).

### 3.7 `adminNotes`/`cancellationReason` müşteri yüzeyine SIZAMAZ → ayrı `AdminOrder` DTO'su

`mappers/index.ts::toOrderDto` bugün **hem** `/admin/orders*` **hem** `/users/me/orders*` tarafından
kullanılıyor (`users.routes.ts:161,187`). Yeni alanları `OrderDto`'ya eklemek, dahili admin notlarını
**müşterinin kendi sipariş sayfasında** yayınlardı.

**Karar:** `OrderSchema`/`toOrderDto` **DEĞİŞMEZ**. Yeni `AdminOrderSchema = OrderSchema.extend({
adminNotes, cancellationReason })` ve `toAdminOrderDto(order)` eklenir; **yalnızca `/admin/orders*`**
uçları bunu kullanır. Varsayılan reddetmedir (default-deny): bir alan admin DTO'suna eklenmedikçe
hiçbir yerde görünmez.

`cancellationReason` müşteriye **yalnızca iptal e-postasıyla** ulaşır (admin bunu bilerek ve onay
kutusuyla tetikler) — müşteri portalında ayrıca yayınlanmaz (§8.3 açık madde).

### 3.8 Aktivite günlüğü için YENİ TABLO AÇILMAZ — mevcut `AuditLog` kullanılır

`logAudit` zaten her durum değişiminde (`order.status_change`) ve iadede (`order.refund`)
`targetType: "Order"`, `targetId`, `actorEmail`, `createdAt` yazıyor. İkinci bir "order_events"
tablosu, aynı gerçeğin iki kaynağını üretirdi. **Karar:** aynı mekanizma kullanılır; eksik olan tek
şey **okuma yolu** ve **indeks**tir (§4.3, §5.4).

### 3.9 Durum ucu ile düzenleme ucu AYRI kalır

`PATCH /:orderId/status` (durum makinesi + yan etkiler: webhook, e-posta, zaman damgaları) ile
`PATCH /:orderId` (alan güncelleme) **tek gövdede birleştirilmez**. Gerekçe: farklı RBAC eşikleri
(§3.2), farklı ön koşullar (durum geçiş tablosu vs. düzenlenebilir durum listesi), farklı yan etkiler
(biri `ORDER_STATUS_CHANGED` yayar, diğeri yaymaz) ve farklı hata sözlüğü. Tek uçta birleştirmek,
her isteği "ne yapmaya çalışıyorsun?" diye ayrıştıran dallı bir handler üretirdi. Mevcut desen
(`status` ve `refund` ayrı uçlar) KORUNUR.

---

## 4. Veri modeli (db-agent — TEK SAHİP)

> backend-agent/frontend-agent bu bölümü **TÜKETİR**, değiştirmez. `schema.prisma`'ya yalnızca
> db-agent dokunur.

### 4.1 `enum OrderStatus` — tek yeni değer

```prisma
enum OrderStatus {
  PENDING
  PAID
  ON_HOLD   // YENİ — bkz. .claude/architect-scope-order-management-pro.md §3.1/§4.1
  SHIPPED
  FAILED
  CANCELLED
  EXPIRED
  REFUNDED
  FULFILLED
}
```

Şema yorumu olarak eklenmesi ZORUNLU not: `ON_HOLD` YALNIZCA `PAID`'den ulaşılır; `PENDING → ON_HOLD`
YASAKTIR çünkü `stripe.routes.ts::handleOrderPaid` idempotency'yi `status !== "PENDING"` ile kurar
(bkz. §3.4).

**Bağlayıcı geçiş tablosu (backend-agent `ALLOWED_TRANSITIONS`'ı BUNA eşitler):**

| Kaynak | İzinli hedefler | Not |
|---|---|---|
| `PENDING` | `CANCELLED` | değişmedi; `paidAt = null` olduğu için `confirmWithoutRefund` gerekmez |
| `PAID` | `ON_HOLD`, `SHIPPED`, `FULFILLED` | `ON_HOLD` YENİ; `PAID → CANCELLED` AÇILMAZ (§3.5) |
| `ON_HOLD` | `PAID`, `CANCELLED` | `PAID` = "Siparişi Onayla" (§3.3); `CANCELLED` = §3.5 kuralına tabi |
| `SHIPPED` | `FULFILLED` | değişmedi |
| `FAILED`, `EXPIRED`, `CANCELLED`, `REFUNDED`, `FULFILLED` | — (hiçbiri) | terminal; bu uçtan değiştirilemez |

`REFUNDABLE_STATUSES` → `["PAID", "SHIPPED", "FULFILLED", "ON_HOLD"]` (§3.5).

### 4.2 `model Order` — iki yeni kolon

```prisma
  /// Yalnızca `status = CANCELLED`'a geçişte doldurulur; `PATCH /admin/orders/{id}/status`
  /// gövdesinde ZORUNLUDUR (uygulama katmanı, DB'de CHECK YOK — `trackingNumber`/SHIPPED ile
  /// AYNI desen). Bu metin MÜŞTERİYE GİDEN iptal e-postasında AYNEN yer alır (§6.2) — dahili
  /// not için `adminNotes` kullanılır. Uzunluk sınırı Zod'da: 1..500.
  cancellationReason String?
  /// Yalnızca panele görünen serbest dahili not. `OrderDto`'ya (müşteri yüzeyi) ASLA
  /// eklenmez — yalnızca `AdminOrderDto` taşır (§3.7). Zod sınırı: 0..5000.
  adminNotes         String?
```

- İkisi de **nullable** ve **indekslenmez** (hiçbir sorgu bunlar üzerinden filtrelemiyor — mevcut
  `shippingAddress*` kararıyla aynı gerekçe).
- Prisma `String?` PostgreSQL'de `TEXT`'e karşılık gelir; `@db.Text` **gereksizdir**, projedeki
  mevcut uzun metin kolonları da kullanmıyor.
- **Yeni zaman damgası kolonu (`cancelledAt`) EKLENMEZ:** "kim ne zaman iptal etti" sorusunun tek
  kaynağı `AuditLog`'tur (§3.8). Dördüncü bir durum damgası, `AuditLog` ile ayrışabilecek ikinci
  bir gerçek üretirdi.

### 4.3 `model AuditLog` — sipariş bazlı okuma için indeks

```prisma
  @@index([targetType, targetId])   // YENİ — GET /admin/orders/{id}/activity (§5.4)
```
Mevcut indeksler (`status`, `action`, `actorId`) hiçbiri `targetId` filtresini karşılamıyor;
`audit_logs` en hızlı büyüyen tablolardan biridir, indekssiz seq-scan kabul edilemez.

### 4.4 `enum EmailTemplatePurpose` — yeni amaç

```prisma
enum EmailTemplatePurpose {
  ...
  ORDER_CANCELLATION   // YENİ — §6
  ...
}
```
`email_templates_active_purpose_key` kısmi unique indeksi yeni değere **otomatik** uygulanır
(ek SQL gerekmez).

### 4.5 Migration planı (SIRA BAĞLAYICI)

PostgreSQL'de `ALTER TYPE ... ADD VALUE` ile eklenen bir değer **aynı transaction içinde
KULLANILAMAZ**; Prisma her migration dosyasını tek transaction'da çalıştırır. Bu yüzden enum
değişiklikleri, o değerleri kullanan/varsayan işlemlerden **AYRI** migration'lara konur — projede
zaten var olan presedan (`20260824075808_add_order_status_shipped` + `20260824075824_add_order_shipping_fields`).

1. `<ts>_add_order_status_on_hold_and_cancellation_purpose`
   ```sql
   ALTER TYPE "OrderStatus" ADD VALUE 'ON_HOLD';
   ALTER TYPE "EmailTemplatePurpose" ADD VALUE 'ORDER_CANCELLATION';
   ```
   (İki `ADD VALUE` aynı dosyada olabilir — hiçbiri bu dosyada KULLANILMIYOR.)
2. `<ts>_add_order_admin_fields`
   ```sql
   ALTER TABLE "orders" ADD COLUMN "cancellationReason" TEXT,
                        ADD COLUMN "adminNotes" TEXT;
   CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");
   ```

Backfill YOKTUR (her iki kolon da geçmiş siparişlerde gerçekten YOK — uydurulmaz).
`prisma/seed.ts`'e `ORDER_CANCELLATION` şablon satırı eklenir (§6.1) — bu **migration 1'den SONRA**
çalışacağı için enum değeri mevcuttur.

---

## 5. Backend kontratı (backend-agent)

Tüm uçlar `/admin/orders` prefix'i altındadır (`app.ts`), zarf (`envelope`) ve hata kodları projenin
mevcut standardını izler: `200`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`,
`409 CONFLICT`, `422 VALIDATION_ERROR`.

### 5.1 `AdminOrder` DTO (§3.7)

`OrderSchema`'nın tüm alanları **+**:
```ts
cancellationReason: string | null;
adminNotes: string | null;
```
`GET /admin/orders`, `GET /admin/orders/{orderId}`, `PATCH /admin/orders/{orderId}`,
`PATCH /admin/orders/{orderId}/status`, `POST /admin/orders/{orderId}/refund` **hepsi** `AdminOrder`
döner. `customerEmail`/`billing.nationalId` maskeleme kuralı **DEĞİŞMEZ** (liste maskeli, detay açık).

### 5.2 `PATCH /admin/orders/{orderId}/status` (genişletildi)

**RBAC:** router `ROLES_ADMIN_MANAGER`; hedef `ON_HOLD`/`PAID`/`CANCELLED` ise handler içinde
**ADMIN** şartı (§3.2).

**Request body:**
```ts
{
  status: "PAID" | "ON_HOLD" | "SHIPPED" | "FULFILLED" | "CANCELLED";
  trackingNumber?: string;        // 1..100 — status=SHIPPED iken ZORUNLU (mevcut kural)
  shippingCarrier?: string;       // 1..100 — her zaman opsiyonel
  cancellationReason?: string;    // 1..500 — status=CANCELLED iken ZORUNLU
  sendCustomerEmail?: boolean;    // varsayılan true — yalnızca status=CANCELLED ile anlamlı
  confirmWithoutRefund?: boolean; // varsayılan false — §3.5
}
```

**Zod (`orders.schemas.ts::UpdateOrderStatusRequestSchema`) kuralları:**
- `status === "SHIPPED" && !trackingNumber` → 422 (`path: ["trackingNumber"]`) — mevcut kural aynen kalır.
- `status === "CANCELLED" && !cancellationReason` → 422 (`path: ["cancellationReason"]`,
  mesaj: "İptal nedeni zorunludur.").
- `status !== "CANCELLED"` iken `cancellationReason`/`sendCustomerEmail`/`confirmWithoutRefund`
  gönderilmişse → **422** (sessizce yutulmaz; istemcinin verisinin kaybolduğunu sanmaması için).
- `status !== "SHIPPED"` iken `trackingNumber`/`shippingCarrier` davranışı **DEĞİŞMEZ** (bugünkü gibi
  kabul edilir; geriye dönük uyum).

**Handler davranışı:**
1. 404 → sipariş yok.
2. Hedef durum ADMIN-only listesindeyse ve `request.user.role !== "ADMIN"` → `logAudit(FORBIDDEN,
   action: "order.status_change", targetType: "Order", targetId, metadata: {from,to})` + `403`.
3. `ALLOWED_TRANSITIONS` (§4.1) ihlali → `409` (mevcut mesaj formatı korunur).
4. `status === "CANCELLED" && existing.paidAt != null && confirmWithoutRefund !== true` → `409`
   (§3.5 mesajı).
5. `update`: `status`, koşullu `trackingNumber`/`shippingCarrier`,
   `shippedAt`/`deliveredAt` ilk-geçişte doldurma (**değişmez**),
   `status === "CANCELLED" ? { cancellationReason } : {}`.
   **`paidAt` hiçbir koşulda yazılmaz/silinmez.**
6. `logAudit`: `action: "order.status_change"`, `metadata: { from, to, ...(to === "CANCELLED" ? {
   cancellationReason, customerEmailRequested: sendCustomerEmail ?? true } : {}) }`.
7. `emitWebhookEvent("ORDER_STATUS_CHANGED", ...)` — **değişmez** (§7.3).
8. `to === "CANCELLED" && sendCustomerEmail !== false` → iptal e-postası (§6.2), **best-effort**.
9. `200` + `AdminOrder`.

Adım sırası bağlayıcıdır: e-posta ve webhook **DB güncellemesinden SONRA** tetiklenir; ikisinin de
başarısızlığı isteği **BOZMAZ** (mevcut `handleOrderPaid` deseni).

### 5.3 `PATCH /admin/orders/{orderId}` — YENİ (yalnızca ADMIN)

**RBAC:** route seviyesinde `preHandler: requireSiteRole(...ROLES_ADMIN)`.

**Request body** (tüm alanlar opsiyonel; **hiçbiri gönderilmezse 422**):
```ts
{
  customerEmail?: string;                 // e-posta formatı
  customerName?: string | null;           // 1..200 veya null
  shippingAddress?: OrderAddressInput;    // TAM NESNE — kısmi (alan bazlı) yama KABUL EDİLMEZ
  billing?: OrderBillingInput;            // TAM NESNE — checkout ile AYNI doğrulama kuralları
  adminNotes?: string | null;             // 0..5000 veya null
}
```
- `OrderAddressInput` = `checkout.schemas.ts::CheckoutAddressInputSchema` ile **BİREBİR AYNI şema**
  (yeniden yazılmaz, **import edilir**). `OrderBillingInput` de aynı şekilde checkout'un fatura
  nesnesini (INDIVIDUAL/CORPORATE koşullu zorunlulukları, TCKN/VKN doğrulaması dahil) yeniden kullanır.
  Gerekçe: iki farklı adres doğrulama kuralı seti = kaçınılmaz sapma.
- **Kısmi adres yaması yasak:** adres bir snapshot'tır; alan bazlı yama yarı geçerli bir adres
  (ör. şehir yeni, ilçe eski) üretebilir. İstemci mevcut değerlerle dolu formu tam gönderir.
- `billing` gönderilirse `Order.billingType` + tüm `billing*` kolonları birlikte yazılır.
  `sameAsShipping` bayrağı **YOKTUR** (checkout kararıyla aynı — sunucu materyalize eder; burada
  istemci zaten iki formu ayrı gönderir).

**Ön koşullar:**
- `adminNotes` **her durumda** düzenlenebilir.
- `customerEmail`/`customerName`/`shippingAddress`/`billing` yalnızca
  `status ∈ { PENDING, PAID, ON_HOLD }` iken düzenlenebilir; aksi hâlde **409**:
  "Kargoya verilmiş veya kapanmış bir siparişin iletişim/adres bilgisi değiştirilemez."
  Gerekçe: `SHIPPED` sonrası adres snapshot'ı **fiilen kullanılmış kargo etiketidir**; onu değiştirmek
  paketin nereye gittiğinin kaydını yok eder.

**Yan etkiler:**
- `logAudit`: `action: "order.update"`, `targetType: "Order"`, `metadata: { fields: string[] }` —
  **YALNIZCA değişen alan ADLARI**. Eski/yeni değerler (adres, e-posta, TCKN) audit metadata'sına
  **ASLA yazılmaz** (KVKK veri minimizasyonu + `logAudit` "metadata'ya hassas veri yazma" kuralı).
- **`ORDER_STATUS_CHANGED` YAYILMAZ** (durum değişmedi) ve yeni bir webhook olayı EKLENMEZ (§7.3).
- `Order.siteUser` ilişkisine **DOKUNULMAZ**: `customerEmail` değişimi `User` kaydını güncellemez,
  yeni kullanıcı aramaz/eşleştirmez. Sipariş snapshot'ı ile hesap kimliği ayrı eksenlerdir.

**Yanıt:** `200` + `AdminOrder`.

### 5.4 `GET /admin/orders/{orderId}/activity` — YENİ (ADMIN + MANAGER)

```
where:   { targetType: "Order", targetId: orderId, action: { startsWith: "order." } }
orderBy: { seq: "desc" }
take:    50            // cursor sayfalama YOK — bir siparişin olay sayısı doğal olarak küçüktür
config:  { rateLimit: { max: 120, timeWindow: "1 minute" } }   // logs.routes.ts ile aynı savunma
```
Sipariş yoksa **404** (var olmayan bir `orderId` için boş liste dönmek, kimlik sızdırmayan ama
kafa karıştıran bir davranış olurdu).

**Yanıt DTO'su — `AuditLogDto` DEĞİL, amaca özel `OrderActivityEntry`:**
```ts
{
  id: string;
  action: string;        // "order.status_change" | "order.refund" | "order.update" | "order.cancel_email"
  status: "SUCCESS" | "FAILURE" | "FORBIDDEN";
  actorEmail: string | null;
  createdAt: string;     // ISO
  metadata: Record<string, unknown> | null;   // ALLOW-LIST'ten geçirilmiş
}
```
- **`ipAddress` DÖNMEZ.** `/admin/logs` ADMIN-only bir güvenlik yüzeyidir
  (`.claude/architect-scope-rbac-5-tier.md` §5.3 satır 8, dipnot (f));
  bu uç MANAGER'a açıldığı için genel log okuma için bir arka kapıya dönüşmemelidir. IP'nin
  operasyonel değeri sıfır, PII yükü yüksektir.
- `metadata` allow-list: `from`, `to`, `reason`, `cancellationReason`, `customerEmailRequested`,
  `fields`, `emailDelivered`, `stripeRefundId`. Listede olmayan anahtarlar **düşürülür** (ileride
  başka bir ajanın audit metadata'sına ekleyeceği bir alanın buradan sızmasını engeller).

### 5.5 Dokunulacak backend dosyaları (backend-agent)

| Dosya | Değişiklik |
|---|---|
| `src/modules/orders/orders.schemas.ts` | `UpdateOrderStatusRequestSchema` genişletme, `UpdateOrderRequestSchema` (yeni) |
| `src/modules/orders/orders.routes.ts` | `ALLOWED_TRANSITIONS`, `REFUNDABLE_STATUSES`, hedef-durum RBAC, yeni 2 uç, iptal e-postası tetikleyicisi |
| `src/schemas/entities.ts` | `OrderStatusSchema` + `ON_HOLD`, `EmailTemplatePurposeSchema` + `ORDER_CANCELLATION`, `AdminOrderSchema`, `OrderActivityEntrySchema` |
| `src/mappers/index.ts` | `toAdminOrderDto`, `toOrderActivityEntryDto` (`toOrderDto` **DEĞİŞMEZ**) |
| `docs/architecture/shared-types.ts` | tip aynası (tek doğruluk kaynağı) |

---

## 6. İptal e-postası (notification-agent — TEK SAHİP)

### 6.1 Şablon

- **Yeni amaç:** `EmailTemplatePurpose.ORDER_CANCELLATION` — `sendTemplateEmail(app,
  "ORDER_CANCELLATION", ...)` ile çözümlenir (`findFirst({ purpose, isActive: true })`).
  `EmailTemplate.key = "ORDER_CANCELLATION"`, `isSystem: true`, `isActive: true`,
  `editorMode: "RAW"` — mevcut 5 sistem şablonuyla **aynı desen**. Yeni bir gönderim altyapısı
  KURULMAZ (`lib/mail.ts` + `email-templates.service.ts` aynen kullanılır).
- **Seed:** `prisma/seed.ts`'e `ORDER_CONFIRMATION` bloğunun hemen ardına `upsert({ where: { key:
  "ORDER_CANCELLATION" } })`. **Ownership istisnası (architect onaylı, tek seferlik):**
  `prisma/seed.ts` normalde db-agent alanıdır; bu şablon satırının içeriği notification-agent'a
  aittir ve **yalnızca bu upsert bloğunu** notification-agent yazar.
- **Değişkenler** (`lib/email-variables.ts::SYSTEM_VARIABLES_BY_PURPOSE`) — `ORDER_CONFIRMATION` ile
  anahtar adları BİREBİR aynı tutulur (yeni bir kısaltma İCAT EDİLMEZ), üstüne bir yeni anahtar:

  | Anahtar | Etiket | Örnek |
  |---|---|---|
  | `order_number` | Sipariş Numarası | `ORD-1024` |
  | `customer_name` | Müşteri Adı | `Ayşe Yılmaz` |
  | `items_summary` | Sipariş İçeriği | `Ürün A x1, Ürün B (Antrasit / L) x2` |
  | `total_formatted` | Toplam Tutar | `₺1.250,00` |
  | `cancellation_reason` | İptal Nedeni | `Stok tükendi` |

  (`site_name`/`site_url` her çağrıda otomatik enjekte edilir.)
- **Türkçe amaç etiketi** (`frontend/src/lib/email-blocks/purpose-labels.ts`):
  `ORDER_CANCELLATION: "Sipariş İptali"` + sıralama dizisine eklenir.

### 6.2 Tetikleyici (backend-agent uygular, sözleşme notification-agent'ın)

`PATCH /:orderId/status` içinde, `to === "CANCELLED" && sendCustomerEmail !== false` iken,
**DB commit'inden ve webhook emisyonundan SONRA**:

```
try {
  await sendTemplateEmail(app, "ORDER_CANCELLATION", order.customerEmail, {
    order_number, customer_name: order.customerName ?? order.customerEmail,
    items_summary: <ORDER_CONFIRMATION ile AYNI üretim: `${productTitle}${variantLabel ? ` (${variantLabel})` : ""} x${quantity}` join(", ")>,
    total_formatted: formatMoney(order.totalCents, order.currency),
    cancellation_reason,
  });
  delivered = true;
} catch (err) {
  app.log.error({ err, orderId }, "Sipariş iptal e-postası gönderilemedi");
}
await logAudit(app, { action: "order.cancel_email", status: delivered ? "SUCCESS" : "FAILURE",
                      targetType: "Order", targetId: order.id, metadata: { emailDelivered: delivered } });
```

Bağlayıcı kurallar:
- **E-posta hatası API'yi ASLA kırmaz** — 200 döner, hata `app.log.error` ile loglanır.
- **Alıcı adresi audit metadata'sına YAZILMAZ** (KVKK minimizasyonu; `targetId` zaten alıcıyı
  siparişten türetilebilir kılar).
- `sendCustomerEmail: false` gönderilirse e-posta HİÇ denenmez ve `order.cancel_email` kaydı
  **oluşturulmaz** (aktivite akışında yanıltıcı bir "gönderilmedi" satırı çıkmaz;
  `order.status_change` metadata'sındaki `customerEmailRequested: false` bu bilgiyi zaten taşır).
- **Enjeksiyon:** `cancellation_reason` admin serbest metnidir ama `lib/template-render.ts`
  değerleri **HTML-escape** ederek basar (allow-list + `escapeHtml`) — ham HTML/CSS enjekte edilemez.
  Ek bir sanitizasyon katmanı GEREKMEZ.

---

## 7. Frontend (ui-designer → frontend-agent)

### 7.1 ui-designer (ÖNCE — frontend-agent'ı bloklar)

Çıktı: `.claude/design-notes-order-management-pro.md`.

1. **"Onayla" için yeşil eylem.** `Button` bileşeninde bugün `default | outline | secondary | ghost |
   destructive | warning | link` var; **yeşil (success) varyantı YOK**. Karar ui-designer'ındır:
   ya `destructive`/`warning` ile **birebir aynı desende** bir `success` varyantı eklenir
   (`--success` / `--success-foreground` tokenları ZATEN mevcut, `globals.css:33,41`), ya da mevcut
   bir varyanta eşlenir. **`default` (primary) KULLANILMAZ** — primary site aksan rengidir ve
   yönetici tarafından değiştirilebilir; "onay = yeşil" semantiği garanti edilemez.
   **Ham renk kodu (hex) YAZILMAZ**, yalnızca token kullanılır.
2. `ON_HOLD` için `Badge` tonu: mevcut `Tone` union'ından seçilir (`"warning"` önerilir — `PENDING`/
   `PAID` ile aynı "sürüyor" ailesi); **yeni ton İCAT EDİLMEZ**.
3. Üst eylem çubuğu düzeni (mevcut buton kalabalığı 6'ya çıkıyor: Onayla / Askıya Al / İptal Et /
   Kargoya Ver / Tamamlandı / İade Et) — gruplama, taşma ve mobil davranış kararı.
4. İptal modalının uyarı hiyerarşisi: zorunlu neden alanı, "Müşteriye e-posta gönderilsin" onay
   kutusu ve **ödenmiş sipariş** durumundaki kırmızı ikinci onay kutusu (§3.5).
5. Düzenleme modu (görüntüle ↔ düzenle geçişi), `adminNotes` kartı ve aktivite günlüğü satır
   tipografisi/ikonografisi.

### 7.2 frontend-agent

| Dosya | Değişiklik |
|---|---|
| `src/lib/order-status.ts` | `ON_HOLD: "Askıya Alındı"` + ton (TEK sözlük — durum etiketi başka HİÇBİR yerde yazılmaz) |
| `src/lib/order-activity.ts` (YENİ) | `action` → Türkçe etiket sözlüğü (`order.status_change` → "Durum değiştirildi" vb.), aynı tek-sözlük kuralı |
| `src/lib/api/types.ts` | `OrderStatus` + `ON_HOLD`, `AdminOrder`, `UpdateOrderStatusRequest` yeni alanlar, `UpdateOrderRequest`, `OrderActivityEntry`, `EmailTemplatePurpose` + `ORDER_CANCELLATION` |
| `src/lib/api/orders.ts` | `updateOrder()`, `getOrderActivity()` |
| `src/lib/email-blocks/purpose-labels.ts` | `ORDER_CANCELLATION: "Sipariş İptali"` |
| `src/app/admin/orders/page.tsx` | Değişiklik **gerekmez** — durum filtresi `ORDER_STATUS_LABELS` anahtarlarından türüyor, `ON_HOLD` otomatik gelir |
| `src/app/admin/orders/[orderId]/page.tsx` | Üst eylem çubuğu, iptal modalı, düzenleme modu, `adminNotes` kartı, aktivite kartı, rol kapısı |

**Rol kapısı (UI):** `useAuth()` (`@/context/auth-context`) → `const isAdmin = user?.role === "ADMIN"`.
- `isAdmin === false` (yani MANAGER): "Siparişi Onayla", "Askıya Al", "İptal Et", "Düzenle" ve
  `adminNotes` yazma alanı **RENDER EDİLMEZ**. "Kargoya Ver", "Tamamlandı", "İade Et" **görünür**.
  `adminNotes` MANAGER'a **salt okunur** gösterilir (admin uçları zaten döndürüyor; gizlemek yanlış
  bir güvenlik hissi verirdi).
- Bu **kozmetiktir**; gerçek kilit sunucudadır (§3.2).

**Duruma göre görünen eylemler:**

| Durum | Eylemler |
|---|---|
| `PENDING` | İptal Et (ADMIN) |
| `PAID` | Askıya Al (ADMIN) · Kargoya Ver · Tamamlandı · İade Et |
| `ON_HOLD` | **Siparişi Onayla** (ADMIN) · İptal Et (ADMIN) · İade Et |
| `SHIPPED` | Tamamlandı · İade Et |
| `FULFILLED` | İade Et |
| `FAILED`, `EXPIRED`, `CANCELLED`, `REFUNDED` | — (yalnızca `adminNotes` + aktivite) |

**Ürün tablosu SALT OKUNUR kalır** ve altında bir yardım metni bulunur: "Sipariş kalemleri mali
kayıttır ve düzenlenemez; düzeltme için 'İade Et' veya 'Askıya Al → İptal Et' akışını kullanın."
(§3.6). Adet düzenleme UI'ı **eklenmez**.

**İptal modalı:** zorunlu neden (`maxLength 500`, yardım metni: **"Bu metin müşteriye gönderilecek
e-postada aynen yer alır."**), varsayılan işaretli "Müşteriye e-posta gönderilsin" kutusu ve
`order.paidAt != null` iken kırmızı uyarı + zorunlu ikinci onay kutusu (`confirmWithoutRefund`).
Sunucudan gelen 409 mesajları toast ile gösterilir (istemci tarafı kontrol tek savunma değildir).

### 7.3 Giden webhook sözleşmesi DEĞİŞMEZ

`lib/webhook-order-payload.ts` ve `enum WebhookEvent` **hiç değişmez**:
- `ON_HOLD`, payload'ın `status`/`previousStatus` alanlarında (serbest string) **otomatik** görünür;
  ek bir alan gerekmez.
- `cancellationReason`/`adminNotes` payload'a **EKLENMEZ**: `adminNotes` dahili veridir (§3.7),
  `cancellationReason` ise dış aboneler için sözleşmeyi genişletir. Bu, checkout-redesign §7.3'teki
  "payload'ı yeni alanla genişletme" kararıyla aynı ilkedir.
- Yeni bir `ORDER_CANCELLED` olayı **AÇILMAZ** — iptal de bir `ORDER_STATUS_CHANGED`'dir (mevcut
  `POST /refund` kararıyla aynı).

---

## 8. Bilinen boşluklar (bilinçli, takip gerektirir)

1. **Kanal dışı ödeme onayı (`PENDING → PAID`) yok.** Havale/EFT ihtiyacı doğarsa çözüm ayrı bir
   `POST /admin/orders/{id}/mark-paid` ucudur ve `handleOrderPaid`'in Serializable gövdesini
   (stok düşürme + `paidAt` + `ORDER_PAID` + onay e-postası) **PAYLAŞMAK ZORUNDADIR** (§3.4).
2. **`POST /refund` hâlâ ADMIN + MANAGER.** Yeni kademelemeyle ("istisnai/mali → ADMIN") tam tutarlı
   değil. Bilinçli olarak bu turda değiştirilmedi: talep edilmedi, mevcut korumaları güçlü (atomik
   claim + Stripe idempotencyKey + audit) ve RBAC daraltması security-agent ile ayrıca alınması
   gereken bir karardır. security-agent bu turda **görüş bildirmelidir**.
3. **`cancellationReason` müşteri portalında gösterilmiyor** (§3.7) — yalnızca e-posta ile ulaşır.
   Müşterinin `/hesabim/siparislerim/[orderId]` sayfasında da görmesi istenirse `OrderDto`'ya
   eklenmesi ve compliance-agent değerlendirmesi gerekir.
4. **`sendCustomerEmail: false` ile iptal edilen siparişte müşteri hiç bilgilendirilmez.** Bilinçli:
   admin'in kararı. Zorunlu bildirim politikası istenirse compliance-agent karar vermelidir.
5. **E2E'de gerçek e-posta gönderimi doğrulanmaz** (§9). `backend/.env.e2e`'de `SMTP_HOST` yoktur ve
   `NODE_ENV=development` olduğu için `lib/mail.ts` Ethereal test hesabına düşer — ağ bağımlı ve
   kırılgan. Doğrulama `order.cancel_email` audit kaydı üzerinden yapılır (§9 madde 2).

---

## 9. qa-agent kapsamı (Playwright, `frontend/tests/e2e/admin-order-management-pro.spec.ts`)

Fixture altyapısı ZATEN VAR: `support/api.ts::createPendingOrderDirect` (ham SQL ile `PENDING`
sipariş) + `postStripeCheckoutSessionCompleted` (gerçek imzalı webhook ile `PAID`'e çekme) +
`admin-users-fixtures.ts` (rol atama) + `createAuthenticatedPageAs`. **Yeni bir fixture mekanizması
İCAT EDİLMEZ**, gerekirse genişletilir.

1. **ADMIN ile `ON_HOLD → PAID`:** sipariş `PAID` yapılır → "Askıya Al" → rozet "Askıya Alındı" →
   "Siparişi Onayla" → rozet "Hazırlanıyor". (Kullanıcının istediği `ON_HOLD → CONFIRMED` senaryosunun
   bu projedeki karşılığı — §3.1 eşleme tablosu.)
2. **İptal + e-posta tetikleme:** `PENDING` sipariş → "İptal Et" → neden girilir, e-posta kutusu
   işaretli bırakılır → durum "İptal Edildi". Doğrulama **e-posta kutusundan değil**, `GET
   /admin/orders/{id}/activity` yanıtında `action: "order.cancel_email"` kaydının varlığından yapılır
   (§8 madde 5). Ayrıca `order.status_change` metadata'sında `customerEmailRequested: true` beklenir.
3. **Ödenmiş sipariş iptalinde para koruması:** `PAID` → "Askıya Al" → "İptal Et" (ikinci onay kutusu
   İŞARETLENMEDEN) → API 409, durum `ON_HOLD` kalır. Kutu işaretlenince başarılı.
4. **MANAGER yetkisizliği:** MANAGER rolüyle giriş → sipariş detayında "Askıya Al"/"İptal Et"/
   "Düzenle" **görünmez**, "Kargoya Ver" görünür. Doğrudan API çağrısı (`PATCH .../status` body
   `{status:"CANCELLED", cancellationReason:"x"}`) → **403**; `PATCH /admin/orders/{id}` → **403**.
5. **Düzenleme paneli:** ADMIN → "Düzenle" → telefon + adres satırı değiştirilir → kaydedilir →
   sayfa yenilendiğinde yeni değer kalıcıdır; aktivite akışında `order.update` satırı görünür.
6. **Aktivite günlüğü `ipAddress` sızdırmaz:** `GET /admin/orders/{id}/activity` yanıtının
   JSON'unda `ipAddress` anahtarı **bulunmamalıdır**.

`backend/tests/integration/orders.test.ts` (backend-agent): geçiş tablosunun her satırı + her
reddedilen kombinasyon, 403 hedef-durum kontrolü, `confirmWithoutRefund` 409'u, `PATCH /:orderId`
durum ön koşulu 409'u, `adminNotes`'un `/users/me/orders`'ta **DÖNMEDİĞİNİN** doğrulanması.

---

## 10. Ajan görev dağılımı, sıra ve dosya sahipliği

Görev tek commit'te toplanacağı için sıra **bağımlılık sırasıdır**, ayrı PR sırası değildir.
release-coordinator bu sırayı daraltabilir, **genişletemez**.

| # | Ajan | Sahip olduğu dosyalar | Bloklar |
|---|---|---|---|
| 1 | **db-agent** | `backend/prisma/schema.prisma`, `backend/prisma/migrations/**` (§4) | 2, 3 |
| 2 | **notification-agent** | `backend/src/lib/email-variables.ts`, `backend/prisma/seed.ts` (**yalnızca** `ORDER_CANCELLATION` upsert bloğu, §6.1), `frontend/src/lib/email-blocks/purpose-labels.ts` | 3 |
| 3 | **backend-agent** | `backend/src/modules/orders/*`, `backend/src/schemas/entities.ts`, `backend/src/mappers/index.ts`, `backend/tests/integration/orders.test.ts`, `docs/architecture/shared-types.ts` | 5 |
| 4 | **ui-designer** | `.claude/design-notes-order-management-pro.md`, `frontend/src/components/ui/button.tsx` (yalnızca `success` varyantı eklenirse) | 5 |
| 5 | **frontend-agent** | `frontend/src/app/admin/orders/**`, `frontend/src/lib/order-status.ts`, `frontend/src/lib/order-activity.ts`, `frontend/src/lib/api/{types,orders}.ts` | 6, 7 |
| 6 | **security-agent** | Denetim + §8.2 görüşü (kod yazmaz) | — |
| 7 | **compliance-agent** | `adminNotes`/`cancellationReason` KVKK değerlendirmesi, `.claude/compliance-notes-order-management-pro.md` | — |
| 8 | **qa-agent** | `frontend/tests/e2e/admin-order-management-pro.spec.ts`, `TEST_COVERAGE.md` | — |
| 9 | **documentation-agent** | `docs/architecture/openapi.yaml`, `docs/architecture/ARCHITECTURE.md` (§10.9.3), `CHANGELOG.md` | — |
| 10 | **code-quality-agent** | lint/format/tip denetimi (kod sahipliği yok) | — |

3 ↔ 5 arası çakışmalarda **bu doküman + `openapi.yaml`** hakemdir (CLAUDE.md).

**DOKUNULMAZ dosyalar (bu görev kapsamında — dokunmak isteyen ajan önce architect'e sorar):**
`backend/src/modules/webhooks/**` (özellikle `stripe.routes.ts::handleOrderPaid`),
`backend/src/lib/webhook-order-payload.ts`, `backend/src/lib/stripe.ts`,
`backend/src/lib/site-roles.ts` (yeni rol EKLENMEZ), `backend/src/lib/mail.ts`,
`backend/src/lib/template-render.ts`, `backend/src/modules/users/users.routes.ts`,
`backend/src/modules/checkout/**` (§5.3 buradan **import eder**, DEĞİŞTİRMEZ — adres/fatura Zod
şeması gerekirse `export` edilebilir, kuralları değiştirilemez),
`backend/prisma/seed.ts` (§6.1'deki tek upsert bloğu hariç),
`frontend/src/app/[lang]/(site)/hesabim/**`.

**Definition of Done ek maddeleri (bu göreve özel):**
- [ ] `toOrderDto` **değişmemiş** ve `/users/me/orders` yanıtında `adminNotes`/`cancellationReason` **yok**.
- [ ] `lib/webhook-order-payload.ts` **değişmemiş** (§7.3).
- [ ] `frontend/src/lib/order-status.ts` sipariş durum etiketlerinin **TEK** kaynağı olmaya devam ediyor.
- [ ] MANAGER için `PATCH .../status → CANCELLED` ve `PATCH /:orderId` **403** dönüyor (entegrasyon + e2e).
- [ ] E-posta gönderimi başarısız olduğunda durum güncellemesi **200** dönmeye devam ediyor.
- [ ] `docker compose up --build -d` ile yeniden derlendi (proje kuralı).
