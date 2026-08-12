# Architect Scope — Çok Dillilik (i18n)

> **Durum:** Karar verildi, uygulamaya hazır.
> **Kapsam:** Admin paneli arayüz dili + public site içerik çevirisi.
> **İlgili dokümanlar:** `docs/architecture/ARCHITECTURE.md` §10.5, `docs/architecture/openapi.yaml`
> (bu görevde GÜNCELLENDİ), `backend/prisma/schema.prisma`.
> **Bu doküman bağlayıcıdır.** Ajanlar arası çelişkide `openapi.yaml` + bu doküman hakemdir.

---

## 0. Yönetici özeti — "sıfırdan başlamıyoruz"

Görev "i18n desteği eklenecek" diye geldi, ancak kod tabanında **kısmen uygulanmış ve
yarım kalmış** bir i18n katmanı ZATEN VAR. En kritik mimari tespit budur: yeni bir
sistem tasarlamak yerine **mevcut yarım sistemi tamamlamak** doğru karardır.

| Katman | Mevcut durum | Değerlendirme |
|---|---|---|
| `Page.translations` JSON | VAR (`@default("{}")`) | Kullanılabilir, korunacak |
| `BlogPost.translations` | VAR | Korunacak |
| `Product.translations` | VAR ama **okunamıyor** | Yazma var, okuma yolu YOK |
| `PortfolioItem.translations` | VAR ama **okunamıyor** | Yazma var, okuma yolu YOK |
| Backend `applyLocale()` | Yalnızca Page + BlogPost | Product/Portfolio'da EKSİK |
| `?locale=EN` query | Yalnızca `/pages/{slug}`, `/blog/{slug}` | Product/Portfolio'da YOK |
| Admin çeviri editörü (UI) | Yalnızca `pages/[pageId]`, `blog/[postId]` | Product/Portfolio'da YOK |
| Admin panel UI dili | `I18nProvider` + `useT()` VAR | **Fiilen ölü kod** (aşağıya bkz.) |
| Public site locale | **HİÇ YOK** | EN içerik ziyaretçiye ULAŞMIYOR |
| Dil başına slug | **YOK** | Tek `slug` kolonu, tek dil |
| hreflang / çok dilli sitemap | **YOK** | — |
| Import'ta dil alanı | **YOK** | Parser'lar `lang` okumuyor |
| `openapi.yaml`'da public `/pages`, `/blog` | **TANIMSIZDI** | Sözleşme boşluğu — bu görevde kapatıldı |

### 0.1 En önemli iki tespit

**(a) Header'daki "TR" göstergesi teknik olarak çalışıyor ama pratikte anlamsız.**
`frontend/src/components/admin/topbar.tsx` gerçek bir `useAdminLocale()` state'i tutuyor,
`localStorage`'a yazıyor ve `useT()` ile sözlükten okuyor — yani "sadece görsel" DEĞİL.
Ancak:
- Sözlük (`frontend/src/lib/i18n/dictionaries.ts`) **toplam 11 anahtar** içeriyor.
- `useT()` tüm kod tabanında **yalnızca `topbar.tsx`'te** çağrılıyor.
- Sözlükteki `nav.*` anahtarları (Sayfalar, Blog, Medya...) **hiç kullanılmıyor** —
  `sidebar.tsx` etiketleri sabit Türkçe string olarak gömüyor
  (`{ href: "/admin/pages", label: "Sayfalar", ... }`).

Sonuç: dil değiştirici tıklanınca ekranda **yalnızca 2 kelime** ("Çıkış yap", "Dil")
değişiyor. Kullanıcının "bu gerçekten çalışıyor mu?" şüphesi HAKLI. Altyapı doğru,
**içi boş**.

**(b) `Product`/`PortfolioItem` çevirileri yazılabiliyor ama okunamıyor.**
`products.routes.ts` ve `portfolio.routes.ts` PATCH'te `translations` shallow-merge
yapıyor (satır ~261 ve ~231), sanitize ediyor, DB'ye yazıyor — ama public GET'te
`applyLocale()` **yok** ve `locale` query parametresi **tanımlı değil**. Yani veri
yazılıp gömülüyor. Bu bir veri kaybı değil ama **sessiz bir işlevsizlik**; backend-agent
için 1 numaralı öncelik.

---

## 1. KARAR: İçerik çeviri veri modeli — **Hibrit (JSON alanlar + ilişkisel slug tablosu)**

### 1.1 Karar

- **Çevrilebilir ALANLAR** (title, seoTitle, contentHtml, blocks...) → mevcut
  `translations Json` kolonunda kalır. **Ayrı Translation tablosu AÇILMAZ.**
- **Slug'lar** → yeni, ince bir ilişkisel tablo: **`ContentSlug`**.

Bu ikisi farklı problemlerdir ve farklı çözümleri hak eder. Tek bir modele zorlamak
(hepsi JSON veya hepsi tablo) her iki durumda da kayıp verdirir.

### 1.2 Neden alanlar JSON'da kalıyor

1. **Zaten uygulanmış ve çalışıyor.** 4 model, 4 sanitize modülü (`sanitize-blocks.ts`,
   3× `sanitize-content.ts`), 4 PATCH merge yolu, `ContentRevision` snapshot'ları ve
   2 admin editör ekranı bu şekle bağlı. Translation tablosuna geçiş bunların **hepsini**
   yeniden yazmak demek — karşılığında bu ölçekte kazanç yok.
2. **"Yeni dil = şema değişikliği yok" kriteri doğrudan karşılanıyor.** Yeni bir dil
   yalnızca yeni bir JSON anahtarıdır. Translation tablosu da bunu sağlardı, ama JSON
   bunu *bedavaya* sağlıyor.
3. **Çevrilebilir alan kümesi entity'ye göre farklı** (Page'de `blocks`, BlogPost'ta
   `contentHtml`, Product'ta `descriptionHtml`, Portfolio'da `summary`). İlişkisel bir
   Translation tablosu ya entity başına ayrı tablo (4 tablo) ya da EAV
   (`field_name`/`field_value`) gerektirirdi. EAV, `blocks` gibi yapılandırılmış JSON
   dizilerini string'e serialize etmeye zorlar — bu bir gerileme olurdu.
4. **Okuma paterni JSON'a uygun.** İçerik HER ZAMAN tek bir kayıt olarak, tüm alanlarıyla
   birlikte çekiliyor (detay sayfası). Alan bazında sorgu/filtre ihtiyacı YOK. Translation
   tablosu her okumaya bir JOIN eklerdi, hiçbir sorguyu hızlandırmadan.
5. **Prisma + PostgreSQL `Json` = `jsonb`.** GIN indeksleme ve ifade indeksleri mümkün;
   ileride gerekirse çıkış yolu açık.

### 1.3 Neden slug'lar JSON'da KALAMAZ (kritik gerekçe)

Slug'ı `translations.en.slug` içine koymak cazip ama **üç sert duvara** çarpar:

1. **Benzersizlik zorlanamaz.** İki farklı sayfa `translations.en.slug = "about"` yazarsa
   veritabanı bunu ENGELLEYEMEZ. Prisma `@unique` bir JSON alt-anahtarına uygulanamaz.
   Sonuç: iki içerik aynı URL'yi talep eder, routing belirsizleşir. Bu **veri bütünlüğü**
   sorunudur, kozmetik değil.
2. **Ters arama (slug → içerik) indekslenemez.** Routing'in temel sorgusu tam olarak
   budur: `/en/about` geldiğinde "bu slug hangi kayda ait?". JSON ile bu, tablo taraması
   (`WHERE translations->'en'->>'slug' = 'about'`) olur.
3. **İfade indeksi çözümü kabul kriterini İHLAL EDER.** (2)'yi çözmek için
   `CREATE INDEX ... ((translations->'en'->>'slug'))` yazılabilir — ama bu indeks **dile
   özeldir**. Yeni dil = yeni indeks = yeni migration. Bu, "yeni dil eklemek şema
   değişikliği gerektirmemeli" kriterini doğrudan bozar.

`ContentSlug` tablosu üçünü birden çözer: `@@unique([locale, slug])` benzersizliği DB
seviyesinde garanti eder, indeks dilden bağımsızdır (yeni dil = yeni SATIR), ve arama
O(log n)'dir.

### 1.4 `ContentSlug`'ın ikinci görevi: "çevrildi mi?" indeksi

Bir içeriğin belirli bir dilde gerçekten çevrilip çevrilmediğini bilmek gerekiyor
(fallback ve SEO kuralları için, bkz. §5-6). Bunun için içerik tablolarına ekstra bir
`isTranslated` kolonu **EKLENMEZ**. Kural:

> Bir içerik, `L` dili için bir `ContentSlug` satırı VARSA o dilde çevrilmiş sayılır.

Backend, `translations.L` içine anlamlı bir çeviri (en azından `title`) yazıldığında bu
satırı otomatik oluşturur/günceller; çeviri silinince satırı siler. Böylece "hangi
içerikler EN'de yayında?" sorusu tek, indeksli bir sorguya iner — sitemap üretimi için
kritik.

---

## 2. Prisma şema taslağı (db-agent uygular)

> Aşağıdaki taslak **niyeti** tanımlar. Alan adları ve indeksler bağlayıcıdır; Prisma
> sözdizimi/format detayı db-agent'ın sorumluluğundadır.

### 2.1 Yeni model: `Locale`

```prisma
/// §10.5 Çoklu Dil — desteklenen diller VERİDİR, kod sabiti DEĞİL.
/// Yeni dil eklemek = yeni SATIR. Migration/deploy GEREKTİRMEZ (kabul kriteri).
model Locale {
  /// BCP-47, HER ZAMAN küçük harf ("tr", "en", "de", "en-gb"). Birincil anahtar —
  /// oluşturulduktan sonra DEĞİŞTİRİLEMEZ (URL uzayının ve ContentSlug'ın kimliği).
  code        String   @id
  /// Panelde gösterilen ad (panel dilinde) — ör. "İngilizce".
  label       String
  /// Dilin kendi adı — site dil değiştiricide BU gösterilir ("English").
  nativeLabel String
  /// Kanonik dil. TAM OLARAK BİR satır true olabilir (aşağıdaki partial unique index).
  /// Bu dil URL'de prefix ALMAZ ve içerik tablolarının kanonik kolonlarında saklanır.
  isDefault   Boolean  @default(false)
  /// false ise public /locales ve [lang] rota uzayında YOK; çeviriler KORUNUR.
  enabled     Boolean  @default(false)
  sortOrder   Int      @default(0)
  /// hreflang override (ör. code="en" iken "en-GB"). Boşsa `code` kullanılır.
  hreflang    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  contentSlugs ContentSlug[]

  @@index([enabled, sortOrder])
  @@map("locales")
}
```

**Seed (zorunlu, migration ile birlikte):**
`{ code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0 }`
`{ code: "en", label: "İngilizce", nativeLabel: "English", isDefault: false, enabled: true, sortOrder: 1 }`

**Ham SQL gerektiren kısıt** (Prisma şema DSL'i ile ifade edilemez, migration SQL'ine
elle eklenecek):
```sql
CREATE UNIQUE INDEX locales_single_default ON locales (is_default) WHERE is_default = true;
```
Gerekçe: "tam olarak bir varsayılan dil" kuralı uygulama katmanında değil, **veritabanında**
zorlanmalıdır — aksi halde eşzamanlı iki `PATCH /admin/locales/{code}` isteği sistemi iki
varsayılanlı (veya sıfır varsayılanlı) tutarsız bir duruma sokabilir.

### 2.2 Yeni model: `ContentSlug`

```prisma
/// §10.5 — dil başına slug + "bu dilde çeviri var mı?" indeksi.
/// Slug'lar JSON'da TUTULAMAZ (benzersizlik + ters arama + dilden bağımsız indeks
/// ihtiyacı) — gerekçe: .claude/architect-scope-i18n.md §1.3.
model ContentSlug {
  id         String            @id @default(uuid())
  /// Hangi içerik tipi — mevcut ContentEntityType enum'ı YENİDEN KULLANILIR,
  /// yeni bir enum İCAT EDİLMEZ (ortak terminoloji kuralı).
  entityType ContentEntityType
  entityId   String
  locale     String
  slug       String
  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  localeRef Locale @relation(fields: [locale], references: [code], onDelete: Cascade)

  /// URL benzersizliği — AYNI dilde AYNI slug iki kez olamaz.
  /// NOT: entityType DAHİL DEĞİL — /en/about hem bir Page hem bir Product olamaz,
  /// çünkü rota uzayları çakışabilir ve belirsizlik ziyaretçiye yansır.
  @@unique([locale, slug])
  /// Bir içeriğin bir dilde EN FAZLA bir slug'ı olur.
  @@unique([entityType, entityId, locale])
  /// "Bu içeriğin tüm dillerdeki slug'ları" (hreflang/localizations üretimi).
  @@index([entityType, entityId])
  /// "Bu dilde çevrilmiş tüm X'ler" (sitemap üretimi).
  @@index([locale, entityType])
  @@map("content_slugs")
}
```

`onDelete: Cascade` (Locale → ContentSlug): dil silinince slug satırları da gider —
`DELETE /admin/locales/{code}` sözleşmesindeki davranışla tutarlı.

**İçerik silindiğinde:** `ContentSlug`'ın içerik tablolarına FK'si YOKTUR (polimorfik
`entityType`+`entityId` olduğu için mümkün değil). Bu nedenle **backend-agent**, içerik
kalıcı silme (`/permanent`) yollarında ilgili `ContentSlug` satırlarını AYNI transaction
içinde silmekle yükümlüdür. Soft-delete (çöp kutusu) satırları SİLMEZ — geri yükleme
slug'ı korumalıdır.

### 2.3 Mevcut modellerde değişiklik

**`BlogPost`, `Product`, `PortfolioItem`: yapısal değişiklik YOK.**
`translations Json` kolonları aynen kalır. Mevcut `slug String @unique` kolonu da aynen
kalır ve **varsayılan dilin kanonik slug'ı** olarak anlamlandırılır (geriye dönük tam
uyum). Yalnızca `///` yorumları §10.5'in yeni haline göre güncellenir.

**`Page`: TEK bir alan eklenir** (aşağıdaki §2.3.1 — bu maddenin ilk hâli "hiç yapısal
değişiklik yok" diyordu; compliance-agent'ın haklı itirazı üzerine DEĞİŞTİRİLDİ).

#### 2.3.1 KARAR (revizyon — compliance-agent itirazı): `Page.isLegalDocument`

```prisma
/// §5 istisnası — hukuki belge (gizlilik politikası, KVKK aydınlatma metni, çerez
/// politikası, kullanım koşulları, mesafeli satış sözleşmesi...).
/// true ise SESSİZ ÇEVİRİ FALLBACK'İ UYGULANMAZ (KVKK m.10 / GDPR m.12) —
/// gerekçe ve tam davranış: .claude/architect-scope-i18n.md §5.1.
/// YALNIZCA SiteRole=ADMIN değiştirebilir; her değişiklik denetlenir.
isLegalDocument Boolean @default(false)
```

**Neden §2.3'ün ilk hâli yanlıştı:** "yapısal değişiklik yok" kararını, çeviri
davranışının içerik başına farklılaşmayacağı varsayımıyla vermiştim. compliance-agent
bu varsayımı çürüten gerçek bir istisna buldu (§5, hukuki metinler). İstisna hukuken
zorunlu olduğuna göre, kodun onu tanıyabilmesi için bir kanca ŞARTTIR. Kararı savunmak
değil, düzeltmek doğru olan.

**Neden `Page`, sadece `Page`:** bir gizlilik politikası asla bir blog yazısı, ürün veya
portföy öğesi değildir. Bayrağı dört modele birden eklemek spekülatif genellemedir.
Gelecekte gerçekten gerekirse o zaman eklenir.

**Değerlendirilen ve REDDEDİLEN alternatifler:**

| Alternatif | Neden reddedildi |
|---|---|
| **Ayrılmış slug konvansiyonu** (ör. slug `gizlilik-politikasi` ise hukukidir) | **Kendi kendini çürütüyor:** bu özelliğin tamamı slug'ları dile özel ve değişebilir yapıyor. Hukuki semantiği, bu işte bilinçli olarak çoğullaştırdığımız bir alana asmak tutarsız olurdu. Ayrıca editör slug'ı yeniden adlandırdığında koruma sessizce kaybolur — uyumluluk kontrolü **sessizce** bozulmamalıdır. |
| **`SiteSettings`'te sayfa id işaretçileri** (`homePageId` paterni gibi) | Hukuki belge **çoğuldur ve artar** (gizlilik, KVKK, çerez, kullanım koşulları, mesafeli satış...). Her biri için kolon = her yeni belge türü için migration. |
| **`documentType` enum'ı** | Enum'a yeni değer eklemek migration ister — "yeni şey = migration yok" ruhuna aykırı. Bugün ihtiyaç ikili (hukuki/değil); enum bunu karşılamıyor, sadece maliyet ekliyor. |
| **Hiç alan eklemeyip fallback'i tüm `Page`'lerde kapatmak** | Tüm normal sayfaları da vurur; §5'in asıl faydasını (yarı çevrilmiş sayfa > hiç açılmayan sayfa) yok eder. |

**Neden `isLegalDocument` (davranışsal bir ad değil, ör. `translationFallback: NONE`):**
alan adı **niyeti** taşımalı. Bir uyumluluk denetçisi "hangi sayfalar hukuki belgedir?"
diye sorar, "hangi sayfalarda fallback kapalıdır?" diye değil. Ayrıca bu bayrağın
ilerideki muhtemel tüketicileri de hukuki semantiktir (otomatik/AI çeviriden muafiyet,
sürüm geçmişi saklama zorunluluğu, "son güncelleme" tarihi gösterimi, toplu silmeden
koruma). Davranışsal bir ad bunların hepsinde yanlış isim olurdu.

**Bu bir takip migration'ıdır**, `20260812055828_add_locale_and_content_slug`'ın
yeniden yapılması DEĞİL: tek kolon, `@default(false)`, geri doldurma gerektirmez
(mevcut tüm sayfalar doğru şekilde `false` başlar). db-agent ayrıca mevcut gizlilik
politikası sayfasını `true` yapan bir veri adımı ekler (varsa — yoksa admin panelden
işaretlenir).

`SiteSettings`'e `defaultLocale` kolonu **EKLENMEZ** — varsayılan dil `Locale.isDefault`
ile tanımlıdır; iki ayrı yerde tutmak senkronizasyon hatası davetiyesidir.

### 2.4 Veri migration'ı — büyük harf → küçük harf locale anahtarı

Mevcut veride çeviriler `translations.EN` (BÜYÜK harf) altında. Yeni sözleşme küçük harf
(`en`) — çünkü aynı değer URL prefix'i (`/en/...`), `<html lang="en">` ve `hreflang="en"`
olarak da kullanılıyor ve bunların hepsi standarda göre küçük harftir. Tek gösterim
şarttır.

**db-agent'ın migration'ı ŞUNU YAPMALIDIR** (idempotent, geri alınabilir):
1. 4 tablonun her birinde `translations` içindeki `EN` anahtarını `en`'e taşı
   (`jsonb_set` + `-` operatörü ile).
2. `en` altında `title` (veya Product/Portfolio için `title`) dolu olan HER kayıt için
   bir `ContentSlug(entityType, entityId, 'en', <slug>)` satırı üret. Slug kaynağı:
   `translations.en.slug` varsa o, yoksa kanonik `slug` kolonu.
3. TÜM içerik kayıtları için `ContentSlug(..., 'tr', <kanonik slug>)` satırı üret
   (varsayılan dil de tabloda temsil edilir — çözümleme yolu tek ve tekdüze olsun).
4. Çakışma durumunda (aynı locale+slug) ikinci kayda `-2`, `-3` ... eki ver ve migration
   çıktısında **raporla** (sessizce üzerine yazma).

**Backend geriye dönük okuma toleransı:** okuma yolu `translations[locale]` bulamazsa
`translations[locale.toUpperCase()]`'e de bakar (geçiş güvenliği). Yazma yolu **yalnızca**
küçük harf üretir. Bu tolerans geçicidir ve `chore/i18n-drop-uppercase-fallback` ile
kaldırılacaktır.

---

## 3. API sözleşmesi — `docs/architecture/openapi.yaml` (BU GÖREVDE GÜNCELLENDİ)

Sözleşme dosyası doğrudan güncellendi ve doğrulandı (YAML geçerli, tüm `$ref`'ler
çözümleniyor, 131 path).

### 3.1 Eklenenler

| Tür | Ad | Not |
|---|---|---|
| tag | `Localization` | Terminoloji kuralı burada bağlayıcı olarak tanımlı |
| path | `GET /locales` | Public — dil değiştirici ve `[lang]` doğrulaması |
| path | `GET/POST /admin/locales` | Okuma authenticated, yazma yalnızca ADMIN |
| path | `PATCH/DELETE /admin/locales/{code}` | `code` değişmez; varsayılan silinemez |
| path | `GET /pages`, `GET /pages/{slug}` | **Kodda vardı, sözleşmede YOKTU** — boşluk kapatıldı |
| path | `GET /blog`, `GET /blog/{slug}` | Aynı boşluk |
| parameter | `LocaleQuery` (`?locale=`) | `/pages`, `/blog`, `/products`, `/portfolio` uçlarına eklendi |
| parameter | `LocaleCode` (path) | — |
| schema | `Locale`, `LocaleUpsertRequest`, `LocaleUpdateRequest` | — |
| schema | `ContentLocalization` | hreflang/sitemap'i besleyen dizi elemanı |
| schema | `ContentTranslations` | 4 entity'de tekrarlanan gevşek tanımın yerini aldı |

### 3.2 Bağlayıcı sözleşme kuralları

1. **`locale` kodu her yerde küçük harf.** DB, API, URL, `<html lang>`, hreflang.
2. **Geçersiz `locale` query'si hata DEĞİLDİR.** Bilinmeyen/devre dışı kod sessizce
   varsayılan dile düşer, `400` DÖNMEZ. Gerekçe: locale URL'den türeyen bir sunum
   tercihidir; geçersiz bir dil kodu yüzünden içerik sayfası çökmemelidir. 404 kararını
   rota katmanı (`[lang]` segmenti) verir, veri katmanı değil.
3. **Her içerik DTO'su `localizations: ContentLocalization[]` döndürür.** hreflang,
   sitemap ve dil değiştirici bu TEK diziden beslenir — frontend dil başına ek istek
   ATMAZ (N+1 yasak).
4. **`translations` PATCH'te locale bazında shallow merge.** Gönderilen locale'in objesi
   tam replace, gönderilmeyen locale'ler korunur. Bir dili silmek için o anahtarı `null`
   gönder. (Mevcut davranış — korundu, artık yazılı.)
5. **Çeviri slug'ı çakışırsa `409 CONFLICT`** (`422` değil) — bu bir doğrulama hatası
   değil, kaynak çakışmasıdır; `POST /admin/locales`'in çakışma semantiğiyle tutarlı.

---

## 4. KARAR: Public site routing — **varsayılan dil prefix'siz, diğerleri prefix'li**

### 4.1 Karar

```
TR (varsayılan):  /hakkimizda        /blog/yazi-basligi      /products/urun
EN:               /en/about-us       /en/blog/post-title     /en/products/product
```

`/tr/...` **YOKTUR** ve `/tr/...` isteği `/...`'e **301** ile yönlendirilir (tek kanonik
URL).

### 4.2 Gerekçe

Alternatif "her dil prefix'li" (`/tr/hakkimizda`) seçeneği daha simetriktir, ama:
- Sitedeki **her mevcut URL değişirdi**. Yayında olan tüm sayfalar, `sitemap.ts` çıktısı,
  `NavigationItem.href` kayıtları, kullanıcıların kaydettiği/paylaştığı bağlantılar ve
  birikmiş SEO otoritesi 301 zincirine girerdi.
- Karşılığında kazanç yalnızca "kod simetrisi" olurdu. Bu, ziyaretçi ve arama motoru
  maliyetini haklı çıkarmaz.

Ayrıca varsayılan dil değişirse (`isDefault` taşınırsa) prefix'siz servis edilen dil
değişir — bu yüzden `PATCH /admin/locales/{code}` sözleşmesi bu işlemi "URL'leri
değiştirir" uyarısı ve zorunlu onay diyaloğu ile işaretler.

### 4.3 Next.js 16 uygulama notu (bağlayıcı — frontend-agent)

Proje **Next.js 16.2.12** kullanıyor ve `frontend/AGENTS.md` uyarınca eğitim verisindeki
Next.js bilgisi geçerli DEĞİLDİR. Doğrulanmış gerçekler
(`frontend/node_modules/next/dist/docs/01-app/02-guides/internationalization.md`):

- **`middleware.ts` bu sürümde `proxy.ts`'tir.** Projede `frontend/src/proxy.ts` zaten var
  ve bakım modunu (503) yönetiyor. **Next tek bir proxy dosyasına izin verir** — locale
  mantığı MEVCUT `proxy()` fonksiyonuna EKLENİR, ikinci bir dosya AÇILMAZ.
- **Sıralama bağlayıcıdır:** önce bakım modu kontrolü (503 kazanır), sonra locale
  rewrite. Bakım modundayken dil yönlendirmesi yapılmaz.
- Rota ağacı `app/(site)/...` → `app/[lang]/(site)/...` altına taşınır; `params` bir
  Promise'tir (`const { lang } = await params`).
- Prefix'siz TR için proxy **`NextResponse.rewrite`** kullanır (`redirect` DEĞİL):
  `/hakkimizda` → dahili `/tr/hakkimizda`. Ziyaretçinin gördüğü URL temiz kalır.
- `/tr/...` ile gelen istek → `NextResponse.redirect` **301** → `/...`.
- Geçerli locale listesi **`GET /locales`'ten** gelir (`revalidate: 60`, `/appearance` ile
  aynı politika). Kod içine sabit dil listesi GÖMÜLMEZ — aksi halde "yeni dil = deploy
  yok" kriteri frontend tarafında bozulur.
- `PageProps<'/[lang]'>` / `LayoutProps<'/[lang]'>` global tip yardımcıları kullanılır.
- `<html lang>` sabit `"tr"` (`frontend/src/app/layout.tsx:30`) — aktif locale'den
  türetilecek.
- **`Accept-Language` ile OTOMATİK yönlendirme YAPILMAZ.** Kök `/` her zaman varsayılan
  dili gösterir. Gerekçe: otomatik yönlendirme arama motoru tarayıcılarını şaşırtır
  (Googlebot çoğunlukla `en-US` ile gelir ve TR sitesini hiç göremez) ve kullanıcının
  açık tercihini ezer. Dil seçimi **yalnızca** dil değiştirici ile yapılır.

### 4.4 `/admin` ve SaaS yüzeyi etkilenmez

`/admin`, `/login`, `/dashboard` vb. locale prefix'i **ALMAZ** — mevcut `proxy.ts`
matcher'ındaki negatif lookahead korunur ve locale mantığı da aynı matcher'a tabidir.
Admin panelinin dili URL'de değil, `localStorage`'da taşınır (§7).

---

## 5. KARAR: Fallback davranışı

**Tek kural, istisnasız:**

> **Alan bazında sessiz fallback.** İstenen dilde bulunmayan veya boş string olan HER alan,
> tek tek varsayılan dilden doldurulur. Kısmi çeviri geçerlidir. Ziyaretçiye "çeviri yok"
> mesajı **GÖSTERİLMEZ** ve içerik **404 vermez**.

Gerekçe: yarı çevrilmiş bir sayfa, hiç açılmayan bir sayfadan iyidir. "Mevcut değil"
mesajı ziyaretçiyi çıkmaza sokar ve bir tanıtım/e-ticaret sitesinde doğrudan dönüşüm
kaybıdır.

**Bu kuralın SEO'daki karşılığı (bkz. §6) farklıdır ve bilinçlidir:**

| Durum | Ziyaretçiye | hreflang / sitemap |
|---|---|---|
| `L` dilinde tam çeviri | `L` içeriği | `L` alternate'i VAR |
| `L` dilinde kısmi çeviri | Karışık (eksikler varsayılandan) | `L` alternate'i VAR |
| `L` dilinde çeviri YOK (`translated: false`) | Tamamen varsayılan dil | `L` alternate'i **YOK**, sitemap'e **girmez** |

Üçüncü satır kritiktir: içerik `/en/...` altında erişilebilir kalır (bağlantı kırılmaz),
ama arama motoruna "işte bunun İngilizcesi" DENMEZ. Aksi halde Google'a birebir aynı
Türkçe içeriği iki farklı URL'de duplicate olarak sunmuş oluruz.

**Admin panelinde bu görünür olmalıdır:** çeviri sekmesi, hangi alanların fallback'te
olduğunu (ör. soluk placeholder + "varsayılandan" rozeti) göstermelidir — editör neyin
çevrildiğini gözle ayırt edebilmelidir.

### 5.1 TEK İSTİSNA — hukuki belgeler (`Page.isLegalDocument: true`)

compliance-agent tarafından doğrulandı: bu **isteğe bağlı bir tercih değil**, KVKK m.10
(aydınlatma yükümlülüğü) ve GDPR m.12 (şeffaflık — bilginin *anlaşılır ve erişilebilir*
biçimde sunulması) gereğidir. Ziyaretçiye İngilizce bir sayfada Türkçe bir gizlilik
politikası gösterip "bilgilendirildi" saymak, yükümlülüğü karşılamaz.

**Kural:**

> `isLegalDocument: true` olan bir `Page`, varsayılan olmayan bir `L` dilinde
> çevrilmemişse (`localizations[L].translated == false`), o dilde **içerik gövdesi
> gösterilmez**. Bunun yerine açık bir bildirim + varsayılan dildeki sürüme bağlantı
> gösterilir.

**Uygulama — fail-safe, sunucu tarafında (bağlayıcı):**

Bayrağı kontrol etme sorumluluğu istemciye BIRAKILMAZ. Public `GET /pages/{slug}?locale=L`
bu koşul oluştuğunda `blocks` alanını **boş** döndürür. Gerekçe: uyumluluk açısından
kritik bir davranış, her istemci tüketicisinin bir booleanı kontrol etmeyi hatırlamasına
bağlı olamaz. Tek bir unutulmuş kontrol = hukuki ihlal. Bu, security-agent'ın
"istemciye güvenme" ilkesiyle aynı savunma-derinliği mantığıdır.

- Yalnızca **public** okumaları etkiler. `/admin/pages/*` ham kaydı döndürür — editör
  çeviriyi normal şekilde yazabilir, düzenleme akışı BOZULMAZ.
- `title` boşaltılmaz (varsayılan dilden gelir) — sayfanın bir başlığı olmalı ki bildirim
  anlamlı görünsün ve navigasyon kırılmasın.
- **Yeni bir yanıt alanı YOK.** İstemci durumu
  `isLegalDocument && !localizations[L].translated` ile türetir. Sözleşmeyi şişirmemek
  için kasıtlı.
- **404 DÖNÜLMEZ.** 404, ziyaretçiyi çıkmaza sokar ve "varsayılan dildeki sürüme git"
  bağlantısını sunma imkânını yok eder — ki hukuken asıl istenen budur.

**SEO:** bu sayfa o dilde hreflang alternate'i almaz ve sitemap'e girmez (§6 genel kuralı
zaten bunu sağlıyor, çünkü `translated: false`). Ek olarak bildirim sayfası `noindex`
almalıdır — arama motoruna içeriksiz bir sayfa indeksletmenin anlamı yok.

**Yetki:** bayrağı yalnızca **ADMIN** değiştirebilir (EDITOR → `403`). Bir EDITOR'ün
işareti kaldırması, hukuki metinlerde sessiz fallback'i yeniden açmak demektir. Her
değişiklik `content.legal_flag_change` ile denetlenir.

**Metin:** bildirim metni admin sözlüğünde DEĞİL, **site (ziyaretçi) sözlüğünde** yer
alır — bunu gören kişi ziyaretçidir, editör değil. compliance-agent'ın önerdiği anahtar
korunur: `legal.notAvailableInLocale`.

---

## 6. SEO gereksinimleri

Next.js 16 API'leri `node_modules` içinden **doğrulandı** — ikisi de destekleniyor.

### 6.1 hreflang (`generateMetadata`)

Her public içerik sayfası `alternates.languages` üretir. Kaynak: DTO'daki
`localizations` dizisi, `translated: true` olanlar filtrelenerek.

- Anahtar: `Locale.hreflang ?? Locale.code`.
- **`x-default` zorunludur** ve varsayılan dilin prefix'siz URL'sini gösterir.
  (Doğrulandı: `next/dist/lib/metadata/types/alternative-urls-types.d.ts` →
  `type UnmatchedLang = 'x-default'`.)
- `alternates.canonical` her sayfada, o dilin KENDİ URL'sini gösterir (çapraz-dil canonical
  YASAK — dilleri birbirinin kopyası ilan etmek indekslemeyi bozar).
- İçerikteki `canonicalUrl` alanı doluysa o kazanır (mevcut §10.2 davranışı korunur).

### 6.2 Çok dilli `sitemap.xml`

`frontend/src/app/sitemap.ts` genişletilir. `MetadataRoute.Sitemap` girdisi
`alternates.languages` destekler (doğrulandı: `sitemap.md` "Generate a localized Sitemap").

- Her içerik için **tek** `url` girdisi (varsayılan dil) + `alternates.languages` altında
  çevrilmiş diller. Dil başına ayrı kök girdi AÇILMAZ.
- `translated: false` diller girdiye **dahil edilmez**.
- Mevcut sitemap **yalnızca** Page ve BlogPost içeriyor — `Product` ve `PortfolioItem`
  eksik. Bu, i18n'den bağımsız mevcut bir SEO boşluğudur; aynı işte kapatılmalıdır.
- `/blog` gibi liste sayfaları da dil alternate'leriyle listelenir.

### 6.3 Diğer

- `<html lang>` aktif locale'den (şu an sabit `"tr"`).
- `robots.ts` değişmez — `/en/...` taranabilir kalmalıdır.
- OpenGraph `og:locale` + `og:locale:alternate` eklenir.
- Bakım modu HTML'i (`proxy.ts` içinde sabit `lang="tr"`) varsayılan dilden türetilmeli.

---

## 7. KARAR: Admin panel arayüz dili — mevcut hafif çözüm KORUNUR, `next-intl` EKLENMEZ

### 7.1 Karar

`frontend/src/context/i18n-context.tsx` + `lib/i18n/dictionaries.ts` yaklaşımı korunur ve
**doldurulur**. Yeni i18n kütüphanesi (next-intl, i18next, lingui) **eklenmez**.

### 7.2 Gerekçe

`next-intl`'in asıl değeri locale routing, SSR mesaj dağıtımı ve SEO'dur. Admin paneli
bunların **hiçbirine** ihtiyaç duymaz: kimlik doğrulaması arkasında, indekslenmiyor,
paylaşılabilir dil-özel URL'e ihtiyacı yok. Buna karşılık maliyeti somut: tüm `/admin`
ağacının `[lang]` segmentine taşınması, ~20 admin rotasının yolunun değişmesi, sidebar/
breadcrumb/command-palette bağlantılarının yeniden yazılması ve yeni bir üretim bağımlılığı.
Kazanç yok, risk yüksek. **Panel dili URL'de DEĞİL, `localStorage`'da taşınır** (mevcut
davranış).

Bu, ARCHITECTURE.md §10.5'in mevcut kararıyla da tutarlıdır — değiştirmek için sebep yok.

### 7.3 Ama mevcut uygulama tamamlanmak ZORUNDA

Bugünkü hâli (11 anahtar, 1 tüketici bileşen, kullanılmayan `nav.*` anahtarları) kullanıcıya
**bozuk bir özellik** olarak görünüyor. Gereken:

- **Faz 1 (bu iş kapsamında, zorunlu):** admin "chrome"u tamamen çevrilir — `sidebar.tsx`
  (sabit Türkçe etiketler `t()`'ye taşınır), `topbar.tsx`, `breadcrumb.tsx`,
  `command-palette.tsx`, `keyboard-shortcuts-modal.tsx`, ortak buton/durum etiketleri
  (Kaydet, İptal, Sil, Taslak, Yayında...). Kullanıcı dili değiştirdiğinde **görünür ve
  ikna edici** bir değişim olmalıdır.
- **Faz 2 (ayrı iş, bu kapsamda DEĞİL):** sayfa içi form etiketleri ve yardım metinleri.

**Sözlük dosyası bölünür:** tek `dictionaries.ts` yerine namespace başına dosya
(`nav.ts`, `common.ts`, `content.ts`...). Tek dosya Faz 1 sonrası birkaç yüz anahtara
çıkar ve merge çakışması kaynağı olur.

**`useT()` parametre desteği kazanır:** `t("content.deleted", { count: 3 })`. Sayı/tarih
biçimlendirmesi için ayrı bir kütüphane değil, yerleşik `Intl` kullanılır — projede zaten
var (`notification-center.tsx`: `new Intl.DateTimeFormat("tr-TR", ...)`); bu sabit
`"tr-TR"` de aktif panel diline bağlanmalıdır.

### 7.4 İki dil kavramı ASLA karıştırılmaz (bağlayıcı terminoloji)

| Kavram | Nerede tutulur | Kimi etkiler | API'de |
|---|---|---|---|
| **Panel arayüz dili** (`adminLocale`) | `localStorage` | Yalnızca admin chrome metinleri | **YOK** — backend bilmez |
| **İçerik dili** (`locale`) | URL / `?locale=` | Ziyaretçiye giden içerik | `Locale`, `ContentSlug`, `translations` |

Bir editör paneli İngilizce kullanırken Türkçe içerik düzenleyebilir. `adminLocale`
**hiçbir zaman** içerik isteklerine `?locale=` olarak geçirilmez. İçerik editöründe hangi
dilin düzenlendiği **açık bir sekme seçimidir**, panel dilinden bağımsızdır.

---

## 8. İçe aktarma (import) sistemi ile uyum

**Tespit:** import sisteminde dil desteği **hiç yok**. `import.worker.ts` mevcut
kayıtların `translations` alanını yalnızca **koruyor** (satır 542, 659, 1090 — üzerine
yazmamak için). `parsers/` altındaki üç parser'ın (`tabular`, `wxr`, `zip`) hiçbiri `lang`
/ `language` okumuyor. WXR'ın `<language>` kanal elemanı ve WPML/Polylang meta verisi
yok sayılıyor.

**Karar (v1 kapsamı — kasıtlı olarak dar):**

1. **Tabular (CSV/JSON):** opsiyonel `locale` sütunu desteklenir. Boş/eksikse varsayılan
   dil. Tanınmayan dil kodunun nasıl raporlanacağı için bkz. **§8.1** (bu maddenin ilk
   hâli "satır bazında `WARNING` severity" diyordu — YANLIŞTI, düzeltildi).
2. **WXR:** kanal düzeyindeki `<language>` okunur ve işin varsayılan hedef locale'i olur
   (kullanıcı içe aktarma formunda override edebilir).
3. **Slug:** içe aktarılan her kayıt için hedef locale'de `ContentSlug` satırı üretilir.
   Çakışma varsa mevcut `ImportDuplicateStrategy` enum'ı uygulanır — **yeni bir çakışma
   mekanizması icat edilmez**.
4. **KAPSAM DIŞI (açıkça):** çeviri *gruplama* — yani "bu EN yazısı şu TR yazısının
   çevirisidir" ilişkisinin WPML/Polylang meta verisinden otomatik kurulması. Bu, kaynak
   sisteme özel kırılgan bir eşleme gerektirir; v1'de içe aktarılan çeviriler **bağımsız
   içerik** olarak gelir, editör panelden ilişkilendirir. Bu sınır bilinçlidir ve
   dokümantasyonda kullanıcıya açıkça belirtilmelidir.

### 8.1 KARAR (revizyon — backend-agent sorusu): tanınmayan dil kodu nasıl raporlanır

**Soru:** `ImportErrorSeverity` enum'ında yalnızca `ERROR` ve `SKIPPED` var; §8'in
istediği `WARNING` yok. Enum'a eklenmeli mi?

**Karar: HAYIR — enum'a `WARNING` EKLENMEZ, migration GEREKMEZ.** Bunun yerine
**mevcut `ImportJobPreview.warnings` mekanizması** kullanılır; yeni kod: `UNKNOWN_LOCALE`
(sözleşmeye eklendi).

**Gerekçe — asıl hata enum'da değil, benim §8 ifademdeydi.** "Satır bazında uyarı"
demiştim; doğru mekanizma bu değil:

1. **Bu satır bazlı bir anomali değil, dosya bazlı bir sorundur.** `locale` sütununda
   `de` yazan bir CSV'de büyük olasılıkla **her satır** `de`'dir. 5000 satır için 5000
   özdeş uyarı kaydı üretmek sinyal değil gürültüdür — hata listesini kullanılamaz hale
   getirir.
2. **`ImportJobPreview.warnings` tam olarak bunun için var:** sözleşmedeki tanımı "işi
   ENGELLEMEYEN ama kullanıcıya **onaydan ÖNCE** gösterilmesi ZORUNLU uyarılar."
3. **Birebir emsal mevcut: `WP_AUTHOR_UNMATCHED`** — "dosyan burada var olmayan bir
   şeye atıf yapıyor, yine de içe aktaracağız" durumunun aynısı. Aynı problemi ikinci
   bir mekanizmayla çözmek tutarsızlık olurdu.
4. **Zamanlama daha iyi:** preview uyarısı içe aktarma ÇALIŞMADAN önce görünür.
   Kullanıcı dili `/admin/locales`'ten ekleyip tekrar deneyebilir. Satır bazlı hata ise
   ancak iş bittikten sonra okunur — iş işten geçmiştir.
5. **Maliyet farkı:** enum'a değer eklemek migration + `ImportJobError` tüketen tüm
   yüzeylerde (hata listesi UI'ı, sayaçlar, filtreler) üçüncü bir severity'nin ele
   alınması demektir. Preview uyarısı **sıfır şema değişikliği** ile aynı işi daha iyi
   yapar.

`ERROR`/`SKIPPED`'e eşlemek de reddedildi: satır **başarıyla içe aktarılıyor** (varsayılan
dile), dolayısıyla ne başarısız (`ERROR`) ne de atlanmış (`SKIPPED`). Yanlış severity,
içe aktarma raporunu okuyan yöneticiyi yanıltır.

**Davranış (bağlayıcı):** tanınmayan kodlu satırlar varsayılan dile aktarılır, iş
durdurulmaz, satır başına kayıt üretilmez; preview'da tek bir `UNKNOWN_LOCALE` uyarısı
tanınmayan kodların kümesini ve etkilenen satır sayısını bildirir.

**Not:** `import.worker.ts` 1382 satır — bu iş ayrı bir takip kalemi
(`feature/i18n-import`) olarak ele alınmalı, ana i18n geçişine bundle EDİLMEMELİ.
backend-agent'ın bunu kapsam dışı bırakma kararı DOĞRUDUR.

---

## 9. Görev dağılımı

Sıra bağımlılığı: **db-agent → backend-agent → frontend-agent**. `ui-designer` ve
`compliance-agent` paralel başlayabilir. `qa-agent` backend bittiğinde başlar.

### db-agent
1. `Locale` modelini ekle (§2.1) + `locales_single_default` partial unique index'i
   migration SQL'ine **elle** ekle (Prisma DSL bunu ifade edemez).
2. `ContentSlug` modelini ekle (§2.2) — iki `@@unique` ve iki `@@index` bağlayıcıdır.
3. `tr` (varsayılan) + `en` seed'i migration ile birlikte.
4. Veri migration'ı: `translations.EN` → `translations.en` (4 tabloda), ardından mevcut
   içerikten `ContentSlug` satırlarını üret (§2.4 adım 1-4). Slug çakışmalarını sessizce
   ezme — son ek ver ve **raporla**.
5. `Page`/`BlogPost`/`Product`/`PortfolioItem` üzerindeki §10.5 `///` yorumlarını güncelle.
6. **TAKİP MIGRATION'I (§2.3.1 — compliance itirazı sonrası eklendi):**
   `Page.isLegalDocument Boolean @default(false)`. `20260812055828_add_locale_and_content_slug`
   YENİDEN YAPILMAZ — bu ayrı, küçük bir migration'dır. Geri doldurma gerekmez
   (`false` doğru başlangıç). Mevcut gizlilik politikası sayfası varsa onu `true` yapan
   bir veri adımı ekle; yoksa admin panelden işaretlenecektir.
7. **YAPMA:** iş mantığı, `applyLocale` çözümleme kodu (backend-agent'ın).

### backend-agent
1. **Öncelik 1 — mevcut bozukluğu gider:** `Product` ve `PortfolioItem` public GET
   uçlarına `applyLocale()` + `locale` query'sini ekle. Bugün bu iki entity'de çeviri
   yazılabiliyor ama okunamıyor (§0.1b).
2. `applyLocale()`'i ortak bir yardımcıya çıkar (şu an `pages.routes.ts` ve
   `blog.routes.ts`'te **kopyalanmış**) — 4 entity aynı mantığı paylaşmalı. Sabit `"EN"`
   yerine dinamik locale; büyük-harf okuma toleransı (§2.4).
3. `Locale` CRUD uçlarını uygula (`/locales`, `/admin/locales`, `/admin/locales/{code}`) —
   sözleşme `openapi.yaml`'da hazır. `isDefault` devri **tek transaction**; varsayılanı
   silme/devre dışı bırakma → `422`.
4. Slug çözümleme: `ContentSlug(locale, slug)` → yoksa kanonik `slug` fallback'i.
5. `ContentSlug` yazma yolu: `translations` PATCH'inde çeviri eklenince satır
   oluştur/güncelle, silinince kaldır. Slug çakışması → **`409 CONFLICT`**.
6. Tüm içerik DTO'larına `localizations: ContentLocalization[]` ekle — **tek sorguda**
   (`ContentSlug` üzerinde `entityId IN (...)` ile toplu çekim; liste uçlarında N+1 YASAK).
7. İçerik **kalıcı silme** yollarında ilgili `ContentSlug` satırlarını aynı transaction'da
   sil (polimorfik FK yok, bkz. §2.2). Soft-delete silmez.
8. **AYRI TAKİP KALEMİ — ana i18n geçişine bundle ETME** (`feature/i18n-import`):
   import'ta `locale` sütunu + WXR `<language>` (§8 madde 1-3). Tanınmayan dil kodu
   **§8.1'e göre** raporlanır — `ImportErrorSeverity` enum'ına DOKUNULMAZ, mevcut
   `ImportJobPreview.warnings` + yeni `UNKNOWN_LOCALE` kodu kullanılır.
9. **Hukuki belge istisnası (§5.1 — bağlayıcı, hukuken zorunlu):** ortak `applyLocale()`
   yardımcısı, `Page.isLegalDocument === true` VE istenen locale varsayılan değil VE o
   locale'de çeviri yok ise **fallback UYGULAMAZ** ve `blocks`'u boş döndürür (`title`
   boşaltılmaz). Bu **public okuma yollarında sunucu tarafında** yapılır — istemciye
   bırakılmaz. `/admin/pages/*` ham kaydı döndürmeye devam eder. 404 DÖNME.
10. `isLegalDocument` yazma yetkisi: yalnızca **ADMIN** (EDITOR → `403`, mevcut
    `authorId` yetki paterniyle aynı). Değeri DEĞİŞTİREN her istek için audit:
    `content.legal_flag_change`.
11. Audit action'ları: `localization.locale_create`, `localization.locale_update`,
    `localization.locale_delete`.
12. Unit test: fallback zinciri, slug çakışması (409), `isDefault` devri, geçersiz locale'in
    hata DEĞİL fallback ürettiği, **ve hukuki belge istisnasının gövdeyi boşalttığı**.
11. **YAPMA:** şema tasarımı — §2 taslağını tüket, değiştirme. Değişiklik gerekirse
    architect'e eskale et.

### frontend-agent
1. `app/(site)/**` → `app/[lang]/(site)/**` taşıması; `params` Promise (`await params`).
   **Uygulamadan önce `node_modules/next/dist/docs/01-app/02-guides/internationalization.md`
   okunacak** — Next 16 eğitim verisinden farklı (`AGENTS.md`).
2. **Mevcut `frontend/src/proxy.ts`'i genişlet** — ikinci proxy dosyası YOK. Sıra: bakım
   modu (503) → locale rewrite. Varsayılan dil `rewrite` (URL temiz), `/tr/...` → **301**
   `/...`. `Accept-Language` otomatik yönlendirmesi **YAPMA** (§4.3).
3. Dil listesini `GET /locales`'ten al (`revalidate: 60`). **Sabit dil listesi gömme.**
4. Site header'a dil değiştirici (`nativeLabel` gösterilir; aynı içeriğin o dildeki
   slug'ına gider — `localizations`'tan; çevirisi yoksa o dilin ana sayfasına).
5. Tüm public veri çağrılarına aktif `locale`'i geçir (`lib/api/server-*.ts` — bugün
   `locale` parametresini **hiç** kullanmıyor).
6. `generateMetadata`'da `alternates.languages` + **`x-default`** + dil-özel `canonical` (§6.1).
7. `sitemap.ts`: `alternates.languages`; `translated: false` dilleri hariç tut; **eksik
   olan `Product`/`PortfolioItem` girdilerini de ekle** (§6.2).
8. `<html lang>` aktif locale'den (`app/layout.tsx:30` sabit `"tr"`).
9. **Admin Faz 1:** `sidebar.tsx`'in sabit Türkçe etiketlerini `t()`'ye taşı (sözlükteki
   `nav.*` anahtarları hazır ve şu an KULLANILMIYOR), topbar/breadcrumb/command-palette/
   kısayol modalı + ortak aksiyon etiketleri. Sözlüğü namespace dosyalarına böl.
   `useT()`'ye parametre desteği. `Intl` biçimlendiricilerindeki sabit `"tr-TR"`'yi
   `adminLocale`'e bağla.
10. Admin çeviri editörünü **`products` ve `portfolio`** ekranlarına da ekle (bugün
    yalnızca pages/blog'da var) ve dil sekmelerini `GET /admin/locales`'ten dinamik üret —
    sabit "EN" sekmesi gömme. Fallback'teki alanlar görsel olarak ayırt edilmeli (§5).
11. `/admin/settings` altında Dil Yönetimi ekranı (ekle/düzenle/sırala/varsayılan yap/sil).
    Varsayılan değiştirme ve silme **onay diyaloğu** ister; silme, etkilenen çeviri
    sayısını (`translatedContentCount`) gösterir.
12. **Hukuki belge istisnası — ziyaretçi tarafı (§5.1):** `isLegalDocument &&
    !localizations[L].translated` durumunda gövde yerine bildirim + varsayılan dildeki
    sürüme bağlantı göster. Metin **site sözlüğüne** girer (admin sözlüğüne DEĞİL —
    bunu ziyaretçi görür): `legal.notAvailableInLocale`. Bu sayfa `noindex` almalıdır.
13. **Hukuki belge istisnası — admin tarafı:** sayfa düzenleme ekranında
    `isLegalDocument` anahtarı (yalnızca ADMIN'e görünür/aktif). Yanına, işaretlemenin
    çeviri davranışını değiştirdiğini açıklayan kısa bir yardım metni — editör bunu bir
    etiket sanmamalı. §5 fallback göstergesi bu sayfalarda "fallback yapılmayacak"
    şeklinde farklı bir durum göstermelidir.
14. **Kaydedilmiş dahili bağlantılar (yeni tespit, aşağıdaki §12.2):** `NavigationItem.href`,
    `cookieBannerPolicyHref` vb. varsayılan dil yolu olarak saklanır; ek iş GEREKMEZ,
    ama `/en/<varsayılan-slug>` isteği o dilin kanonik slug'ına **301** ile
    yönlendirilmelidir (§12.2).
15. **YAPMA:** görsel/stil kararları — ui-designer'ın tokenlerini tüket.

### ui-designer
1. **Dil değiştirici** deseni — iki bağlam için tek tutarlı dil: site header (ziyaretçi)
   ve admin topbar (panel dili). Bunlar farklı şeylerdir (§7.4) ve **görsel olarak
   birbirine karışmamalıdır**.
2. **Çeviri sekmesi** deseni (içerik editörü): dil sekmeleri, "çevrildi / kısmen çevrildi /
   çevrilmedi" durum rozeti. N dil için ölçeklenmeli — 2 dile göre tasarlanmış bir düzen
   5 dilde bozulmamalı.
3. **Fallback alan göstergesi** — varsayılan dilden gelen bir alan, boş bir alandan ve
   çevrilmiş bir alandan gözle ayırt edilebilmeli (§5). Renk tek sinyal OLMAMALI
   (erişilebilirlik).
4. Bayrak kullanımı konusunda karar ver ve **yaz**: bayrak dil değil ülke temsil eder
   (mevcut topbar `🇹🇷 TR` kullanıyor). Tek bir kural belirle ve tüm yüzeylerde uygula.
5. Metin genişlemesi: EN→TR/DE çevirilerde metin ~%30 uzayabilir; sidebar/buton/rozet
   tokenleri taşmamalı.
6. **YAPMA:** kod yazma.

### qa-agent
1. E2E: TR sayfa → dil değiştir → `/en/<en-slug>` → içerik EN.
2. E2E: çevrilmemiş içerik `/en/...` → **404 DEĞİL**, varsayılan dilde açılır (§5).
3. E2E: `/tr/hakkimizda` → **301** → `/hakkimizda`.
4. E2E: **bakım modu + locale birlikte** — bakım açıkken `/en/...` **503** döner
   (proxy sırası regresyonu; §4.3).
5. E2E: `/admin` locale prefix'i ALMAZ; panel dili değişince admin URL'i DEĞİŞMEZ.
6. E2E: panel dili EN iken TR içerik düzenlenebiliyor (iki dil kavramı karışmıyor, §7.4).
7. E2E: yeni dil (`de`) **panelden** eklenip etkinleştirilince deploy/migration olmadan
   rotalar ve `/locales` çalışıyor — **kabul kriterinin doğrudan testi**.
8. E2E: varsayılan dil silinemiyor; devre dışı bırakılamıyor.
9. Regresyon: **mevcut TR URL'lerinin hiçbiri değişmedi** (en yüksek riskli madde).
10. SEO: hreflang etiketleri + `x-default` var; çevrilmemiş dil için alternate YOK;
    sitemap `alternates` üretiyor.
11. API: slug çakışması `409`; geçersiz `locale` query'si `400` DEĞİL, fallback.
12. **Hukuki belge istisnası (§5.1) — uyumluluk kritikliğinde, geçiş şartı:**
    a. `isLegalDocument: true` + EN çevirisi yok → `GET /pages/{slug}?locale=en`
       yanıtında `blocks` **BOŞ** (sunucu tarafında boşaltıldığı doğrulanır — istemci
       kontrolüne güvenilmediğinin kanıtı).
    b. Aynı sayfa `/en/...` altında **404 DEĞİL**; bildirim + varsayılan dil bağlantısı
       görünür.
    c. Aynı sayfa EN'e çevrildikten sonra normal şekilde EN gövdesiyle açılır.
    d. `isLegalDocument: false` bir sayfa AYNI koşulda sessiz fallback yapar (istisnanın
       sızmadığı — genel §5 davranışı bozulmamış).
    e. EDITOR rolü `isLegalDocument` gönderince `403`; ADMIN gönderince `content.legal_flag_change`
       audit kaydı oluşur.
13. Regresyon: `Page` DTO'suna `isLegalDocument` eklenmesi mevcut sayfa/quick-edit
    akışlarını bozmadı (tüm mevcut kayıtlar `false`).

### compliance-agent
1. **Düşük etki beklenir** — `Locale` ve `ContentSlug` kişisel veri İÇERMEZ. Yine de
   doğrula.
2. `adminLocale` `localStorage` anahtarı: kesinlikle gerekli/işlevsel bir tercihtir, çerez
   onayı gerektirmez — ancak çerez/depolama envanterinde **listelenmelidir**.
3. Ziyaretçi dil tercihi çerezle hatırlanacaksa (frontend-agent bunu önerirse) **önce
   compliance-agent onayı** — bu, izleme sınırına yaklaşan bir karardır. Mevcut kararda
   otomatik dil algılama YOK (§4.3), bu da gizlilik açısından **daha temiz** olan yoldur.
4. KVKK/GDPR aydınlatma metni, gizlilik politikası ve çerez metinleri çok dilli hale
   gelirse: **hukuki metinlerde §5 fallback kuralı UYGULANMAZ.** Çevrilmemiş bir hukuki
   metni başka dilde göstermek yerine o dilde metin sunulmamalı ve varsayılan dile açık
   bir bağlantı verilmelidir. **Bu, §5'in tek istisnasıdır ve bilinçlidir** —
   frontend-agent'ın bunu ayrıca ele alması gerekir.

### documentation-agent (devir sonrası)
`ARCHITECTURE.md` §10.5 tamamen yeniden yazılır (mevcut hâli yalnızca `EN` JSON
override'ını anlatıyor; `Locale`, `ContentSlug`, routing ve SEO kararlarını içermiyor).
CHANGELOG + kullanıcıya dönük "Dil ekleme" rehberi (import kısıtı §8.4 dahil).

---

## 10. Git

- Branşlar: `feature/i18n-schema` (db) → `feature/i18n-api` (backend) →
  `feature/i18n-public-routing`, `feature/i18n-admin-ui` (frontend).
- Conventional Commits: `feat(i18n): ...`, `fix(i18n): ...`.
- **Veri migration'ı (§2.4) geri alınabilir olmalı** ve production'da çalıştırılmadan önce
  üretim verisinin kopyası üzerinde prova edilmelidir — 4 tablonun JSON alanına ve tüm
  site URL'lerine dokunuyor.

## 11. Açık riskler

| Risk | Etki | Azaltma |
|---|---|---|
| `(site)` → `[lang]/(site)` taşıması tüm public rotalara dokunur | Yüksek | qa-agent madde 9 (URL regresyonu) zorunlu geçiş kriteri |
| Tek `proxy.ts`'te bakım modu + locale sırası | Orta | Sıra §4.3'te sabit; qa-agent madde 4 |
| `translations.EN` → `en` migration'ı | Orta | Büyük-harf okuma toleransı (§2.4); geri alınabilir migration |
| Admin UI çevirisinin kapsamı şişebilir | Orta | Faz 1 (chrome) / Faz 2 (form içi) ayrımı bağlayıcı |
| Varsayılan dil değişimi tüm URL'leri değiştirir | Yüksek | Sözleşmede uyarı + zorunlu onay diyaloğu (§2.1, §4.2) |
| Hukuki metnin çevrilmemiş dilde sızması | **Yüksek (hukuki)** | Sunucu tarafında boşaltma (§5.1) + qa-agent madde 12a geçiş şartı |

---

## 12. compliance-agent'ın ikincil bulguları — kararlar

### 12.1 Çerez bandı metinleri çok dilli değil → KAPSAM DIŞI (gerekçeli erteleme)

**Olgusal düzeltme:** bu alanlar `SiteSettings`'te değil, **`SiteAppearance`** modelinde
(`cookieBannerEnabled`, `cookieBannerText`, `cookieBannerPolicyHref` —
`schema.prisma:830-832`). Doğrulandı.

**Karar: bu işte YAPILMAZ.** Gerekçe: çerez bandı public sitede **hiç render edilmiyor**
(compliance-agent doğruladı; ben de yalnızca admin `appearance` formunda ve DTO
eşlemelerinde kullanıldığını teyit ettim). Var olmayan bir bandın metnini çevirmek boşa
iştir ve çevirinin doğru şekli, bandın nasıl inşa edileceğine bağlıdır.

**Ama gelecekteki işi şimdiden bağlıyorum** (yeniden yazımı önlemek için). Çerez bandı
işi (`feature/cookie-banner`) başladığında:
- `SiteAppearance`'a §1.2 paternini izleyen bir `translations Json @default("{}")` kolonu
  eklenir (`{ "en": { "cookieBannerText": "...", "cookieBannerPolicyHref": "..." } }`).
  **Dil başına yeni kolon AÇILMAZ** (`cookieBannerTextEn` gibi bir şey kabul edilmez).
- Band metni ziyaretçiye görünür ve **rıza ile ilgili** bir metindir; ziyaretçinin
  anlamadığı bir dilde gösterilen rıza metni geçerli rıza üretmez. Bu yüzden band,
  §5.1'in hukuki-belge mantığına yakındır — compliance-agent bandın çevrilmemiş dilde
  nasıl davranacağına o işte karar vermelidir.

Bu bulgu i18n'in yarattığı bir sorun değil, i18n'in **ortaya çıkardığı** önceden var olan
bir boşluktur. Ayrı iş kalemi olarak kaydedilmelidir.

### 12.2 Kaydedilmiş dahili bağlantılar dile duyarlı değil (benim gözden kaçırdığım)

`cookieBannerPolicyHref` incelemesi, ilk dokümanda **ele almadığım** genel bir sorunu
ortaya çıkardı: veritabanında saklanan dahili yollar (`NavigationItem.href`,
`SiteAppearance.*Href`, `headerCtaHref`, footer bağlantıları) `/gizlilik-politikasi` gibi
**varsayılan dil yolları**dır. `/en/` altındayken bunlar hangi sayfaya gitmeli?

**Karar: ek mekanizma GEREKMEZ — mevcut sözleşme zaten çözüyor.**

§3.2/§4 uyarınca slug çözümlemesi zaten "(1) `ContentSlug(locale, slug)`, (2) varsayılan
dildeki kanonik `slug`" sırasını izliyor. Yani `/en/gizlilik-politikasi` **doğru sayfayı
bulur** ve EN içeriğini render eder. Bağlantı kırılmaz.

Tek eksik kozmetik/SEO: URL o dilin güzel slug'ı değil. Bu yüzden:

> Bir istek varsayılan dildeki kanonik slug ile ama farklı bir locale prefix'i altında
> gelirse VE o içeriğin o dilde kendi slug'ı VARSA → o dilin slug'ına **301**.
> (`/en/gizlilik-politikasi` → `/en/privacy-policy`)

Bu, `/tr/...` → `/...` için zaten tanımlanan 301 mantığının aynısıdır; yeni bir kavram
değil. Böylece saklanan hiçbir `href`'e dokunmadan hem bağlantılar çalışır hem tek
kanonik URL korunur. **Veri migration'ı GEREKMEZ.**

---

## 13. Revizyon geçmişi

| # | Değişiklik | Kaynak |
|---|---|---|
| 1 | İlk kapsam ve kararlar | architect |
| 2 | §2.3 "yapısal değişiklik yok" → `Page.isLegalDocument` eklendi; §5.1 hukuki belge istisnası tam davranışla tanımlandı; §12.1/§12.2 eklendi | **compliance-agent itirazı** (`.claude/compliance-notes-i18n.md` §4) — itiraz haklı bulundu, karar değiştirildi |
| 3 | §8.1 eklendi: tanınmayan dil kodu satır bazlı `WARNING` yerine `ImportJobPreview.warnings` + `UNKNOWN_LOCALE` ile raporlanır — `ImportErrorSeverity` enum'ı DEĞİŞMEZ. Ayrıca `PATCH /admin/locales/{code}` açıklamasındaki hayali `warnings` yanıt alanı sözleşmeden kaldırıldı | **backend-agent'ın iki sorusu** — biri benim §8 ifademdeki, diğeri sözleşme metnimdeki hatayı ortaya çıkardı |
