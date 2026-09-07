# Architect Scope — Checkout Yeniden Tasarımı (2 Sütunlu Akış + Adres/Fatura Snapshot)

> **Bu doküman BAĞLAYICIDIR.** Aşağıdaki kararlar `docs/architecture/openapi.yaml` ile birlikte
> tek doğru kaynaktır (single source of truth). Bir ajan bu dokümanla çelişen bir şey yapmak
> zorunda kaldığını düşünüyorsa **kod yazmadan önce architect'e eskale eder** (bkz.
> `.claude/CLAUDE.md` "Çakışma Çözümü").

Branş: `feature/checkout-redesign`
Commit formatı: Conventional Commits (`feat(checkout): ...`, `feat(db): ...`, `fix(checkout): ...`)

---

## 1. Kapsam

**İÇİNDE:**
- `Order` üzerine teslimat adresi + fatura bilgisi SNAPSHOT kolonları (db-agent).
- `POST /checkout/session` gövdesinin adres/fatura/yasal onayla genişletilmesi (backend-agent).
- `/checkout` sayfasının 2 sütunlu (form + sticky sipariş özeti) akışa dönüştürülmesi
  (ui-designer + frontend-agent).
- TCKN/VKN/posta kodu doğrulama yardımcıları + birim testleri (backend-agent).
- KVKK değerlendirmesi ve yasal onay metni akışı (compliance-agent).

**DIŞINDA (bu fazda YAPILMAZ — yapan ajan durur ve architect'e sorar):**
- "Adres defterinden seç" (`GET /users/me/addresses` entegrasyonu). Kontrat buna HAZIR
  tutuldu (§4.2) ama UI/akış bu fazda eklenmez.
- `User.phone` alanı eklemek. Telefon yalnızca sipariş snapshot'ında yaşar.
- Ayrı bir "sipariş taslağı" (`POST /orders` draft) + confirm akışı (gerekçe §3.1).
- Stripe adres/ödeme yüzeyini değiştirmek (`shipping_address_collection`, Payment Elements,
  embedded checkout) — gerekçe §3.2.
- Giden webhook payload'ını (`lib/webhook-order-payload.ts`) genişletmek — gerekçe §7.3.
- `SiteSettings`'e satıcı tüzel kişilik alanları (unvan, MERSİS, ticaret sicil) eklemek —
  §8.2'de açık madde olarak bırakıldı.
- E-fatura/e-arşiv entegrasyonu, kargo firması API'si, adres otomatik tamamlama.

---

## 2. Bugünkü durum (doğrulandı)

| Konu | Bugün | Sonra |
|---|---|---|
| Adres toplama | Stripe Hosted Checkout'ta | Bizim `/checkout` sayfamızda |
| `POST /checkout/session` gövdesi | `{ customerEmail, customerName? }` | + `shippingAddress`, `billing`, 2 yasal onay |
| Adres kalıcılığı | Hiçbir yerde (bizde) | `Order` üzerinde denormalize snapshot |
| Kargo hesabı | `lib/shipping.ts::computeShipping` | **DEĞİŞMEZ** |
| Ödeme sağlayıcı yüzeyi | Stripe Hosted Checkout | **DEĞİŞMEZ** |
| Kimlik | `authenticateOptional` (misafir OK) | **DEĞİŞMEZ** |

---

## 3. Mimari kararlar (gerekçeleriyle)

### 3.1 Tek adımlı akış korunur — draft/confirm AÇILMAZ
`POST /checkout/session` **genişletilir**, ayrı bir `POST /orders` (taslak) + `POST
/orders/{id}/confirm` akışı eklenmez.

Gerekçe: iki adım, adres doğrulaması ile fiyat/stok dondurma arasında bir **TOCTOU penceresi**
açar (adres doğrulandıktan sonra, ödeme başlamadan önce stok tükenebilir; bugün bu pencere
YOK). Ayrıca sahipsiz taslakları temizleyecek bir sweeper (`cart-retention.ts` benzeri), ikinci
bir rate-limit yüzeyi ve `OrderStatus`'ta modellenmemiş bir "DRAFT" durumu gerektirir. Kazanç
yok, üç yeni hata sınıfı var. **Reddedildi.**

### 3.2 Stripe yüzeyi DEĞİŞMEZ → sahiplik **backend-agent**'ta kalır
`stripe.checkout.sessions.create` çağrısının parametreleri (mode, line_items, price_data,
customer_email, success_url, cancel_url, metadata) **birebir aynı kalır**.
`shipping_address_collection`/`billing_address_collection` **AÇILMAZ** (adresi artık biz
topluyoruz; ikisi birden açık olursa kullanıcı adresi iki kez girer ve iki kaynak ayrışır).

Ajan haritasında ödeme sağlayıcı entegrasyonları integration-agent'a aittir; ancak bu görev
**hiçbir sağlayıcı yüzeyine dokunmuyor** — yalnızca sipariş verisini zenginleştiriyor.
`checkout.routes.ts`'in git geçmişi de backend-agent'ın uygulama katmanı işi olduğunu
gösteriyor. Gereksiz devir maliyeti yaratmamak için: **backend-agent yürütür.**

> **Tripwire (bağlayıcı):** backend-agent kendini şu dosyalardan birini değiştirirken bulursa
> **DURUR** ve integration-agent'a devreder: `backend/src/lib/stripe.ts`,
> `backend/src/modules/webhooks/**`. Aynı şekilde `stripe.checkout.sessions.create`
> çağrısına YENİ bir parametre eklemek gerekiyorsa da durur.

### 3.3 Adres/fatura = `Order` üzerinde DENORMALİZE KOLONLAR
JSON blob DEĞİL, `Address` tablosuna FK DEĞİL.

Gerekçe: `OrderItem`'ın fiyat/başlık snapshot felsefesiyle aynı — adres sonradan
değişse/silinse bile sipariş bozulmamalı. Düz kolonlar Prisma tip güvenliği, Zod şema
üretimi ve admin tarafında filtreleme/sıralama imkânı verir; JSON blob bunların hiçbirini
vermez (projede `Json` yalnızca gerçekten şekilsiz veri için kullanılıyor:
`Product.variantOptions`). Şemada zaten yoğun denormalizasyon var, tutarlıdır.

### 3.4 `sameAsShipping` SAKLANMAZ — sunucu adresi MATERYALİZE eder
İstek gövdesinde `billing.sameAsShipping: true` gelirse backend, teslimat adresi kolonlarını
fatura adresi kolonlarına **kopyalar**. Bayrak DB'ye yazılmaz, `Order` DTO'sunda dönmez.

Gerekçe: bayrağı saklamak, her tüketiciyi (admin sipariş detayı, fatura çıktısı, e-posta
şablonu, ileride e-arşiv entegrasyonu) "eğer sameAsShipping ise şuradan oku" koşulunu
TEKRAR ETMEYE zorlar; bir tüketici unutursa fatura yanlış adresle basılır. 9 kısa nullable
kolonun kopyalanmasının maliyeti ihmal edilebilir, doğruluk kazancı büyüktür.

### 3.5 Yasal onaylar boolean DEĞİL, ZAMAN DAMGASI olarak saklanır
`distanceSalesApprovedAt` / `preliminaryInfoApprovedAt` (`DateTime?`). Onayın ispat yükü
satıcıdadır; "onaylandı mı?" sorusunun cevabı `!= null`, "ne zaman?" sorusunun cevabı da
aynı kolonda durur. İki ayrı checkbox (mevzuat ikisini ayrı ister), tek kutuda
BİRLEŞTİRİLMEZ.

### 3.6 Yasal metin UYDURULMAZ
Sözleşme gövdesi **admin tarafından yazılan `Page.isLegalDocument` içeriğidir**; platform
hukuki metin üretmez (mevcut `frontend/src/lib/legal-pages.ts` precedent'i, PDP "İade &
Garanti" sekmesi ile AYNI kural). Dinamik kısım (alıcı adı/adresi/fatura tipi/satır
kalemleri/kargo/toplam) frontend'in ürettiği **ayrı bir "Sipariş Özeti" paneli** olarak,
bağlantı verilen sözleşme metninin ÜSTÜNDE gösterilir.

`{{alici_adi}}` gibi bir **placeholder/templating motoru v1'de AÇILMAZ** — admin içeriğinde
şablon değişkeni ayrıştırmak yeni bir alt sistemdir (parser, XSS/escape yüzeyi, i18n) ve
compliance-agent bunun semantiğini henüz onaylamadı. İlgili hukuki sayfa hiç yoksa: checkbox
yine render edilir, ama **kırık/uydurma bir bağlantı VERİLMEZ** (link atlanır) —
`resolveReturnsPolicyPage`'in `null` dönüş davranışıyla aynı felsefe.

---

## 4. Veri modeli (db-agent — TEK SAHİP)

### 4.1 Yeni enum
```prisma
enum BillingType {
  INDIVIDUAL
  CORPORATE
}
```

### 4.2 `model Order` — yeni kolonlar

**TÜMÜ `?` (nullable).** Gerekçe: bu özellikten ÖNCE oluşmuş siparişlerde adres hiç yoktur
(Stripe'ta toplanıyordu); `NOT NULL` + backfill, gerçekte var olmayan bir veriyi uydurmak
demektir. Zorunluluk **uygulama katmanında** (Zod) uygulanır — bu, projenin mevcut
`trackingNumber` desenidir (`SHIPPED`'de zorunlu, DB'de nullable, CHECK constraint YOK).

```prisma
  // --- Teslimat adresi SNAPSHOT'ı (bkz. .claude/architect-scope-checkout-redesign.md §3.3)
  shippingAddressFullName     String?
  shippingAddressPhone        String?
  shippingAddressCountry      String?   // 2 harf, "TR"
  shippingAddressCity         String?
  shippingAddressDistrict     String?
  shippingAddressNeighborhood String?
  shippingAddressLine1        String?
  shippingAddressLine2        String?
  shippingAddressPostalCode   String?

  // --- Fatura bilgisi SNAPSHOT'ı
  billingType                 BillingType?
  billingCompanyName          String?   // yalnızca CORPORATE
  billingTaxOffice            String?   // yalnızca CORPORATE, opsiyonel
  billingTaxNumber            String?   // VKN, yalnızca CORPORATE
  billingNationalId           String?   // TCKN, yalnızca INDIVIDUAL + opsiyonel — PII, bkz. §7
  billingAddressFullName      String?
  billingAddressPhone         String?
  billingAddressCountry       String?
  billingAddressCity          String?
  billingAddressDistrict      String?
  billingAddressNeighborhood  String?
  billingAddressLine1         String?
  billingAddressLine2         String?
  billingAddressPostalCode    String?

  // --- Yasal onay kanıtı (bkz. §3.5)
  distanceSalesApprovedAt     DateTime?
  preliminaryInfoApprovedAt   DateTime?
```

**İsimlendirme kuralı:** adres alt-alanları `Address` modelinin alan adlarıyla BİREBİR
eşleşir (`fullName` → `shippingAddressFullName`), böylece ileride "adres defterinden seç"
geldiğinde dönüşüm katmanı gerekmez. `shippingCents`/`shippingCarrier`/`shippedAt` ile
karışmaması için adres kolonları **istisnasız `shippingAddress` önekiyle** yazılır.

**Yeni index EKLENMEZ.** Hiçbir sorgu bu alanlar üzerinden filtrelemiyor; index eklemek boşuna
yazma maliyeti üretir.

### 4.3 Migration
- Tek migration: `feat(db): add order shipping/billing snapshot columns`.
- Yalnızca `ADD COLUMN` (+ `CREATE TYPE "BillingType"`). Backfill YOK, veri kaybı YOK,
  geri alınabilir.
- `Address` modeli, `SiteSettings` ve diğer hiçbir model **DEĞİŞMEZ**.
- `schema.prisma` satır ~2071-2076'daki "v1'de checkout adresi Stripe tarafından toplanır"
  yorumu artık YANLIŞ — db-agent bu yorumu bu dokümana referans verecek şekilde günceller.

---

## 5. Backend kontratı (backend-agent)

### 5.1 Endpoint
`POST /checkout/session` — **tek endpoint, genişletilir.** Yeni endpoint YOK. Rate limit
(10/dk), `requireModuleEnabled("products")`, `authenticateOptional`, 409 fiyat/stok taze
okuma mantığı **aynen korunur**.

Kesin request/response şekli: `docs/architecture/openapi.yaml` →
`CartCheckoutSessionRequest`, `CheckoutAddressInput`, `CheckoutBillingInput`, `BillingType`,
`Order`, `OrderAddressSnapshot`, `OrderBillingSnapshot`.

### 5.2 Zod doğrulama kuralları (`checkout.schemas.ts`)

| Alan | Kural | Hata mesajı (Türkçe, kullanıcıya gösterilir) |
|---|---|---|
| `customerEmail` | `.email().max(254)` | "Geçerli bir e-posta adresi girin." |
| `customerName` | `min(1).max(200)`, opsiyonel | — |
| `*.fullName` | `min(1).max(120)` | "Ad soyad zorunludur." |
| `*.phone` | `/^[0-9+()\-\s]{7,20}$/` | "Geçerli bir telefon numarası giriniz." |
| `*.country` | `length(2).toUpperCase()`, default `"TR"` | "İki harfli ülke kodu olmalıdır (ör. TR)." |
| `*.city` / `*.district` / `*.neighborhood` | `min(1).max(100)` | "Bu alan zorunludur." |
| `*.addressLine1` / `*.addressLine2` | `min(1).max(200)` | "Adres zorunludur." |
| `*.postalCode` | opsiyonel; `country === "TR"` ise `/^\d{5}$/`, değilse `max(20)` | "Posta kodu 5 haneli olmalıdır." |
| `billing.billingType` | `z.enum(["INDIVIDUAL","CORPORATE"])` | — |
| `billing.companyName` | `min(1).max(200)` | "Kurumsal fatura için firma unvanı zorunludur." |
| `billing.taxOffice` | `min(1).max(100)`, opsiyonel | — |
| `billing.taxNumber` | `/^\d{10}$/` — **checksum YOK** | "Vergi numarası 10 haneli olmalıdır." |
| `billing.nationalId` | `/^[1-9]\d{10}$/` **+ TCKN checksum** | "Geçerli bir T.C. kimlik numarası giriniz." |
| `distanceSalesApproved` | `z.literal(true)` | "Mesafeli Satış Sözleşmesi'ni onaylamanız gerekir." |
| `preliminaryInfoApproved` | `z.literal(true)` | "Ön Bilgilendirme Formu'nu onaylamanız gerekir." |

**Telefon/adres kuralları `users.schemas.ts`'teki adres primitifleriyle BİREBİR aynı
tutulur** (kopyalama, `readShippingSettings` precedent'iyle aynı gerekçeyle kabul edilebilir;
ya da backend-agent isterse ortak bir `schemas/address-fields.ts`'e çıkarır — **iki kural
setinin AYRIŞMAMASI** şarttır, mekanizma serbesttir). Katı bir TR/E.164 telefon kuralı
BİLİNÇLİ olarak konmaz: adres defteriyle kural ayrışması, ileride oradan doldurulan adreslerin
422 almasına yol açardı.

**Neden TCKN'de checksum var, VKN'de yok:** TCKN algoritması resmî, kapalı ve istisnasızdır
(yanlış reddetme riski ~0). VKN checksum'ı ise istisnai/eski numaralarda tutmayabilir —
gerçek bir müşteriyi ödeme sayfasında bloklama riski, kazanılan faydadan büyüktür.

**`superRefine` koşullu kuralları (hepsi 422):**
1. `CORPORATE` → `companyName` ve `taxNumber` ZORUNLU.
2. `CORPORATE` → `nationalId` gönderilirse REDDEDİLİR.
3. `INDIVIDUAL` → `companyName` / `taxOffice` / `taxNumber` gönderilirse REDDEDİLİR.
4. `sameAsShipping !== false` → `billing.address` gönderilirse REDDEDİLİR.
5. `sameAsShipping === false` → `billing.address` ZORUNLU.

Kural 2 ve 3'ün "yasak" olması bilinçlidir: aksi halde kurumsal bir siparişte anlamsız bir
TCKN sessizce saklanır — KVKK veri minimizasyonu ihlali.

`error.details` anahtarları Zod `issue.path.join(".")` ile üretilir
(`plugins/error-handler.ts::flattenZodIssues`), yani `billing.taxNumber`,
`shippingAddress.postalCode`. **Frontend form alan adları bu anahtarlarla birebir aynı
olmalıdır** (§6.3).

### 5.3 Handler davranışı
1. Doğrulama → sepet okuma → **taze fiyat/stok okuma (DEĞİŞMEZ)** → `computeShipping`
   (DEĞİŞMEZ) sırası korunur.
2. `customerName` gönderilmediyse `shippingAddress.fullName` kullanılır.
3. `sameAsShipping !== false` ise teslimat adresi fatura adresi kolonlarına kopyalanır (§3.4).
4. `distanceSalesApprovedAt` / `preliminaryInfoApprovedAt` = `new Date()` (istekten gelen
   herhangi bir zaman damgası KABUL EDİLMEZ).
5. Stripe çağrısı ve `emitWebhookEvent("ORDER_CREATED", ...)` **aynen kalır**.
6. Yanıt yalnızca `{ checkoutUrl }` — `orderId`/`orderNumber` **eklenmez** (public + kimliksiz
   uçta ödeme öncesi tanımlayıcı sızdırmak numaralandırma yüzeyi açar).

### 5.4 Yeni yardımcı dosya
`backend/src/lib/tr-identity.ts` — saf fonksiyonlar, DB/IO YOK:
- `isValidTcKimlikNo(value: string): boolean` (11 hane, ilk hane ≠ 0, resmî checksum)
- `isValidTrPostalCode(value: string): boolean` (`^\d{5}$`)

Birim testi ZORUNLU (`backend/tests/**`): geçerli/geçersiz TCKN, `00000000000`, 10/12 hane,
harf içeren girdi, sıfırla başlayan.

### 5.5 DTO/serileştirme
- `backend/src/schemas/entities.ts::OrderSchema` → `shippingAddress` ve `billing` iç içe
  nesneleri eklenir (`nullable()`; eski siparişlerde `null`).
- Düz Prisma kolonları → iç içe DTO eşlemesi **`toOrderDto`'da TEK yerde** yapılır; her route
  kendi eşlemesini yazmaz.
- `pii-mask.ts` → `maskNationalId(value)` eklenir (`123*****901` biçimi, `maskEmail` deseni).
- `GET /admin/orders` (liste) → `billing.nationalId` **maskelenir**;
  `GET /admin/orders/{orderId}` (detay) → **maskesiz** (mevcut `customerEmail` kararıyla
  aynı: "liste maskeli, detay açık" — admin fatura kesmek için gerçek numaraya ihtiyaç duyar).
- `GET /users/me/orders*` → kullanıcının kendi verisi, **maskelenmez**.
- `lib/webhook-order-payload.ts` **DEĞİŞMEZ** (§7.3).

---

## 6. Frontend (ui-designer → frontend-agent)

### 6.1 ui-designer (ÖNCE — frontend-agent'ı bloklar)
`.claude/design-notes-checkout-redesign.md` üretir; kod yazmaz. Kapsam:
- 2 sütun kırılma noktası ve oranı (öneri: `lg` altında tek sütun; `lg` üstünde
  `[minmax(0,1fr)_380px]`), sağ sütun `lg:sticky lg:top-24`.
- Bölüm başlığı / kart / alan grubu ritmi (mevcut `Card`, `Field`, `Input`, `Alert`, `Button`
  primitifleri **yeniden kullanılır, yenisi icat edilmez**).
- Bireysel/Kurumsal seçici paterni (segmented control mi radio grubu mu — **karar
  ui-designer'ın**), `sameAsShipping` checkbox'ının konumu.
- Sipariş özeti kartı: satır kalemleri, ara toplam / kargo / toplam hiyerarşisi, mevcut
  `free-shipping-progress.tsx` bileşeninin buradaki yerleşimi.
- Yasal onay satırlarının ve "Ön Bilgilendirme Özeti" modalının görsel dili.
- Mobilde CTA'nın konumu (sticky alt bar mı, akış içinde mi).
- Hata/odak durumları; `Field`'ın mevcut hata görünümü dışında yeni bir hata stili
  tanımlanmaz.

### 6.2 frontend-agent
> **ZORUNLU ÖN ADIM:** `frontend/AGENTS.md` gereği, kod yazmadan önce
> `frontend/node_modules/next/dist/docs/` altındaki ilgili rehber okunacak — bu sürüm
> eğitim verisindeki Next.js DEĞİLDİR.

Dosyalar:
- `frontend/src/app/[lang]/(site)/checkout/page.tsx` — yeniden yazılır (client component,
  tek `<form>`; **submit butonu sağ sütunda ama AYNI form elementinin içinde** — iki ayrı
  form olursa react-hook-form durumu bölünür).
- `frontend/src/components/site/checkout/` (yeni klasör):
  `contact-section.tsx`, `shipping-address-section.tsx`, `billing-section.tsx`,
  `order-summary-card.tsx`, `legal-consent-section.tsx`, `preliminary-info-modal.tsx`.
- `frontend/src/lib/api/types.ts` — `CreateCartCheckoutSessionRequest` genişletilir;
  `OrderAddressSnapshot` / `OrderBillingSnapshot` tipleri + `Order` alanları eklenir.
- `frontend/src/lib/api/checkout.ts` — imza tipi güncellenir (çağrı gövdesi aynı kalır).
- `frontend/src/lib/legal-pages.ts` — `resolveDistanceSalesPage` /
  `resolvePreliminaryInfoPage` eklenir (mevcut anahtar kelime sezgisi deseni:
  `mesafeli|satış sözleşmesi`, `ön bilgilendirme`; eşleşme yoksa `null` → link gösterilmez).

Kurallar:
- **Para matematiği frontend'de TEKRARLANMAZ.** Ara toplam / kargo / toplam doğrudan
  `cart.subtotalCents`, `cart.shipping`, `cart.totalCents`'ten okunur (bu alanlar zaten var,
  yeni endpoint GEREKMEZ). `cart.shipping.configured === false` ise kargo satırı hiç
  render edilmez.
- Zod form şeması backend kurallarının **AYNADIR** — ıraksarsa `openapi.yaml` hakemdir.
  TCKN checksum'ı frontend'de de çalıştırılabilir (UX), ama backend doğrulaması TEK
  otoritedir.
- Üye kullanıcıda **yalnızca** e-posta ve ad soyad ön doldurulur (`/users/me`). Telefon
  ön doldurulamaz (`User.phone` YOK). **Adres defterinden seçme UI'ı EKLENMEZ** (§1).
- 422 yanıtındaki `error.details` anahtarları react-hook-form alan yollarıyla birebir
  eşleşir → `setError(key, { message })` ile alan altına basılır; genel hata (`409`)
  mevcut `Alert` ile üstte gösterilir.
- Yönlendirme `window.location.assign(checkoutUrl)` olarak KALIR (harici Stripe domaini;
  `.href` ataması react-compiler kuralına takılıyor — mevcut yorum korunur).
- Metinler Türkçe hardcoded (mevcut sayfanın deseni) — **SEO/meta tag EKLENMEZ**; checkout
  zaten `noindex` olması gereken bir sayfadır, gerekiyorsa seo-agent'a devredilir.

---

## 7. Güvenlik & KVKK

### 7.1 security-agent
- Yeni alanlar public + kimliksiz bir uca girdiği için **hepsinin üst sınırı olmalı**
  (mevcut "sınırsız string = DoS vektörü" kararının devamı) — §5.2 tablosunu denetler.
- Rate limit 10/dk **düşürülmez/yükseltilmez**.
- Adres/fatura alanları yalnızca DB'ye ve (adres olmadan) Stripe'a gider; hiçbiri log'a
  yazılmaz (`observability-agent` ile birlikte doğrulanır).
- 422 mesajları hiçbir iç bilgi (kolon adı, SQL, Stripe hata metni) sızdırmaz.

### 7.2 compliance-agent (BLOKLAYICI — release öncesi karar vermeli)
1. **TCKN (`billingNationalId`) KVKK değerlendirmesi:** toplama hukuki dayanağı, opsiyonel
   olmasının yeterliliği, saklama süresi, maskeleme kararının (§5.5) onayı.
2. **VKN/firma unvanı**: tüzel kişi verisi — kişisel veri sayılıp sayılmadığı.
3. **Aydınlatma metni**: checkout formunda hangi metnin/nereye bağlantının gösterileceği.
4. **Onay kanıtı**: `distanceSalesApprovedAt`/`preliminaryInfoApprovedAt`'ın ispat için
   yeterli olup olmadığı; **onaylanan metnin SÜRÜMÜNÜN saklanmaması bilinen bir boşluktur**
   (§8.1) — kabul edilebilir mi, yoksa `Page` revizyon id'si snapshot'lanmalı mı?
5. `schema.prisma` satır ~1980'deki "adres/telefon v1 kapsamı dışında bilinçli olarak
   toplanmıyor — yeni bir alan eklenmeden önce compliance-agent'a danışılmalı" notu tam
   olarak bu durumu işaret ediyor: **bu danışma zorunludur.**
6. Silme talebi akışının güncellenmesi: manuel anonimleştirmede artık adres/telefon/TCKN
   kolonları da temizlenmelidir (tutar/`OrderItem` kalır).

### 7.3 Giden webhook payload'ı DEĞİŞMEZ
`WebhookOrderPayload` versiyonlu bir PUBLIC kontrattır; alan eklemek integration-agent'ın
kararıdır ve hiçbir tüketici bunu talep etmedi. TCKN/VKN'nin oraya sızmaması ayrıca
kritiktir. Adres bilgisinin webhook'a eklenmesi ileride ayrı bir görev olarak
integration-agent'a açılır.

---

## 8. Bilinen boşluklar (bilinçli, takip gerektirir)

1. **Onaylanan sözleşme metninin sürümü saklanmıyor.** Admin metni sonradan değiştirirse
   "müşteri hangi metni onayladı?" cevaplanamaz. Öneri (bu fazda DEĞİL): `Page` revizyon
   id'sini `Order`'a snapshot'lamak. Karar compliance-agent'ta.
2. **`SiteSettings`'te satıcı tüzel kişilik bilgisi yok** (unvan, adres, MERSİS, ticaret
   sicil no, KEP). Mesafeli satış sözleşmesinin satıcı tarafı v1'de `siteName` + iletişim
   sayfasıyla temsil edilir. Gerçek bir üretim kullanımı için db-agent + compliance-agent
   ortak bir takip görevi açmalıdır.
3. **`User.phone` yok** — üye kullanıcı her siparişte telefonunu yeniden yazar. "Adres
   defterinden seç" özelliği geldiğinde bu sorun kendiliğinden çözülür.
4. VKN checksum doğrulaması yok (§5.2 gerekçe).

---

## 9. Ajan görev dağılımı ve dosya sahipliği

Sıralama/bağımlılık planı **release-coordinator** tarafından netleştirilecektir. Aşağıdaki
tablo *kimin neye dokunacağını* sabitler — **listede olmayan bir dosyaya dokunmak isteyen
ajan önce architect'e sorar.**

| # | Ajan | Dosyalar | Bağımlılık |
|---|---|---|---|
| 1 | **db-agent** | `backend/prisma/schema.prisma` (enum `BillingType` + `Order` kolonları + satır ~2071 yorumu), `backend/prisma/migrations/**` | — (ilk) |
| 1b | **ui-designer** | `.claude/design-notes-checkout-redesign.md` | — (1 ile paralel) |
| 2 | **backend-agent** | `backend/src/modules/checkout/checkout.schemas.ts`, `checkout.routes.ts`, `backend/src/lib/tr-identity.ts` (YENİ), `backend/src/lib/pii-mask.ts`, `backend/src/schemas/entities.ts`, `backend/src/modules/orders/orders.routes.ts` (yalnızca maskeleme), `backend/tests/unit/tr-identity.test.ts` (YENİ), `backend/tests/integration/checkout.test.ts` | 1 |
| 3 | **frontend-agent** | `frontend/src/app/[lang]/(site)/checkout/page.tsx`, `frontend/src/components/site/checkout/**` (YENİ), `frontend/src/lib/api/types.ts`, `frontend/src/lib/api/checkout.ts`, `frontend/src/lib/legal-pages.ts` | 1b + kontrat (2 ile paralel) |
| 4 | **security-agent** | denetim (kod yazmaz) | 2, 3 |
| 5 | **compliance-agent** | `.claude/compliance-notes-checkout-redesign.md` | 2 (§7.2 BLOKLAYICI) |
| 6 | **code-quality-agent** | lint/format/PR checklist | 2, 3 |
| 7 | **qa-agent** | `frontend/tests/e2e/**` (Playwright `testDir`) | 2, 3 |
| 8 | **documentation-agent** | `docs/architecture/ARCHITECTURE.md` §10.9.3, `CHANGELOG.md`, README | 2, 3 |
| 9 | **devops-agent** | CI + `docker compose up --build -d` | hepsi |

**DOKUNULMAZ dosyalar (bu görev kapsamında):** `backend/src/lib/shipping.ts`,
`backend/src/lib/stripe.ts`, `backend/src/modules/webhooks/**`,
`backend/src/lib/webhook-order-payload.ts`, `backend/src/modules/cart/cart.routes.ts`,
`backend/src/modules/users/users.routes.ts`.

### qa-agent kapsamı (kritik senaryolar)
1. Misafir + bireysel (TCKN'siz) + `sameAsShipping: true` → Stripe'a yönlenir, `Order`
   snapshot kolonları dolu, fatura adresi teslimat adresinin kopyası.
2. Misafir + kurumsal + ayrı fatura adresi → doğru kolonlar dolu.
3. Kurumsal ama `taxNumber` eksik → 422, hata alanın ALTINDA görünüyor (`billing.taxNumber`).
4. Yasal onay kutuları işaretlenmemiş → CTA submit etmiyor / 422.
5. Geçersiz TCKN (checksum tutmayan 11 hane) → 422.
6. Üye kullanıcı → e-posta/ad ön dolu, telefon BOŞ, sipariş `siteUserId` ile ilişkili.
7. Sepet boşken `/checkout` → mevcut boş durum ekranı (regresyon).
8. Stok tükenmiş ürün → 409, Türkçe mesaj üstte `Alert`'te (regresyon).
9. `shippingFlatFeeCents = null` → özet kartında kargo satırı HİÇ yok (regresyon).
10. Mobil (tek sütun) ve masaüstü (2 sütun + sticky özet) yerleşimi.
