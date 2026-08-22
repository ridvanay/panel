# Architect — Kapsam Kararı: Sayfa Düzenleyicide "Standart" ve "Gelişmiş" Mod Ayrımı

**Karar mercii:** architect · **Tarih:** 2026-08-22 · **Durum:** BAĞLAYICI
**Branş:** `feature/page-editor-roles`
**Bu tur kod YAZILMADI.** Değişen dosyalar: `docs/architecture/openapi.yaml`,
`docs/architecture/shared-types.ts`.
(Sözleşme doğrulandı: YAML geçerli, 171 path, 222 şema, 278 benzersiz `$ref`'in tamamı çözümleniyor.)
**İlgili dokümanlar:** ARCHITECTURE.md §10.19 (konteyner mimarisi), §10.7 (içerik listesi),
`.claude/design-notes-page-builder-containers.md`, `.claude/architect-scope-i18n.md` (§2.3.1
emsali — enum/boolean tercihi).
**Bu doküman bağlayıcıdır.** Ajanlar arası çelişkide `openapi.yaml` + bu doküman hakemdir.

---

## 0. Yönetici özeti — istek ile kod tabanı arasındaki uyumsuzluk

Kullanıcı isteği: *"Admin ve Editor rolleri tam yetkili, Standart/Yazar rolleri kısıtlı."*

Kod tabanı doğrulandı (`backend/prisma/schema.prisma:48-52`, `pages.routes.ts`):

| İddia | Gerçek durum | Sonuç |
|---|---|---|
| "Standart/Yazar rolü var" | `SiteRole` = `ADMIN` \| `EDITOR` \| `VIEWER`. Başka rol YOK. | İstek, VAR OLMAYAN bir role atıf yapıyor |
| "Kısıtlı rol düzenleyebiliyor" | `VIEWER` sayfa yazma uçlarının HİÇBİRİNE erişemiyor (`requireSiteRole("ADMIN","EDITOR")`) | VIEWER "kısıtlı editör" DEĞİL, hiç editör değil |
| "Sayfa düzenleme modu var" | `Page`'de `editMode`/`isLocked` alanı YOK; blok bazlı kilit YOK | Sıfırdan tanımlanacak |
| "Yetki kontrolü rol seviyesinde" | Var olan tüm kontrol UÇ (endpoint) seviyesinde | İstenen kısıt ALAN (field) seviyesinde — farklı granülarite |

**En kritik mimari tespit:** istenen kısıtlama bir *uç erişimi* kısıtlaması değil, **tek bir
isteğin gövdesi İÇİNDEKİ alanların** kısıtlanmasıdır ("başlığı değiştirebilir, konteyner
ekleyemez"). `requireSiteRole` uç seviyesinde çalışır ve bu problemi **yapısal olarak
çözemez**. Bu tespit, §1'deki rol kararının belirleyici gerekçesidir.

---

## 1. KARAR: Rol modeli — **yeni `SiteRole` enum değeri EKLENMEZ; kullanıcı-başı YETENEK (capability) alanı eklenir**

### 1.1 Karar

```
Depolanan alan (DB):   User.advancedBuilderEnabled  Boolean  @default(false)
Türetilen alan (DTO):  User.canUseAdvancedBuilder    boolean  (salt-okunur)

canUseAdvancedBuilder = (role === "ADMIN") || advancedBuilderEnabled === true
```

**`SiteRole` enum'ına DOKUNULMAZ.** `AUTHOR` diye bir rol EKLENMEZ.

### 1.2 Terminoloji eşlemesi (bağlayıcı — tüm ajanlar bu tabloyu kullanır)

Kullanıcının istediği kavramlar, projenin 3-rol gerçeğine şöyle oturur:

| Kullanıcının dediği | Projedeki karşılığı | Etkin yetenek |
|---|---|---|
| "Admin — tam yetkili" | `SiteRole = ADMIN` | Gelişmiş (HER ZAMAN, DB alanına bakılmaz) |
| "Editor — tam yetkili" | `SiteRole = EDITOR` + `advancedBuilderEnabled = true` | Gelişmiş |
| **"Standart / Yazar — kısıtlı"** | `SiteRole = EDITOR` + `advancedBuilderEnabled = false` | **Standart** |
| (istekte yok) | `SiteRole = VIEWER` | Hiç düzenleyemez (bugünkü davranış, DEĞİŞMEZ) |

**Kullanıcıya dönük etiketler** (ui-designer bunları sabitler, her ajan AYNISINI kullanır):

| Durum | Panelde gösterilecek etiket |
|---|---|
| ADMIN | `Yönetici` |
| EDITOR + gelişmiş | `Editör (Gelişmiş Düzenleyici)` |
| EDITOR + standart | `Yazar (Standart Düzenleyici)` |
| VIEWER | `İzleyici` |

Yani kullanıcının istediği "Yazar" rolü **UI seviyesinde vardır ve görünür**; veri modelinde
ayrı bir enum değeri olarak DEĞİL, `rol + yetenek` çiftinin türevi olarak temsil edilir.

### 1.3 Gerekçe — neden (a) `AUTHOR` enum değeri DEĞİL

1. **Yanlış granülarite (belirleyici gerekçe).** `SiteRole`, `requireSiteRole` guard'ları
   üzerinden **uçlara** erişimi yönetir. İstenen kısıt ise `PATCH /admin/pages/{id}`
   gövdesindeki `blocks` ağacının İÇİNDE, düğüm bazında ("bu metni değiştirebilirsin, bu
   konteyner ayarını değiştiremezsin") uygulanmak zorundadır. Enum değeri eklemek, sorunun
   `requireSiteRole` ile çözüldüğü **yanılsamasını** yaratır; gerçek uygulama yine gövde
   seviyesinde yazılmak zorunda kalırdı. İki mekanizma, tek problem = kaçınılmaz drift.
2. **Devasa patlama yarıçapı.** Kod tabanında ~40 ayrı `requireSiteRole("ADMIN","EDITOR")`
   çağrısı var (pages, blog, media, contact, stats, revisions, portfolio, products…).
   `AUTHOR` eklemek, bunların HER BİRİ için "AUTHOR dahil mi?" sorusunun ayrı ayrı
   yanıtlanmasını gerektirir. Tek bir unutulan yer = ya sessiz ayrıcalık sızıntısı ya da
   kırık özellik (ör. medya yükleme 403 verirse Görsel bloğu çalışmaz — sayfa düzenleme de
   fiilen çalışmaz). Bu risk, istenen özelliğin değerinin kat kat üstünde.
3. **Geri alınamazlık.** PostgreSQL'de `ALTER TYPE ... ADD VALUE` geri alınamaz. Kod tabanı
   bunu iki ayrı yerde açıkça not etmiş (`schema.prisma:56-58` ve `:96-97`) ve bu tür
   migration'ların **tek başına** gönderilmesini şart koşmuş. Boolean bir kolon her iki yöne
   de serbestçe çevrilebilir; yeteneği bir kullanıcıdan geri almak da vermek de simetriktir.
4. **Değişecek yüzey sayısı.** `AUTHOR`: prisma enum + migration + `PERMISSIONS_MATRIX` +
   openapi'deki **6 ayrı** `enum: [ADMIN, EDITOR, VIEWER]` bildirimi + `UsersStatsRoleDistribution`
   + frontend `SiteRole` union + rol seçici dropdown'lar + seed + testler + ~40 guard triyajı.
   Yetenek alanı: 1 kolon + 1 uç + 2 DTO alanı + 1 türetme yardımcısı.

### 1.4 Gerekçe — neden (c) "EDITOR'ü ikiye böl" DEĞİL

Mevcut `EDITOR`'ü "standart" yapıp üstüne yeni bir rol eklemek, **yayındaki her EDITOR
hesabının yetkisini sessizce daraltır**. Bu, kullanıcının açık isteğinin ("Editor tam
yetkili") tam tersidir ve mevcut kullanıcılar için bir regresyondur. Reddedildi.

### 1.5 Neden iki ayrı ad (`advancedBuilderEnabled` vs `canUseAdvancedBuilder`)

- `advancedBuilderEnabled` = **verilen izin** (yönetici ne ayarladı). Yazılabilir.
- `canUseAdvancedBuilder` = **etkin yetenek** (sistem ne uyguluyor). Salt-okunur, türetilmiş.

ADMIN için etkin değer DB'deki değere **bakılmaksızın** `true`'dur. Gerekçe — **kilitlenme
güvenliği**: aksi halde bir yönetici tüm hesapların (kendisi dahil) yeteneğini kapatıp
freeform sayfaları düzeltebilecek hiç kimse bırakmayabilir ve UI üzerinden geri dönüş yolu
kalmaz. Bu, `assertNotLastActiveAdmin` (`admin-users.routes.ts`) ile aynı savunma refleksidir.

Türetme **tek bir yardımcıda** yapılır: `backend/src/lib/builder-capability.ts` →
`export function canUseAdvancedBuilder(user: { role: SiteRole; advancedBuilderEnabled: boolean }): boolean`.
Her route kendi `role === "ADMIN" || ...` ifadesini YAZMAZ (i18n işindeki `applyLocale`
kopyalanması hatasının tekrarlanmaması için).

### 1.6 `VIEWER` + `advancedBuilderEnabled = true` durumu

**Kabul edilir, 422 ÜRETİLMEZ.** Etkin yetenek zaten anlamsızdır çünkü VIEWER yazma
uçlarından `requireSiteRole` ile ÖNCE reddedilir. Çapraz-alan doğrulaması (rol VIEWER ise
bayrağı reddet) eklemek, ileride rol değişince ortaya çıkacak bir tutarsızlık tuzağıdır —
backend-agent bunu **icat etmeyecek**.

### 1.7 Kapsam sınırı (bağlayıcı)

Bu, projenin **TEK** kullanıcı-başı yetenek bayrağıdır. İkinci bir `User.canX` bayrağı
eklemek isteyen her ajan **önce architect'e eskale eder**; ikinci ihtiyaç ortaya çıktığı an
doğru cevap yeni bir boolean değil, gerçek bir `Permission`/`UserPermission` tablosudur.
Bugün o tabloyu açmak — tek bir yetenek için — spekülatif genellemedir.

---

## 2. KARAR: `Page.editMode` — sayfa seviyesinde mod; blok bazlı `isLocked` **v1'de YOK**

### 2.1 Karar

```prisma
enum PageEditMode {
  FREEFORM  // Serbest tasarım — yapıyı değiştirmek serbest (bugünkü davranış)
  TEMPLATE  // Şablon — yapı DONMUŞ; standart kullanıcı yalnızca içerik alanlarını doldurur
}

model Page {
  editMode PageEditMode @default(FREEFORM)
}
```

Blok/düğüm bazlı `isLocked: boolean` **bu turda EKLENMEZ.**

### 2.2 Neden blok bazlı `isLocked` DEĞİL (güvenlik gerekçesi, belirleyici)

`isLocked`, `Page.blocks` JSON'unun **içinde** yaşardı. Ama `blocks`, yetkilendirilmeye
çalışılan isteğin **kendi gövdesidir**: standart bir kullanıcı `PATCH` ile tüm ağacı
gönderir. Yani kullanıcı, kendisini kısıtlayan bayrağı `false` göndererek **kendi kendini
yetkilendirebilirdi**. Bunu engellemek için sunucunun gelen `isLocked` değerlerini kayıtlı
olanlarla düğüm düğüm karşılaştırması gerekirdi — yani zaten §3'teki diff mekanizmasını
yazmak, üstüne bir de onu kendi kendine referans veren bir alanla karmaşıklaştırmak.

`editMode` bu tuzağa düşmez: **ayrı bir kolondur**, standart kullanıcının gönderebileceği
şemada YOKTUR, dolayısıyla saldırı yüzeyi yoktur.

**Ne zaman `isLocked` gerekir:** "freeform bir sayfada SADECE hero bölümü kilitli olsun"
ihtiyacı doğduğunda. Bu, istenen özelliğin (kullanıcı modu ayrımı) parçası DEĞİLDİR ve ayrı
bir turda, §3'teki diff altyapısı oturduktan SONRA ele alınır (`feature/page-block-locking`).

### 2.3 Neden enum, boolean `isTemplate` değil

`.claude/architect-scope-i18n.md` §2.3.1'de `documentType` enum'ı REDDEDİLİP
`isLegalDocument` boolean'ı seçilmişti. Buradaki cevabın farklı olmasının nedeni:

- Orada reddedilen şey **açık uçlu bir taksonomiydi** ("belge türü" sınırsız büyür).
  Burada tanımlanan şey **kapalı bir editör modudur** — düzenleyicinin kaç modu olacağı bir
  tasarım kararıdır, veri çeşitliliği değil.
- `isTemplate: false` "serbest tasarım" DEMEZ; sadece "şablon değil" der. Mod isimlerinin
  ikisinin de adı olması, DTO/UI/audit metinlerinde tek bir terminoloji sağlar.
- Aynı modeldeki `PageStatus` birebir bu desendir — tutarlılık.

### 2.4 Varsayılan ve backfill

- Kolon varsayılanı: **`FREEFORM`**. Mevcut TÜM sayfalar `FREEFORM` başlar → **davranış
  değişikliği sıfır**, backfill/veri migration'ı GEREKMEZ.
- Yeni sayfa oluşturmada da varsayılan `FREEFORM` (sayfayı ancak gelişmiş bir kullanıcı
  oluşturabilir — bkz. §4.1).

### 2.5 `editMode`'u kim değiştirebilir

**ADMIN veya gelişmiş yetenekli EDITOR.** Yalnızca-ADMIN yapılmadı: şablon tasarlamak tam
olarak gelişmiş editörün işidir, ve ADMIN'siz bir ekipte özellik kullanılamaz hale gelirdi.

**Ayrıcalık yükseltme riski YOK** (security-agent için açık gerekçe): bu alanı
değiştirebilen kişi zaten gelişmiş yeteneğe sahiptir, yani `TEMPLATE` modu onu HİÇ
kısıtlamıyordur. Bir şeyi `freeform`'a çevirmek ona yeni bir yetki KAZANDIRMAZ. Standart
kullanıcı ise bu alanı gönderemez (§4.2) — ki kısıtı olan tek taraf odur.

Denetim: değeri DEĞİŞTİREN her istek → `logAudit(action: "content.edit_mode_change",
targetType: "Page", metadata: { from, to })`. `content.legal_flag_change` ile birebir aynı desen.

---

## 3. KARAR: Şablon modunda düzenlenebilir alanlar ve uygulama mekanizması

### 3.1 Alan haritası — `block.settings.editableFields` DEĞİL, **koddaki sabit tip haritası**

Görevde sorulan iki seçenekten ikincisi seçildi. Gerekçe:

1. `editableFields` de §2.2'deki **kendi kendini yetkilendirme** tuzağına düşer — listenin
   kendisi kullanıcı tarafından gönderilen veridir; kullanıcı listeye `"settings"` ekleyebilir.
2. Sabit harita **tek, gözden geçirilebilir, test edilebilir bir sabittir** — security-agent
   tek dosyaya bakarak tüm politikayı denetleyebilir.
3. Yeni oluşturulan bloklar için otomatik doğrudur (liste yazmayı unutmak diye bir şey yok).

**Kaynak dosya (otorite):** `backend/src/lib/page-template-fields.ts` →
`export const TEMPLATE_EDITABLE_FIELDS: Record<string, readonly string[]>`
**Ayna (frontend):** `frontend/src/lib/page-builder/template-fields.ts` — içerik BİREBİR
aynı olmak ZORUNDADIR (`MAX_CONTAINER_DEPTH` vb. sabitler için zaten uygulanan kural).

**Fail-closed kuralı (bağlayıcı):** haritada olmayan her `type` için düzenlenebilir alan
kümesi **boştur**. Yani standart kullanıcı o bloğun hiçbir alanını değiştiremez. Bilinmeyen/
gelecek blok tipleri otomatik olarak kilitli gelir.

### 3.2 Harita (bağlayıcı — anahtar yolları `data.` ile başlar)

| Blok tipi | Şablon modunda DÜZENLENEBİLİR | Kilitli (örnekler) |
|---|---|---|
| `heading` | `data.text` | `level`, `align`, `underline` |
| `text` | `data.html` | — (tek alan; `sanitizeRichHtml`'den geçmeye devam eder) |
| `image` | `data.url`, `data.alt`, `data.caption` | `radius`, `lightbox` |
| `button` | `data.label`, `data.href` | `style`, `size`, `align` |
| `hero` | `data.heading`, `data.subheading`, `data.imageUrl` | — |
| `cta` | `data.heading`, `data.description`, `data.buttonLabel`, `data.buttonHref`, `data.secondaryButtonLabel`, `data.secondaryButtonHref` | `align`, `style` |
| `icon-box` | `data.heading`, `data.description`, `data.href` | `icon` |
| `gallery` | `data.images` | `layout` |
| `video` | `data.provider`, `data.url` | `autoplay`, `muted` |
| `accordion` | `data.items` | `allowMultipleOpen` |
| `tabs` | `data.items` | `orientation` |
| `counter` | `data.items` | — |
| `testimonial` | `data.items` | — |
| `pricing-table` | `data.plans` | — |
| `latest-posts` | `data.heading`, `data.limit` | — |
| `featured-products` | `data.heading`, `data.limit` | — |
| `featured-portfolio` | `data.heading`, `data.limit` | — |
| `contact-form` | `data.showTitle` | — |
| `before-after-slider` | `data.beforeUrl`, `data.afterUrl`, `data.beforeLabel`, `data.afterLabel` | `orientation` |
| `logo-marquee` | `data.items` | `speedSeconds`, `pauseOnHover` |
| `skill-bar` | `data.items` | — |
| `team` | `data.members` | — |
| `divider` | **(hiçbiri)** | tamamı — saf düzen elemanı |
| **`custom-html`** | **(hiçbiri) — KESİN** | tamamı (§3.3) |
| `container` | **(hiçbiri)** | `settings` bütünüyle, `children`, `reveal` |

Bu haritanın kullanıcıya dönük özeti, görevdeki dört kategoriyle örtüşür: **başlık / zengin
metin / görsel / buton-link** + dizi tabanlı içerik listeleri (galeri, SSS, yorum, plan…).

Dizi alanlarının (`data.items`, `data.images`, `data.plans`, `data.members`) **tamamı**
düzenlenebilirdir; yani standart kullanıcı öğe ekleyip silebilir. Bu bilinçlidir — bunlar
içeriktir, düzen değil. Mevcut Zod uzunluk tavanları (`GALLERY_MAX_IMAGES`,
`ACCORDION_MAX_ITEMS` …) aynen geçerlidir.

### 3.3 `custom-html` istisnası (bağlayıcı, gerekçeli)

Standart kullanıcı `custom-html` bloğunun `data.html` alanını **hiçbir koşulda**
değiştiremez. `sanitizeCustomHtmlBlock` var olmasına rağmen: bu blok, projedeki en geniş
HTML izin listesine sahip yüzeydir ve ham kod yazmak tanım gereği "gelişmiş" bir eylemdir.
Standart modun tüm anlamı, kullanıcıyı form alanlarıyla sınırlamaktır.

### 3.4 KARAR: Uygulama katmanı — **Zod DEĞİL, route seviyesi (yükleme sonrası, yazma öncesi)**

Görevde sorulan soru budur; cevap kesin:

**Zod bu kısıtı UYGULAYAMAZ** — ve denenmemelidir. Gerekçe: kural mutlak değil **görecelidir**
("kayıtlı ağaca göre neyi değiştirdin?"). Zod gövdeyi izole olarak doğrular, veritabanındaki
mevcut ağaca erişimi yoktur. Dolayısıyla:

- `PageBlockListSchema` ve tüm blok şemaları **DEĞİŞMEZ**. `pages.schemas.ts`'e standart
  kullanıcı için ikinci/dar bir şema varyantı **YAZILMAZ** — bu ~1000 satırlık blok şemasını
  çatallamak ve kaçınılmaz drift demektir. backend-agent bunu yapmayacaktır.
- Kısıt, şema parse'ından SONRA, `existing` kayıt yüklendikten sonra, DB yazımından ÖNCE
  route katmanında çalışan tek bir yardımcıyla uygulanır.

**Yardımcı:** `backend/src/lib/page-template-guard.ts` →
```
assertTemplateEditAllowed(existingBlocks: unknown[], incomingBlocks: unknown[]): void
```
`ApiError(403, "FORBIDDEN", …)` fırlatır (aşağıya bkz.).

**Algoritma (bağlayıcı):**
1. İki ağacı da **iteratif** (explicit stack) olarak doküman sırasında dolaş. **ÖZYİNELEME
   YASAK** — gerekçe `lib/page-blocks.ts` başlığındaki stack-overflow analizinin aynısıdır;
   mevcut `flattenPageBlocks` deseni yeniden kullanılmalıdır.
2. Düğüm sayısı, `id` dizisi ve her `id` için `type` **birebir aynı** olmalı. Ekleme, silme,
   sıralama değişikliği, taşıma → **403**.
3. `container` düğümlerinde `settings` ve `reveal` **derin eşit** olmalı → değilse 403.
4. İçerik bloklarında: `TEMPLATE_EDITABLE_FIELDS[type]` dışındaki HER alan (`reveal` dahil)
   derin eşit olmalı → değilse 403.
5. İhlaller toplanır; ilk 10 tanesi hata `details`'ine yazılır, gerisi sayılır.

**Hata sözleşmesi:** HTTP **403**, `error.code = "FORBIDDEN"`.
Mesaj (TR, sabit): `"Bu sayfa şablon modunda; yalnızca içerik alanlarını düzenleyebilirsiniz."`
`error.details` mevcut `Record<string, string[]>` şeklini KULLANIR (yeni bir zarf alanı
eklenmez): `{ "blocks": ["<nodeId>: yapı değiştirilemez", "<nodeId>: data.style değiştirilemez", …] }`.
Not (backend-agent): `ForbiddenError` sınıfı bugün `details` parametresi almıyor —
`new ApiError(403, "FORBIDDEN", msg, details)` doğrudan kullanılmalı ya da `ForbiddenError`
opsiyonel `details` alacak şekilde genişletilmelidir (tercih edilen: ikincisi).

### 3.5 `assertTemplateEditAllowed` HANGİ yollarda çağrılır (atlanırsa güvenlik açığı)

| Yol | Çağrılır mı |
|---|---|
| `PATCH /admin/pages/{pageId}` (`blocks` gönderildiyse) | **EVET** |
| `POST /admin/pages/{pageId}/autosave` (`blocks` gönderildiyse) | **EVET — en kritik madde** |
| `POST /admin/pages/{pageId}/revisions/{revisionId}/restore` | Hayır — bu uç standart kullanıcıya tamamen kapalı (§4.1) |
| `POST /admin/pages` | Hayır — uç standart kullanıcıya kapalı (§4.1) |

> **autosave uyarısı (bağlayıcı):** autosave, `PATCH`'ten ayrı bir kod yoludur ve `blocks`
> yazar. Burada kontrol unutulursa 3 saniyelik debounce ile TÜM kısıt sessizce baypas edilir.
> qa-agent için bu, e2e testinin **zorunlu** senaryosudur.

---

## 4. Yetki matrisi — hangi işlem hangi yetenek gerektirir

### 4.1 Uç seviyesi (yeni guard: `requireAdvancedBuilder`)

Yeni middleware: `backend/src/middleware/advanced-builder.ts` →
`requireAdvancedBuilder()` — `requireSiteRole(...)`'den SONRA çalışır, `canUseAdvancedBuilder(request.user)`
false ise `ForbiddenError` + `logAudit(status: "FORBIDDEN")` (site-rbac.ts'teki desenin aynısı).

| Uç | Bugün | Yeni |
|---|---|---|
| `GET /admin/pages`, `GET /admin/pages/{id}` | authenticated | **değişmez** |
| `POST /admin/pages` | ADMIN, EDITOR | + **gelişmiş yetenek** |
| `PATCH /admin/pages/{id}` | ADMIN, EDITOR | değişmez (alan seviyesi kontrol, §4.2) |
| `POST /admin/pages/{id}/autosave` | ADMIN, EDITOR | değişmez (alan seviyesi kontrol, §4.2) |
| `DELETE /admin/pages/{id}` (çöpe at) | ADMIN, EDITOR | + **gelişmiş yetenek** |
| `POST /admin/pages/{id}/restore` | ADMIN, EDITOR | + **gelişmiş yetenek** |
| `DELETE /admin/pages/{id}/permanent` | ADMIN | **değişmez** |
| `POST /admin/pages/bulk` | ADMIN, EDITOR | + **gelişmiş yetenek** |
| `GET .../revisions`, `GET .../revisions/{id}` | ADMIN, EDITOR | **değişmez** (okuma serbest) |
| `POST .../revisions/{id}/restore` | ADMIN, EDITOR | + **gelişmiş yetenek** |

**İlke:** *standart kullanıcı içeriği değiştirir; yapıyı ve geri alınamaz yaşam döngüsü
işlemlerini değiştirmez.*

**`POST /admin/pages` neden kapalı (açık gerekçe):** boş bir sayfanın yapısı yoktur; şablon
modu "var olan yapının alanlarını doldur" demektir. Standart kullanıcıya boş sayfa
oluşturtmak onu, hiçbir şey ekleyemeyeceği bir çıkmaza sokar. Standart kullanıcı, gelişmiş
bir kullanıcının hazırladığı sayfaları düzenler.
**KAPSAM DIŞI (bilinçli, takip kalemi `feature/page-duplicate-from-template`):** standart
kullanıcının var olan bir şablon sayfayı **kopyalayarak** yeni sayfa üretmesi. Bugün bir
"duplicate" ucu YOK; bu özelliği bu tura dahil etmek kapsamı genişletir.

**KAPSAM DIŞI (bilinçli):** editoryal onay/moderasyon akışı. Standart kullanıcı `status`
alanını (yayınlama dahil) değiştirmeye devam eder — bugün EDITOR'ün sahip olduğu bir haktır
ve isteğin konusu değildir. Yayın onayı isteniyorsa ayrı bir iş olarak architect'e gelir.

### 4.2 Alan seviyesi — standart kullanıcının `PATCH`/autosave gövdesi

| Alan | Standart kullanıcı |
|---|---|
| `title`, `seoTitle`, `seoDescription`, `ogTitle`, `ogImageUrl`, `canonicalUrl`, `noIndex` | Serbest |
| `status`, `scheduledAt` | Serbest (§4.1 kapsam notu) |
| `translations` | Serbest — AMA içindeki `blocks` de §3.4 diff'inden GEÇER (aşağıya bkz.) |
| `blocks` | **Yalnızca §3.2 haritasındaki alanlar** |
| `slug` | **403** — sayfanın URL'i yapısaldır |
| `editMode` | **403** (§2.5) |
| `isLegalDocument` | **403** — zaten ADMIN-only (mevcut davranış) |
| `authorId` | **403** — zaten ADMIN-only (mevcut davranış) |

**`translations.<locale>.blocks` (atlanması kolay, bağlayıcı):** çeviri gövdeleri de blok
ağacıdır ve `PageBlockListSchema`'dan geçer. Şablon modunda bunlar da diff'e tabidir:
her locale için, o locale'in kayıtlı `blocks`'u ile gelen `blocks`'u karşılaştır. Kayıtlı
çeviri YOKSA (ilk çeviri), referans olarak **kanonik `blocks`** kullanılır — böylece çeviri
eklemek metin doldurmak olur, yapı klonlamak değil.

### 4.3 `advancedBuilderEnabled` alanını kim değiştirir

Yalnızca **ADMIN**, yeni uçtan: `PATCH /admin/users/{userId}/builder-access`.
`/role` ve `/status` uçlarıyla birebir aynı desen: `ADMIN_USERS_RATE_LIMIT` (20/dk),
`DELETED` kullanıcıda `404`, audit `action: "user.builder_access_change"`.
Kendi bayrağını kapatma: ADMIN için etkin değer zaten `true` (§1.5) → kilitlenme imkânsız,
ek bir 409 kuralı GEREKMEZ.

---

## 5. API sözleşmesi — `openapi.yaml` + `shared-types.ts` (BU GÖREVDE GÜNCELLENDİ)

`docs/architecture/shared-types.ts` de aynı alanlarla güncellendi (`User.canUseAdvancedBuilder`,
`AdminUser.advancedBuilderEnabled`, `UpdateAdminUserBuilderAccessRequest`,
`PermissionsMatrix.capabilities`). `Page`/`CreatePageRequest`/`UpdatePageRequest` bu dosyada
TANIMLI DEĞİLDİR (yalnızca `openapi.yaml`'da) — bu mevcut bir durumdur, bu turda değiştirilmedi.


| Tür | Ad | Not |
|---|---|---|
| schema | `User.canUseAdvancedBuilder` | **Türetilmiş, salt-okunur.** `/auth/session`, `/users/me`, `/admin/users` — hepsinde döner |
| schema | `AdminUser.advancedBuilderEnabled` | Ham/depolanan izin; yalnızca ADMIN görür |
| schema | `PageEditMode` | `FREEFORM` \| `TEMPLATE` |
| schema | `Page.editMode` | Varsayılan `FREEFORM` |
| schema | `CreatePageRequest.editMode`, `UpdatePageRequest.editMode` | Standart kullanıcı gönderirse 403 |
| schema | `UpdateAdminUserBuilderAccessRequest` | `{ advancedBuilderEnabled: boolean }` |
| schema | `PermissionsMatrix.capabilities` | Matrisin rol-türevi OLMAYAN yetenekleri de anlatması için |
| path | `PATCH /admin/users/{userId}/builder-access` | ADMIN-only |
| tag | `Pages` açıklaması | Gelişmiş yetenek şartı ve 403 semantiği eklendi |
| düzeltme | `ApiErrorEnvelope.error.code` enum | `BAD_REQUEST` + `EMAIL_DELIVERY_FAILED` eksikti (`lib/errors.ts` bunları ÜRETİYOR) — drift kapatıldı |

**Bağlayıcı sözleşme kuralları:**

1. **`canUseAdvancedBuilder` istemciye yalnızca UI için verilir, karar mercii DEĞİLDİR.**
   Sunucu her yazma isteğinde bağımsız olarak yeniden hesaplar. Frontend'in bu alana bakarak
   butonu gizlemesi bir kolaylıktır, bir güvenlik kontrolü değil.
2. **Yapısal ihlal `403`'tür, `422` değil.** Gövde geçerlidir (şema doğrular), izin yoktur.
   `422` yanlış sinyal verir ("verini düzelt") — kullanıcı verisini düzeltemez, yetkisi yoktur.
3. **`editMode: TEMPLATE` gelişmiş kullanıcıyı kısıtlamaz.** Mod, standart kullanıcı için bir
   politikadır; sayfa geneli bir kilit DEĞİLDİR.
4. **Public uçlar (`GET /pages`, `/pages/{slug}`) `editMode`'dan ETKİLENMEZ.** Bu tamamen bir
   yazma/yetkilendirme kavramıdır; ziyaretçi çıktısında hiçbir karşılığı yoktur.

---

## 6. Görev dağılımı

Sıra: **db-agent → backend-agent → (ui-designer ∥ security-agent) → frontend-agent → qa-agent.**

### 6.1 db-agent
1. `User.advancedBuilderEnabled Boolean @default(false)` ekle (`schema.prisma`).
2. **Backfill (migration SQL'inin parçası, zorunlu):**
   `UPDATE users SET advanced_builder_enabled = true WHERE role IN ('ADMIN','EDITOR');`
   Gerekçe: kolon varsayılanı `false`'tur (yeni hesaplar için en az ayrıcalık), ama mevcut
   editörlerin yetkisi **sessizce daraltılamaz** — bu bir regresyon olurdu.
3. `enum PageEditMode { FREEFORM TEMPLATE }` + `Page.editMode PageEditMode @default(FREEFORM)`.
   Bu bir **`CREATE TYPE`**'dır, `ALTER TYPE ... ADD VALUE` DEĞİLDİR — geri alınamazlık
   uyarısı bu migration için geçerli değildir. Backfill GEREKMEZ.
4. İndeks EKLEME. `editMode` üzerinde filtreleme/sıralama yapılmıyor; `advancedBuilderEnabled`
   yalnızca tekil kullanıcı okumasında kullanılıyor. Spekülatif indeks açılmaz.
5. `///` yorumlarına bu dokümana referans düş (`.claude/architect-scope-page-editor-roles.md`).
6. **YAPMA:** yetenek türetme mantığı, guard, diff (backend-agent'ın).

### 6.2 backend-agent
1. `backend/src/lib/builder-capability.ts` — tek türetme yardımcısı (§1.5). Her yerde bu
   kullanılır, `role === "ADMIN" || ...` ifadesi HİÇBİR route'a kopyalanmaz.
2. `backend/src/middleware/advanced-builder.ts` — `requireAdvancedBuilder()`,
   `middleware/site-rbac.ts` desenini birebir izler (403 + `FORBIDDEN` audit).
3. `backend/src/lib/page-template-fields.ts` — `TEMPLATE_EDITABLE_FIELDS` (§3.2 tablosu
   BİREBİR). Fail-closed varsayılan.
4. `backend/src/lib/page-template-guard.ts` — `assertTemplateEditAllowed` (§3.4).
   **İTERATİF olmak ZORUNDA** (`lib/page-blocks.ts` desenini yeniden kullan; özyineleme yasak).
5. `pages.routes.ts`:
   - §4.1 tablosundaki uçlara `requireAdvancedBuilder` ekle.
   - `PATCH` ve **`autosave`** yollarında: `existing.editMode === "TEMPLATE"` VE
     `!canUseAdvancedBuilder(user)` ise `assertTemplateEditAllowed` çağır — hem `blocks` hem
     her locale için `translations.<locale>.blocks` (§4.2).
   - `slug`/`editMode` alanları için `assertLegalDocumentAuthorized` ile **aynı desende**
     `assertAdvancedFieldsAuthorized` guard'ı.
   - `editMode` değişiminde `content.edit_mode_change` audit'i.
6. `pages.schemas.ts`: **yalnızca** `CreatePageRequestSchema`/`UpdatePageRequestSchema`'ya
   `editMode: z.enum(["FREEFORM","TEMPLATE"]).optional()` eklenir.
   **`PageBlockListSchema` ve blok şemalarına DOKUNULMAZ; ikinci bir şema varyantı yazılmaz** (§3.4).
7. `admin-users.routes.ts` + `admin-users.schemas.ts`: `PATCH /admin/users/{userId}/builder-access`.
8. `lib/permissions-matrix.ts`: yeni `capabilities` bölümü (openapi'deki şekille birebir).
9. Page DTO'suna `editMode`, User DTO'suna `canUseAdvancedBuilder` ekle
   (`AdminUser` DTO'suna ayrıca ham `advancedBuilderEnabled`).
10. Unit test (zorunlu kapsam): standart kullanıcı → konteyner ekleme **403**; `settings`
    değişikliği **403**; `data.text` değişikliği **200**; `custom-html.data.html` değişikliği
    **403**; **autosave üzerinden yapısal değişiklik 403**; `translations.en.blocks` üzerinden
    yapısal değişiklik **403**; freeform sayfada aynı isteklerin **200** dönmesi; gelişmiş
    EDITOR'ün template sayfada kısıtsız olması; ADMIN'in `advancedBuilderEnabled=false` iken
    dahi gelişmiş olması (§1.5).
11. **YAPMA:** şema tasarımı (§6.1'i tüket), görsel karar. Şema değişikliği gerekirse
    architect'e eskale et.

### 6.3 ui-designer (frontend-agent'ı BLOKLAR)
1. **Standart mod görsel dili.** `builder-canvas.tsx` bugün her düğüm için kart + araç çubuğu
   (taşı/sil/çoğalt/sar/aç) gösteriyor. Standart modda bunların **hiçbiri görünmemelidir** —
   ama "devre dışı buton" mu, "hiç yok" mu? **Architect önerisi: hiç yok** (devre dışı
   kontroller, kullanıcıya sürekli erişemediği bir şeyi hatırlatır). Nihai karar senin.
2. **Standart mod bir "form" mu, "canlı önizleme + inline düzenleme" mi?** Bu, özelliğin
   en belirleyici UX kararıdır. Mevcut `ContentBlockBody` düzenleyicileri (blok başına bir
   editör bileşeni) yeniden kullanılacak mı, yoksa §3.2 haritasından türetilen düz bir alan
   listesi mi çizilecek? frontend-agent bu karar gelmeden kod yazmaz.
3. **Rol/yetenek rozetleri** — §1.2 etiket tablosunu tasarım tokeni olarak sabitle
   (`Yönetici` / `Editör (Gelişmiş Düzenleyici)` / `Yazar (Standart Düzenleyici)` / `İzleyici`).
4. **Şablon modu göstergesi.** Gelişmiş kullanıcı `TEMPLATE` bir sayfayı açtığında ne görür?
   (Öneri: editör başlığında bir `Badge` + "yapısal değişiklikleriniz standart kullanıcıların
   formunu etkiler" ipucu.) `Sheet`/`ContainerSettingsPanel` bu durumda değişmez.
5. **403 sunumu.** Yapısal ihlal 403'ü hangi biçimde gösterilir — toast mı, inline `Alert` mi?
   `details.blocks` listesi kullanıcıya gösterilecek mi? (Öneri: toast + ayrıntı listesi
   gösterilmez; kullanıcı zaten o kontrolleri görmüyor olmalı — 403 bir "olmamalıydı" hatasıdır.)
6. **`/admin/users` yetenek anahtarı** — rol dropdown'ının yanında `Switch` mi, ayrı bir
   sütun mu? VIEWER seçiliyken görsel olarak nasıl davranır (§1.6: teknik olarak serbest,
   ama anlamsız — soluk/uyarılı gösterim önerilir).

### 6.4 frontend-agent
1. `frontend/src/lib/api/types.ts`: `User.canUseAdvancedBuilder`, `AdminUser.advancedBuilderEnabled`,
   `Page.editMode`, `PageEditMode`, `UpdateAdminUserBuilderAccessRequest`.
   Kaynak: `docs/architecture/openapi.yaml` (kontrat kazanır).
2. `frontend/src/lib/page-builder/template-fields.ts` — backend haritasının **birebir aynası**.
3. `app/admin/pages/[pageId]/page.tsx`: mod hesabı
   `const simpleMode = page.editMode === "TEMPLATE" && !user?.canUseAdvancedBuilder;`
   Mevcut `isAdmin` (satır 98) deseninin yanına eklenir.
4. `BuilderCanvas`'a `mode: "advanced" | "simple"` prop'u geçir. Standart modda:
   sürükle-bırak sensörleri devre dışı, `AddContentMenu`/`ContainerInserter`/`LayoutMenu`
   render EDİLMEZ, `ContainerSettingsPanel` (sağ çekmece) AÇILMAZ, blok araç çubukları YOK,
   `RevealEffectControl` YOK. Alan düzenleyicileri yalnızca `TEMPLATE_EDITABLE_FIELDS`
   kapsamındakiler.
5. `POST`/`DELETE`/`bulk`/`restore`/revizyon-restore aksiyonlarını yeteneksiz kullanıcıya
   göstermeyin (`app/admin/pages/page.tsx`, `new/page.tsx`, `revision-history.tsx`).
   `/admin/pages/new`'e doğrudan gidilirse anlamlı bir "yetkiniz yok" ekranı.
6. `app/admin/users/page.tsx`: yetenek anahtarı + `usersApi.updateBuilderAccess(...)`
   (`frontend/src/lib/api/users.ts`).
7. **Gizleme bir güvenlik önlemi DEĞİLDİR** (§5.1) — 403 yolu her zaman kullanıcıya anlamlı
   bir mesajla ele alınmalıdır.
8. **YAPMA:** görsel/stil kararı — §6.3'ü bekle.

### 6.5 security-agent
1. **Baypas yüzeyi taraması (bu görevin 1 numaralı denetimi):** `blocks` yazan HER kod
   yolunun `assertTemplateEditAllowed`'dan geçtiğini doğrula. Bilinen yollar: `PATCH`,
   `autosave`, revizyon `restore`, `bulk`. Yeni bir yol eklenmiş mi?
2. `assertTemplateEditAllowed`'ın **iteratif** olduğunu ve `ABSOLUTE_VISIT_CAP` benzeri bir
   tavan taşıdığını doğrula (iki ağaç birden dolaşılıyor — maliyet iki katı).
3. `translations.<locale>.blocks` yolunun kontrole dahil olduğunu doğrula (§4.2).
4. Yetenek türetmesinin tek bir yardımcıdan geldiğini, hiçbir route'ta kopyalanmadığını doğrula.
5. `PATCH /admin/users/{userId}/builder-access`: rate limit, ADMIN-only, `DELETED` kullanıcı
   davranışı, audit kaydı.
6. `custom-html`'in standart kullanıcıya kapalı olduğunu doğrula (§3.3).
7. Yetki reddi audit kayıtlarının PII/gövde içeriği sızdırmadığını doğrula (`metadata`'ya
   blok içeriği YAZILMAZ — yalnızca `nodeId` ve alan adı).

### 6.6 qa-agent (e2e — kritik akış)
1. Standart kullanıcı: şablon sayfada metin düzenle → kaydet → **başarı**.
2. Standart kullanıcı: şablon sayfada konteyner ekle/sil/sırala → **403** (API seviyesinde
   doğrudan istek ile — UI'da buton olmaması yeterli KANIT DEĞİLDİR).
3. **Autosave baypas testi (zorunlu):** UI'da düzenle, 3sn debounce'u bekle, autosave'in
   yapısal değişikliği reddettiğini doğrula.
4. Gelişmiş EDITOR: aynı şablon sayfada tam serbestlik.
5. `advancedBuilderEnabled` kapatıldıktan sonra kullanıcının bir sonraki isteğinde kısıtın
   etkin olması (oturum yenilenmeden — sunucu her istekte yeniden hesaplar).
6. ADMIN, `advancedBuilderEnabled=false` olsa dahi gelişmiş (§1.5).

### 6.7 documentation-agent
ARCHITECTURE.md'ye **§10.20 "Sayfa düzenleyicide standart/gelişmiş mod ayrımı"** bölümü
(§10.19'un devamı) + CHANGELOG.

---

## 7. Definition of Done (bu görev için ek maddeler)

- [ ] `backend/src/lib/page-template-fields.ts` ile `frontend/src/lib/page-builder/template-fields.ts`
      arasında **sıfır fark** (§3.1). Fark varsa backend kazanır.
- [ ] `frontend/src/lib/api/types.ts` ile `docs/architecture/openapi.yaml` arasında
      `User`/`AdminUser`/`Page` alanları için sıfır drift.
- [ ] `blocks` yazan her yolda diff guard'ı çağrılıyor (security-agent onayı).
- [ ] Autosave e2e testi mevcut ve geçiyor (qa-agent).
- [ ] Mevcut EDITOR hesaplarının yetkisi migration sonrası DARALMAMIŞ (§6.1 madde 2).

---

## 8. Bilinçli olarak KAPSAM DIŞI

| Konu | Neden | Takip branşı |
|---|---|---|
| Blok/düğüm bazlı `isLocked` | §2.2 — diff altyapısı önce oturmalı | `feature/page-block-locking` |
| Şablondan sayfa kopyalama (duplicate) | §4.1 — böyle bir uç bugün yok | `feature/page-duplicate-from-template` |
| Editoryal onay/moderasyon akışı | §4.1 — istenmedi, ayrı bir ürün kararı | — |
| Genel `Permission`/`UserPermission` tablosu | §1.7 — tek yetenek için spekülatif | — |
| Blog/Ürün/Portföy editörlerinde aynı ayrım | İstek yalnızca sayfa yönetim sistemi için | — |
| Rol bazlı sayfa sahipliği ("sadece kendi sayfalarını düzenleyebilir") | Farklı bir eksen (sahiplik ≠ yetenek); istenmedi | — |
