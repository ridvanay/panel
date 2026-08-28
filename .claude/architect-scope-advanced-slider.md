# architect-scope: Gelişmiş Slider / Hero Studio (`sliders` modülü)

**Durum:** BAĞLAYICI karar dokümanı. Bu dosya ile `docs/architecture/openapi.yaml`
(`Sliders` tag'i + `/admin/sliders*` + `/sliders/{sliderId}` yolları + `Slider*`/`Slide*`
şemaları) TEK doğruluk kaynağıdır. Çelişki olursa **openapi.yaml kazanır** (bkz.
`.claude/CLAUDE.md` "Çakışma Çözümü").

**Uygulayacak ajanlar:** db-agent → backend-agent → ui-designer ∥ frontend-agent →
security-agent → qa-agent → documentation-agent. Sıralamayı release-coordinator planlar.

**Branş:** `feature/advanced-slider-studio`. Commit'ler Conventional Commits
(`feat(sliders): ...`, `feat(page-builder): ...`).

---

## 1. Kapsam kararları (gerekçeli)

### 1.1 Slider bir "içerik" DEĞİL, yeniden kullanılabilir bir BİLEŞENDİR

`Slider`; `Page`/`BlogPost`/`Product`/`PortfolioItem` ailesine **KATILMAZ**. Bu ailenin
ortak alanları (`status`, `publishedAt`, `scheduledAt`, `translations`, `ContentSlug`,
`ContentRevision`, `viewCount`, `seoTitle`…) slider'da **YOKTUR**.

Gerekçe: slider'ın kendi URL'i yoktur, tek başına ziyaret edilmez, arama motoruna kendi
başına sunulmaz. Ona bir `status` vermek "yayınlanmış sayfa + taslak slider = sessizce boş
hero" gibi teşhis edilmesi zor bir durum üretirdi. Yayın kararı **gömen sayfaya** aittir.

### 1.2 `ContentEntityType` enum'ına `SLIDER` EKLENMEZ

`ContentEntityType` iki şeyi besler: `ContentRevision` ve `ContentSlug` (i18n). Slider
ikisini de kullanmadığı için enum'a değer eklemek (geri alınamaz `ALTER TYPE`) gereksiz
risktir. **db-agent: bu enum'a dokunma.**

### 1.3 v1'de i18n YOK

Katman metinleri çevrilmez. `Slide.translations` kolonu **açılmaz** (kullanılmayan kolon
açmak, sonradan yanlış doldurulmasını davet eder). Çok dilli site, dil başına ayrı bir
slider oluşturup ilgili dilin sayfasına gömer. Backlog: `feature/slider-i18n`.
**compliance-agent notu:** slider verisinde PII yoktur (yalnızca pazarlama içeriği ve
medya referansı) — KVKK etkisi yok.

### 1.4 Yayın kontrolü nerede

| Katman | Kontrol |
|---|---|
| Slider tamamen gizlensin | Gömüldüğü sayfanın `status`'u |
| Tek bir slayt geçici kapansın | `Slide.isActive = false` |
| Slider silinsin | `DELETE /admin/sliders/{id}` → soft-delete + referans koruması (§4.3) |

### 1.5 "Ana sayfaya doğrudan entegrasyon" AYRI bir mekanizma DEĞİLDİR

Ana sayfa zaten `SiteSettings.homePageId`'nin gösterdiği bir `Page`'tir ve
`frontend/src/app/[lang]/(site)/page.tsx` onu `BlockRenderer` ile çizer. Dolayısıyla
**"ana sayfaya slider eklemek" = ana sayfa olarak seçilmiş sayfaya `advanced-slider`
bloğu eklemek.** `SiteSettings`/`SiteAppearance`'a `homeSliderId` gibi bir alan
**EKLENMEZ** — ikinci bir render yolu, ikinci bir sıralama/çakışma kuralı ve "blok mu
ayar mı kazanıyor?" sorusu doğururdu.

Tek istisna: `homePageId === null` iken gösterilen `FallbackHome` (pazarlama sayfası)
slider'ı desteklemez. Admin UI, kullanıcı henüz ana sayfa seçmemişse slider ekranında
bilgilendirici bir bağlantı gösterir (`/admin/settings` → ana sayfa seçimi).

### 1.6 `MODULE_REGISTRY`'ye eklenmez

`products`/`portfolio` gibi kapatılabilir bir modül **değildir**. Kapatıldığında yayındaki
sayfaların hero alanı sessizce boşalırdı — `media`/`navigation` ile aynı sınıfta, çekirdek
bir araçtır. `requireModuleEnabled` middleware'i bu rotalarda **kullanılmaz**.

### 1.7 Yetki (security-agent onayına tabi)

| Uç | SiteRole |
|---|---|
| `GET /admin/sliders`, `GET /admin/sliders/{id}`, `GET .../usage` | ADMIN, MANAGER, **EDITOR** |
| Diğer TÜM `/admin/sliders/*` (POST/PATCH/PUT/DELETE) | ADMIN, MANAGER |
| `GET /sliders/{sliderId}` | public (`security: []`) |

EDITOR'e okuma verilmesinin **tek** gerekçesi: EDITOR sayfa içeriğini düzenleyebilir ve
`advanced-slider` bloğunun seçicisi slider listesini okumak zorundadır (§6.4). EDITOR
slider **oluşturamaz/değiştiremez**. Bu, `Portfolio` tag'indeki "okuma dahil ADMIN|MANAGER"
kuralından bilinçli bir SAPMADIR ve openapi.yaml'da `Sliders` tag'inde açıkça yazılıdır.

Uygulama: `authenticate` + `requirePanelAccess()` hook'ları (portfolio.routes.ts deseni),
yazma uçlarında `preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER)`.

---

## 2. Veri modeli

### 2.1 `Slide` İLİŞKİSEL satır, `layers` JSON — hibrit (bağlayıcı)

Üç seçenek değerlendirildi:

| Seçenek | Karar |
|---|---|
| (A) Her şey `Slider.config` JSON'unda | **RED** — slayt yeniden sıralama/kopyalama/silme uçları veremezdik; `Media` FK'sı kurulamaz, silinen görsel arkada ölü URL bırakırdı; tek satırda 20 slayt × 20 katman = tek bir byte tavanı. |
| (B) `Slider` + `Slide` + `SliderLayer` + `SliderLayerDeviceOverride` (tam ilişkisel) | **RED** — §2.2. |
| (C) `Slider` + `Slide` (ilişkisel) + `Slide.layers` (JSON) | **SEÇİLDİ.** |

`Slide`'ın ilişkisel olma gerekçesi: `order` (sürükle-bırak sıralama), `bgMediaId` →
`Media` FK'sı (`onDelete: SetNull`, kütüphaneden görsel silinince slayt 500 vermez),
`isActive`, slayt başına kopyala/sil uçları, ve katman JSON'unun **slayt başına** byte
tavanına tabi olması.

### 2.2 `layers` neden JSON (SliderLayer tablosu AÇILMAZ)

1. **Erişim deseni:** katmanlar hiçbir zaman tek tek sorgulanmaz/filtrelenmez/join
   edilmez. Her zaman ait oldukları slaytla birlikte, bütün olarak okunur ve yazılır.
   İlişkisel modelin sunduğu hiçbir yetenek (indeks, FK, kısmi güncelleme) kullanılmazdı.
2. **Bu projedeki emsal:** `Page.blocks` tam olarak aynı sınıfta bir veridir (iç içe,
   stil ağırlıklı editör dokümanı) ve `Json`'dur. Frontend'de bir TS ayrık birliği,
   backend'de bir Zod ayrık birliği ile korunur. Aynı deseni tekrarlamak, ekibin zaten
   bildiği doğrulama/normalizasyon araçlarını (`page-blocks.ts` iteratif tarama, byte
   tavanı) yeniden kullanmayı sağlar.
3. **Yazma amplifikasyonu:** tuvalde bir katmanı sürüklemek, ilişkisel modelde
   `SliderLayer` + 2 `SliderLayerDeviceOverride` satırının transaction'ıdır. Editör
   zaten slaytın tam durumunu tutuyor; tek `UPDATE` yeterlidir.
4. **Şema evrimi:** yeni bir katman tipi/stil özelliği eklemek migration gerektirmez.
   `heading|text|button|image|badge` kümesi kesinlikle büyüyecektir (video, sayaç, form).

Karşı-riskin kabulü: JSON'da referans bütünlüğü yoktur. `image` katmanının `url`'i bir
`Media` FK'sı DEĞİLDİR (serbest URL) — bu, `ImageBlock.url`/`GalleryBlock.images[].url`
ile **aynı** kabul edilmiş risktir. Arka plan görseli (asıl LCP kaynağı) ise FK'dır.

### 2.3 Konumlandırma: yüzde + `origin`, sabit tasarım tuvali DEĞİL

Slider Revolution'ın 1920×900 piksel ızgarası + ölçek faktörü yaklaşımı **reddedildi**
(her kırılma noktasında yeniden hesap, yuvarlama kayması, "neden 1px oynadı" hataları).

Tek temsil: `xPercent`/`yPercent` (katmanın slayt kutusundaki koordinatı) + `origin`
(katmanın 9'lu ızgaradaki hangi noktasının o koordinata oturduğu) + isteğe bağlı
`offsetX/offsetY` px ince ayar. Editördeki 9 hizalama düğmesi **ayrı bir alan değildir** —
bu üçlüyü topluca yazan kısayollardır. Render:

```
left: {xPercent}%; top: {yPercent}%;
transform: translate(-{originX}%, -{originY}%) translate({offsetX}px, {offsetY}px);
```

### 2.4 Cihaz override'ları: SEYREK/KISMİ, basamaklı miras

```jsonc
{
  "id": "l1", "type": "heading",
  "content": { "text": "Yeni Sezon", "level": 2 },
  "position": { "xPercent": 10, "yPercent": 50, "origin": "middle-left" },
  "style": { "fontSize": 64, "color": "#ffffff", "fontWeight": 700 },
  "animation": { "inEffect": "fade-up", "delayMs": 200, "durationMs": 600 },
  "responsive": {
    "tablet": { "style": { "fontSize": 44 } },
    "mobile": { "position": { "xPercent": 50, "yPercent": 50, "origin": "middle-center" },
                "style": { "fontSize": 30, "textAlign": "center" } }
  }
}
```

Kurallar (bağlayıcı):
- **Masaüstü kanoniktir** — katmanın kök alanları masaüstüdür, `responsive.desktop`
  anahtarı YOKTUR.
- **Miras basamaklıdır:** `tablet = merge(desktop, responsive.tablet)`,
  `mobile = merge(tablet, responsive.mobile)`. CSS'in zihinsel modeliyle aynı.
- `merge` **derin DEĞİL, alan-grubu seviyesinde SIĞDIR**: `position`, `style`, `animation`
  nesnelerinin **her biri kendi içinde** derin birleştirilir (yukarıdaki örnekte mobil
  `style.color` masaüstünden miras alınır), ama farklı gruplar birbirine karışmaz.
- Override'ı kaldırmak = anahtarı **silmek** (`null` göndermek değil).
- **`content` override EDİLEMEZ (v1 sınırı).** Aynı metnin üç kopyası, düzeltme/çeviri
  sırasında sessizce ayrışır. Mobilde farklı metin isteyen kullanıcı masaüstü katmanını
  `responsive.mobile.hidden = true` yapıp mobil-özel ikinci bir katman ekler.

### 2.5 Prisma şeması (db-agent — doğrudan uygulanabilir)

Yerleşim: `backend/prisma/schema.prisma`, `PortfolioImage` modelinden SONRA, `Locale`
modelinden ÖNCE. Enum'lar dosyanın enum bloğuna (`SocialShareNetwork`'ten sonra).

> **Üçü de `CREATE TYPE`'dır, `ALTER TYPE ... ADD VALUE` DEĞİLDİR** — `SiteUserStatus`/
> `ImportJobType`'taki "geri alınamaz, izole migration" uyarısı bu migration için
> GEÇERLİ DEĞİLDİR; tek migration'da gönderilebilir.

```prisma
// Gelişmiş Slider / Hero Studio — bkz. .claude/architect-scope-advanced-slider.md
// (bağlayıcı karar dokümanı) ve docs/architecture/openapi.yaml `Sliders` tag'i.
enum SliderTransitionEffect {
  SLIDE
  FADE
  CUBE
  ZOOM
}

// FULL_SCREEN = 100svh (100vh DEĞİL — mobil tarayıcı çubuğu zıplaması). Sıfır CLS'in
// tek kaynağı budur: dış kutunun yüksekliği sunucu HTML'inde hesaplanabilir olmalıdır.
enum SliderHeightMode {
  FULL_SCREEN
  CUSTOM_PX
  ASPECT_RATIO
}

// Düz renk için AYRI tip YOK — GRADIENT ile from == to verilir (branş sayısını azaltmak
// için bilinçli karar).
enum SlideBackgroundType {
  IMAGE
  VIDEO
  GRADIENT
}

// Ok/bullet/ilerleme çubuğunun kontrast teması. Gerçek görsel dil ui-designer'ın
// tasarım tokenlerine aittir; bu alan yalnızca "açık zemin mi koyu zemin mi" ayrımıdır.
enum SliderNavigationTheme {
  LIGHT
  DARK
}

// Yeniden kullanılabilir çok katmanlı slayt gösterisi. Bir "içerik" DEĞİLDİR
// (§1.1) — status/publishedAt/scheduledAt/translations/viewCount/SEO alanları
// BİLİNÇLİ OLARAK YOKTUR; yayın kararı gömen Page'e aittir.
model Slider {
  id   String @id @default(uuid())
  seq  Int    @unique @default(autoincrement())
  name String
  // Panel içi okunabilir kimlik. Public erişim slug ile DEĞİL, id ile yapılır
  // (advanced-slider bloğu `data.sliderId` tutar) — slug yeniden adlandırmada bağ
  // koparmasın diye. Yine de @unique: admin URL'i ve elle referans için.
  slug String @unique

  // --- Otomatik oynatma ---
  autoplay     Boolean @default(true)
  intervalMs   Int     @default(6000)
  loop         Boolean @default(true)
  pauseOnHover Boolean @default(true)

  // --- Geçiş ---
  transitionEffect     SliderTransitionEffect @default(SLIDE)
  transitionDurationMs Int                    @default(700)

  // --- Yükseklik (sıfır CLS) ---
  heightMode         SliderHeightMode @default(ASPECT_RATIO)
  heightPx           Int? // yalnızca heightMode=CUSTOM_PX iken anlamlı
  aspectRatioWidth   Int              @default(16)
  aspectRatioHeight  Int              @default(9)
  // Mobil override — null = masaüstüyle AYNI. TABLET için ayrı override YOKTUR
  // (masaüstünü miras alır); üç kırılma noktası için üç yükseklik seti, kazandığından
  // fazla karmaşıklık üretiyordu.
  mobileHeightMode        SliderHeightMode?
  mobileHeightPx          Int?
  mobileAspectRatioWidth  Int?
  mobileAspectRatioHeight Int?

  // --- Navigasyon ---
  showArrows      Boolean               @default(true)
  showBullets     Boolean               @default(true)
  showProgressBar Boolean               @default(false)
  navigationTheme SliderNavigationTheme @default(LIGHT)

  // §10.7 Soft-delete (çöp kutusu) deseni — silme öncesi referans koruması için
  // bkz. GET /admin/sliders/{id}/usage.
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  slides Slide[]

  @@index([deletedAt])
  @@map("sliders")
}

// Bir slaytın arka planı + KATMANLARI. `layers` bilinçli olarak Json'dur (gerekçe:
// tasarım notu §2.2) — ayrı bir SliderLayer tablosu AÇILMAZ. Şekli
// frontend/src/lib/sliders/types.ts::SliderLayer ile eşleşir ve
// backend/src/modules/sliders/sliders.schemas.ts'te Zod ayrık birliğiyle doğrulanır.
model Slide {
  id       String @id @default(uuid())
  sliderId String
  // 0..n-1, PUT /admin/sliders/{id}/slides/order tarafından TOPLUCA yeniden yazılır.
  order    Int    @default(0)
  isActive Boolean @default(true)
  // YALNIZCA panel içi tanımlayıcı (slayt şeridinde gösterilir) — public DTO'da YOK,
  // hiçbir yerde render EDİLMEZ.
  label    String?

  // --- Arka plan ---
  bgType               SlideBackgroundType @default(GRADIENT)
  // Medya kütüphanesinden seçim — serbest URL DEĞİL (coverMediaId paterniyle AYNI).
  // Görsel silinirse SetNull ile boşalır, slayt gradient'e düşer (500 vermez).
  bgMediaId            String?
  // bgType=VIDEO VE bgMediaId yokken kullanılan HARİCİ .mp4 URL'i (SafeHrefSchema).
  bgVideoUrl           String?
  // Poster karesi — bgType=VIDEO iken güçlü tavsiye (yoksa video yüklenene kadar
  // siyah kutu görünür ve LCP ölçümü videoya kayar).
  bgVideoPosterMediaId String?
  // Odak noktası (%), CSS object-position — kırpma kontrolü.
  bgPositionX       Int     @default(50)
  bgPositionY       Int     @default(50)
  // ContainerBackgroundOverlay ile AYNI desen: renk 6 haneli hex, alfa AYRI alanda.
  bgOverlayColor    String?
  bgOverlayOpacity  Int     @default(0)
  bgGradientFrom    String?
  bgGradientTo      String?
  bgGradientAngle   Int     @default(180)
  // Yavaş yakınlaşma. prefers-reduced-motion: reduce altında ZORUNLU OLARAK kapalıdır
  // (kullanıcı ayarı veriyi geçersiz kılar) — bkz. §5.5.
  bgKenBurns        Boolean @default(false)

  // Bu slayta özgü otomatik oynatma süresi; null → Slider.intervalMs.
  durationMs Int?
  // Tüm slaytı tıklanabilir yapar (SafeHrefSchema).
  linkHref   String?
  linkNewTab Boolean @default(false)

  // Katmanlar — sıralı JSON dizi. En fazla MAX_SLIDE_LAYERS (20) öğe ve
  // MAX_SLIDE_LAYERS_BYTES (64 KB); ikisi de backend Zod katmanında zorlanır.
  layers Json @default("[]")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  slider            Slider @relation(fields: [sliderId], references: [id], onDelete: Cascade)
  bgMedia           Media? @relation("SlideBackgroundMedia", fields: [bgMediaId], references: [id], onDelete: SetNull)
  bgVideoPosterMedia Media? @relation("SlideVideoPosterMedia", fields: [bgVideoPosterMediaId], references: [id], onDelete: SetNull)

  @@unique([sliderId, order])
  @@index([sliderId])
  @@index([bgMediaId])
  @@index([bgVideoPosterMediaId])
  @@map("slides")
}
```

`Media` modeline eklenecek karşı-ilişki alanları (zorunlu):

```prisma
  // Gelişmiş Slider — Slide.bgMediaId / Slide.bgVideoPosterMediaId karşı-ilişkileri.
  slideBackgrounds  Slide[] @relation("SlideBackgroundMedia")
  slideVideoPosters Slide[] @relation("SlideVideoPosterMedia")
```

**`@@unique([sliderId, order])` uyarısı (db-agent):** yeniden sıralama tek transaction
içinde yapılmalıdır ve ara adımlarda çakışma oluşabilir. Uygulama sırası:
(1) tüm satırları geçici negatif `order`'a taşı (`order = -(index+1)`), (2) hedef
`0..n-1` değerlerini yaz. Alternatif olarak kısıt kaldırılabilir — **karar: kısıt KALSIN**
(veri bütünlüğü, çift `order` hatası sessizce sıralamayı bozardı).

### 2.6 Sabitler (üç yerde BİREBİR aynı olmak ZORUNDA)

`frontend/src/lib/sliders/types.ts` ∥ `backend/src/modules/sliders/sliders.schemas.ts`
∥ bu doküman:

```ts
export const MAX_SLIDES_PER_SLIDER = 20;
export const MAX_SLIDE_LAYERS = 20;
export const MAX_SLIDE_LAYERS_BYTES = 64 * 1024;
/** Katman çıkış animasyonu VERİ DEĞİL, kod sabitidir (bkz. §3.3). */
export const SLIDER_LAYER_OUT_DURATION_MS = 300;
```

---

## 3. Backend (backend-agent)

### 3.1 Dosya yerleşimi (portfolio modülü deseni)

```
backend/src/modules/sliders/
  sliders.routes.ts        # adminSlidersRoutes + publicSlidersRoutes
  sliders.schemas.ts       # Zod: istek/param/query şemaları
  lib/
    layers.ts              # SliderLayerSchema ayrık birliği + byte/adet tavanı + parse
    slider-usage.ts        # pages.blocks içinde advanced-slider referansı tarama
```

`backend/src/schemas/entities.ts` → `SliderSummarySchema`, `SliderSchema`, `SlideSchema`,
`PublicSliderSchema`, `SliderUsageSchema` (yanıt DTO'ları).
`backend/src/mappers.ts` → `toSliderDto`, `toSliderSummaryDto`, `toSlideDto`,
`toPublicSliderDto`.

`backend/src/app.ts` kaydı (portfolio kayıtlarından sonra):

```ts
api.register(publicSlidersRoutes, { prefix: "/sliders" });
api.register(adminSlidersRoutes, { prefix: "/admin/sliders" });
```

### 3.2.1 ÖN KOŞUL: `SafeHrefSchema` ortaklaştırılır (bağlayıcı)

`isSafeHref` + `SafeHrefSchema` bugün `backend/src/modules/pages/pages.schemas.ts`
(satır ~382-386) içinde **yereldir ve dışa aktarılmaz**. Slider katmanlarının `href`,
`linkHref` ve `bgVideoUrl` alanları AYNI protokol beyaz listesine tabidir.

**Kopyalamak YASAK** — iki ayrı beyaz liste zamanla ayrışır ve biri güncellenirken
diğeri unutulur (güvenlik açığı sınıfı). backend-agent önce `isSafeHref` +
`SafeHrefSchema`'yı `backend/src/schemas/common.ts`'e **taşır** ve `pages.schemas.ts`'i
oradan import edecek şekilde günceller (davranış değişikliği YOK, saf refactor —
ayrı bir `refactor(security):` commit'i olarak gönderilir). Sliders modülü aynı
sembolü tüketir.

### 3.2 Zod iskeleti — `lib/layers.ts`

```ts
import { z } from "zod";
import { SafeHrefSchema } from "../../../schemas/common"; // §3.2.1 — ORTAKLAŞTIRILACAK

const HEX6 = /^#[0-9a-fA-F]{6}$/;

const LayerOriginSchema = z.enum([
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

const LayerPositionSchema = z.object({
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
  origin: LayerOriginSchema,
  offsetX: z.number().int().min(-400).max(400).default(0),
  offsetY: z.number().int().min(-400).max(400).default(0),
  widthPercent: z.number().min(1).max(100).optional(),
  zIndex: z.number().int().min(0).max(99).optional(),
});

// HAM CSS KABUL EDİLMEZ — her alan kapalı bir küme veya sınırlı sayısal aralıktır.
const LayerStyleSchema = z.object({
  color: z.string().regex(HEX6).optional(),
  backgroundColor: z.string().regex(HEX6).optional(),
  backgroundOpacity: z.number().int().min(0).max(100).optional(),
  fontFamily: z.enum(["inherit", "heading", "body"]).optional(),
  fontSize: z.number().int().min(8).max(200).optional(),
  fontWeight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600),
                       z.literal(700), z.literal(800), z.literal(900)]).optional(),
  lineHeight: z.number().min(0.8).max(3).optional(),
  letterSpacing: z.number().min(-5).max(20).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  textTransform: z.enum(["none", "uppercase"]).optional(),
  padding: z.object({
    top: z.number().int().min(0).max(200), right: z.number().int().min(0).max(200),
    bottom: z.number().int().min(0).max(200), left: z.number().int().min(0).max(200),
  }).optional(),
  borderRadius: z.number().int().min(0).max(200).optional(),
  opacity: z.number().int().min(0).max(100).optional(),
  shadow: z.enum(["none", "sm", "md", "lg"]).optional(),
  maxWidthPx: z.number().int().min(40).max(1600).optional(),
});

const LayerAnimationSchema = z.object({
  inEffect: z.enum(["none", "fade", "fade-up", "fade-down",
                    "slide-in-left", "slide-in-right", "zoom-in", "flip-up"]),
  delayMs: z.number().int().min(0).max(10_000).multipleOf(50),
  durationMs: z.number().int().min(100).max(3000).multipleOf(50),
  easing: z.enum(["linear", "ease-out", "ease-in-out", "spring"]).optional(),
});

// content override BİLİNÇLİ olarak YOK (§2.4).
const LayerOverrideSchema = z.object({
  hidden: z.boolean().optional(),
  position: LayerPositionSchema.partial().optional(),
  style: LayerStyleSchema.optional(),
  animation: LayerAnimationSchema.partial().optional(),
});

const LayerBase = {
  id: z.string().min(1).max(64),
  position: LayerPositionSchema,
  style: LayerStyleSchema.default({}),
  animation: LayerAnimationSchema,
  responsive: z.object({
    tablet: LayerOverrideSchema.optional(),
    mobile: LayerOverrideSchema.optional(),
  }).optional(),
};

export const SliderLayerSchema = z.discriminatedUnion("type", [
  z.object({ ...LayerBase, type: z.literal("heading"),
    content: z.object({ text: z.string().min(1).max(200),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }) }),
  z.object({ ...LayerBase, type: z.literal("text"),
    // Düz metin — HTML DEĞİL (AccordionQAItem.answer ile AYNI gerekçe: yeni bir
    // sanitizasyon yolu açılmaz). Satır sonları render'da <p>'ye çevrilir.
    content: z.object({ text: z.string().min(1).max(600) }) }),
  z.object({ ...LayerBase, type: z.literal("button"),
    content: z.object({ label: z.string().min(1).max(60), href: SafeHrefSchema,
      variant: z.enum(["solid", "outline", "ghost"]).default("solid"),
      size: z.enum(["sm", "md", "lg"]).default("md"),
      icon: z.string().min(1).max(60).optional() }) }),
  z.object({ ...LayerBase, type: z.literal("image"),
    // alt ZORUNLU — katman görselleri dekoratif değil içeriktir (a11y).
    content: z.object({ url: z.string().min(1).max(2048), alt: z.string().min(1).max(200) }) }),
  z.object({ ...LayerBase, type: z.literal("badge"),
    content: z.object({ text: z.string().min(1).max(60) }) }),
]);

/**
 * `layers` için TEK giriş noktası. Sıra BAĞLAYICI (pages.schemas.ts::PageBlockListSchema
 * ile AYNI gerekçe): önce ADET, sonra BYTE, sonra içerik doğrulaması.
 */
export const SlideLayersSchema = z
  .array(z.unknown())
  .max(MAX_SLIDE_LAYERS)
  .superRefine((arr, ctx) => {
    if (Buffer.byteLength(JSON.stringify(arr), "utf8") > MAX_SLIDE_LAYERS_BYTES) {
      ctx.addIssue({ code: "custom", message: "Katman verisi 64 KB sınırını aşıyor." });
    }
  })
  .pipe(z.array(SliderLayerSchema))
  // Katman id'leri slayt İÇİNDE benzersiz olmalıdır (React key + animasyon eşleşmesi).
  .superRefine((layers, ctx) => {
    const ids = new Set<string>();
    for (const l of layers) {
      if (ids.has(l.id)) ctx.addIssue({ code: "custom", message: `Yinelenen katman id: ${l.id}` });
      ids.add(l.id);
    }
  });
```

`layers` dizisi 64 KB'yi aşarsa uç **`413 PAYLOAD_TOO_LARGE`** döner (Zod `422` değil) —
öncesinde `lib/errors.ts`'e karşılık gelen hata sınıfı yoksa backend-agent ekler.

### 3.3 Zamanlama sözleşmesi (bağlayıcı)

- `animation.delayMs`, **slaytın aktif olduğu andan (`t=0`)** itibaren ölçülür; önceki
  slaytın çıkışından değil. Admin zaman çizelgesindeki çubuk konumu = ön yüzdeki gerçek
  gecikme.
- **Çıkış animasyonu veri değildir:** tüm katmanlar `SLIDER_LAYER_OUT_DURATION_MS`
  (300 ms) `fade` ile çıkar. 20 katmanın çıkış koreografisini ayrı ayarlamak, geçiş
  süresini aşan ve "takılıyor" hissi veren yapılandırmalar üretiyordu.
- Doğrulama uyarısı (engelleyici DEĞİL, editörde uyarı): `delayMs + durationMs` bir
  slaytın efektif süresini (`durationMs ?? intervalMs`) aşarsa katman hiç görünmeden
  slayt değişir.

### 3.4 Denetim ve webhook

- `logAudit` — `slider.create`, `slider.update`, `slider.delete`, `slider.restore`,
  `slider.permanent_delete`, `slide.create`, `slide.update`, `slide.delete`,
  `slide.reorder`. (portfolio.routes.ts deseni.)
- **`WebhookEvent` enum'ına slider olayı EKLENMEZ** — enum'a değer eklemek geri
  alınamaz; slider harici entegratörler için anlamlı bir olay değildir.

### 3.5 `pages.schemas.ts` eklemesi

```ts
/**
 * Gelişmiş Slider bloğu — İÇERİK TAŞIMAZ, yalnızca REFERANS taşır (gerekçe:
 * .claude/architect-scope-advanced-slider.md §6.1). `sliderId` OPSİYONELDİR: yeni
 * eklenen blok henüz seçim yapılmamış haldedir (`CtaBlock.secondaryButtonHref` ile
 * AYNI "boş string yerine alanı omit et" deseni). Var olmayan/silinmiş bir id
 * doğrulanmaz (`featured-products.categoryId` ile AYNI gerekçe) — public tarafta
 * sessizce boş render edilir, 422 ÜRETMEZ.
 */
const AdvancedSliderBlockDataSchema = z.object({
  sliderId: z.string().uuid().optional(),
});
const AdvancedSliderBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("advanced-slider"),
  data: AdvancedSliderBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});
```

`PageNodeSchema` sevk zincirine ekle:
```ts
if (type === "advanced-slider") return applySubSchema(AdvancedSliderBlockSchema, node, ctx);
```

`backend/src/lib/page-template-fields.ts::TEMPLATE_EDITABLE_FIELDS`:
```ts
// Standart kullanıcı hangi slider'ın gösterileceğini DEĞİŞTİREBİLİR (içerik seçimi),
// ama slider'ın kendisini düzenleyemez (o /admin/sliders yetkisidir).
"advanced-slider": ["data.sliderId"],
```

---

## 4. Uç nokta özeti (tam liste openapi.yaml'da)

| Metot | Yol | Rol |
|---|---|---|
| GET | `/admin/sliders` | ADMIN, MANAGER, EDITOR |
| POST | `/admin/sliders` | ADMIN, MANAGER |
| GET | `/admin/sliders/{sliderId}` | ADMIN, MANAGER, EDITOR |
| PATCH | `/admin/sliders/{sliderId}` | ADMIN, MANAGER |
| DELETE | `/admin/sliders/{sliderId}` | ADMIN, MANAGER |
| POST | `/admin/sliders/{sliderId}/restore` | ADMIN, MANAGER |
| DELETE | `/admin/sliders/{sliderId}/permanent` | ADMIN, MANAGER |
| POST | `/admin/sliders/{sliderId}/duplicate` | ADMIN, MANAGER |
| GET | `/admin/sliders/{sliderId}/usage` | ADMIN, MANAGER, EDITOR |
| POST | `/admin/sliders/{sliderId}/slides` | ADMIN, MANAGER |
| PUT | `/admin/sliders/{sliderId}/slides/order` | ADMIN, MANAGER |
| PATCH | `/admin/sliders/{sliderId}/slides/{slideId}` | ADMIN, MANAGER |
| DELETE | `/admin/sliders/{sliderId}/slides/{slideId}` | ADMIN, MANAGER |
| POST | `/admin/sliders/{sliderId}/slides/{slideId}/duplicate` | ADMIN, MANAGER |
| GET | `/sliders/{sliderId}` | public |

### 4.1 `PUT .../slides/order` neden tam liste

`Navigation` PUT'uyla aynı "tam durum gönder" deseni. Kısmi `PATCH slide.order`
sürükle-bırakta yarış koşulu ve çift `order` üretirdi; ayrıca
`@@unique([sliderId, order])` ile uyumsuzdur.

### 4.2 `layers` kısmi yamalanmaz

`PATCH .../slides/{slideId}` içinde `layers` verilirse dizi **tamamen değiştirilir**.
Editör zaten tuvalin tam durumunu tutar (`Page.blocks` ile aynı model).

### 4.3 Silme öncesi referans koruması

`DELETE /admin/sliders/{sliderId}` → slider bir sayfada kullanılıyorsa `409 CONFLICT`,
`error.details.usedBy: SliderUsage[]`. `?force=true` ile geçilir.

Uygulama (`lib/slider-usage.ts`): Postgres tarafında `blocks::text ILIKE '%<uuid>%'`
**yalnızca aday daraltma** amaçlıdır; kesin karar uygulama içinde `blocks` ağacının
iteratif taranmasıyla verilir (`lib/page-blocks.ts::scanPageNodeStructure` ile aynı
yaklaşım, özyineleme YOK). `SiteSettings.homePageId` ile eşleşen sayfa `isHomePage: true`
işaretlenir — uyarı metni sertleşir.

---

## 5. Ön yüz render motoru (frontend-agent)

### 5.1 KARAR: framer-motion + kendi pointer-swipe hook'umuz. Swiper.js EKLENMEZ.

| Kriter | Swiper.js | framer-motion (mevcut) |
|---|---|---|
| Bağımlılık | **YENİ** (~40 kB gz core+modüller), her public sayfaya iner | Zaten `^12.43.0`, kurulu |
| Katman koreografisi | **Çözmez** — yalnızca track geçişini çözer; katman zaman çizelgesi için yine ikinci bir motor gerekir | Tek motor, tek zaman kaynağı |
| İki motorun riski | Track ve katman zamanlayıcıları ayrı → **drift**; `delayMs` sözleşmesi (§3.3) garanti edilemez | Yok |
| RSC/SSR | `swiper/react` istemci-only ESM + yan etkili CSS import'ları; sıfır-CLS sunucu HTML'i üretmek zor | Sunucu HTML'ini biz yazarız, `motion.*` yalnızca hidrasyondan sonra devreye girer |
| `cube` efekti | `EffectCube` hazır | CSS 3B (`perspective` + `rotateY`) ile ~40 satır |
| `prefers-reduced-motion` | Ayrı ele alınmalı | `useReducedMotion()` hazır, `ScrollReveal` ile aynı davranış |
| code-quality-agent | Yeni bağımlılık gerekçe + lisans denetimi ister | Ek denetim yok |

**Kazandığı tek şey (hazır swipe/`EffectCube`) yaklaşık 110 satır kodla karşılanır;
kaybettirdiği şey (ikinci animasyon motoru + bundle) kalıcıdır.** Karar: framer-motion.

Dokunma/kaydırma: `transitionEffect: "slide"` iken track üzerinde framer-motion
`drag="x"` + `dragElastic={0.15}` + `dragConstraints`; `fade`/`cube`/`zoom` iken track
sürüklenmez, `use-pointer-swipe.ts` (Pointer Events, eşik: 50 px **veya** hız
> 0.4 px/ms) yalnızca `next()`/`prev()` tetikler. Dikey kaydırma engellenmez
(`touch-action: pan-y`).

### 5.2 Sıfır CLS — bağlayıcı kurallar

1. **Dış kutunun yüksekliği sunucu HTML'inde belirlidir.** `heightMode` → satır içi stil:
   `full-screen` → `height: 100svh`; `custom-px` → `height: {heightPx}px`;
   `aspect-ratio` → `aspect-ratio: {w} / {h}`. Mobil override **JS ile değil**, bir CSS
   değişkeni + `@media` kuralıyla uygulanır (hidrasyon öncesi doğru yükseklik).
2. **`100vh` KULLANILMAZ** — `100svh`. (Mobil tarayıcı çubuğu daralınca `100vh`
   sayfa yüksekliğini değiştirir.)
3. **Katmanlar `position: absolute`** — layout'a katkı vermezler, dolayısıyla animasyon
   durumları (opacity/transform) **CLS üretemez**. Katmanların `opacity: 0`'dan
   başlaması bu yüzden güvenlidir.
4. **İlk aktif slaytın arka planı `next/image` + `priority` + `fill` +
   `sizes="100vw"`**; diğer slaytlar `loading="lazy"`. LCP elemanı arka plandır.
5. `bgType: video` → `<video muted playsInline preload="metadata">` + `poster`
   (bkz. `bgVideoPosterMedia`); **otomatik oynatma `prefers-reduced-motion` altında
   kapalı**.

### 5.3 Performans

- **Yalnızca aktif slaytın katmanları DOM'a mount edilir** (`AnimatePresence`; çıkan
  slaytın katmanları 300 ms sonra unmount). Arka planlar mount kalır (görsel yeniden
  indirilmesin).
- Otomatik oynatma `document.hidden` iken ve slider viewport dışındayken
  (`IntersectionObserver`) **durur**.
- `will-change: transform, opacity` yalnızca geçiş süresince eklenir.
- `responsive` birleştirmesi (§2.4) **render sırasında bir kez** `useMemo` ile hesaplanır;
  cihaz kırılımı `matchMedia` ile dinlenir (yeniden ölçüm yok).

### 5.4 Erişilebilirlik (bağlayıcı — security/qa denetler)

- Kök: `role="region"` + `aria-roledescription="carousel"` + `aria-label={slider.name}`.
- Slayt: `role="group"` + `aria-roledescription="slide"` + `aria-label="{i} / {n}"`;
  pasif slaytlar `aria-hidden="true"` ve `inert`.
- Oklar/bulletlar gerçek `<button>`; bullet `aria-label="{i}. slayta git"` +
  `aria-current`.
- Klavye: odak slider içindeyken `ArrowLeft`/`ArrowRight`.
- **`autoplay: true` iken duraklat/oynat düğmesi HER ZAMAN render edilir** (WCAG 2.2.2).
  Bu bir ayar değildir, kapatılamaz.
- `pauseOnHover` klavye odağında da geçerlidir (`focus-within`).

### 5.5 `prefers-reduced-motion: reduce`

Veri ne derse desin: otomatik oynatma **kapalı**, Ken Burns **kapalı**, geçiş
`transform` yerine anlık, katman giriş efektleri `opacity: 1`'e anında. `ScrollReveal`
ile aynı davranış çizgisi.

### 5.6 SEO (seo-agent sahipliğinde)

- `heading` katmanı gerçek `<h1>`/`<h2>`/`<h3>` olarak, **gerçek metinle sunucu
  HTML'inde** render edilir → indekslenebilir.
- Varsayılan `level: 2`. **Sayfada tek `h1` kuralı**: admin editörü, aynı slider içinde
  birden fazla `level: 1` başlık katmanı varsa uyarı gösterir (engelleyici değil).
- `image` katmanında `alt` **zorunludur** (Zod `.min(1)`).
- Slider için ayrı structured data (`JSON-LD`) **üretilmez** — seo-agent aksini
  değerlendirirse kontrat güncellenir.

---

## 6. Page-builder entegrasyonu

### 6.1 Blok yalnızca REFERANS taşır

`advanced-slider` bloğunun `data`'sı tek bir opsiyonel `sliderId`'dir. Gerekçe:
(a) aynı slider birden fazla sayfada yeniden kullanılır, (b) `Page.blocks`'un 256 KB
tavanı çok katmanlı slayt JSON'unu kaldıramaz, (c) slider'ı güncellemek sayfa
revizyonu üretmemelidir, (d) `featured-products`/`featured-portfolio` bloklarıyla
**aynı** "referans + sunucu tarafı fetch" deseni.

### 6.2 `frontend/src/lib/page-builder/types.ts`

```ts
// 1) ContentBlockType birliğine ekle (dizinin SONUNA):
  | "advanced-slider";

// 2) Arayüz (LogoMarqueeBlock/TeamBlock bloklarının yanına):
/**
 * Gelişmiş Slider / Hero Studio — blok İÇERİK TAŞIMAZ, yalnızca var olan bir
 * `Slider` kaydına REFERANS tutar (bkz. .claude/architect-scope-advanced-slider.md
 * §6.1). Slayt/katman verisi `/admin/sliders` ile yönetilir, `Page.blocks` içinde
 * ÇOĞALTILMAZ.
 *
 * `sliderId` OPSİYONEL — yeni eklenen blok henüz seçim yapılmamış haldedir
 * (`createBlock` bu alanı hiç EKLEMEZ; boş string backend'de `.uuid()`e takılırdı,
 * `CtaBlock.secondaryButton*` ile AYNI "omit et" deseni). Seçim yapılmamış VEYA
 * silinmiş bir slider → public tarafta SESSİZCE hiçbir şey render edilmez.
 */
export interface AdvancedSliderBlock extends BaseNode {
  type: "advanced-slider";
  data: { sliderId?: string };
}

// 3) ContentBlock birliğine ekle:
  | AdvancedSliderBlock;
```

### 6.3 `frontend/src/lib/page-builder/registry.ts`

```ts
// import: lucide-react'ten `GalleryHorizontal` (v1.28'de MEVCUT — doğrulandı).

// blockRegistry — `hero`'nun HEMEN ARDINA (keşfedilebilirlik: ikisi de hero alanı çözer):
  "advanced-slider": { label: "Gelişmiş Slider", category: "marketing", icon: GalleryHorizontal },

// createBlock switch'ine:
    case "advanced-slider":
      // `sliderId` KASITLI OLARAK eklenmez (undefined) — bkz. types.ts yorumu ve
      // `cta` case'indeki AYNI gerekçe (boş string backend doğrulamasına takılır).
      return { id, type, data: {} };
```

### 6.4 Diğer dokunulacak dosyalar (frontend-agent)

| Dosya | Değişiklik |
|---|---|
| `src/lib/page-builder/template-fields.ts` | `"advanced-slider": ["data.sliderId"]` (backend `page-template-fields.ts` ile BİREBİR) |
| `src/components/admin/page-builder/builder-canvas.tsx` | `ContentBlockBody` switch'ine `case "advanced-slider"` |
| `src/components/admin/page-builder/blocks/advanced-slider-block.tsx` | **YENİ** — slider seçici (`GET /admin/sliders`), "Slider'ı düzenle" bağlantısı (`/admin/sliders/{id}`), hiç slider yoksa "İlk slider'ı oluştur" boş durumu |
| `src/components/site/blocks/index.tsx` | `renderNodeBody` switch'ine `case "advanced-slider"` |
| `src/components/site/blocks/advanced-slider-block.tsx` | **YENİ** — async sunucu bileşeni; `data.sliderId` yoksa `null`; `fetchSliderServer` → yoksa/boşsa `null` |
| `src/components/site/advanced-slider/*` | **YENİ** — `advanced-slider.tsx` (`"use client"`), `slide-layer.tsx`, `use-pointer-swipe.ts`, `resolve-responsive.ts` |
| `src/lib/api/server-sliders.ts` | **YENİ** — `fetchSliderServer(sliderId)`, `next: { revalidate: 60 }`, hata → `null` (`server-portfolio.ts` deseni) |
| `src/lib/api/sliders.ts` | **YENİ** — admin istemci fonksiyonları (`portfolio.ts` deseni) |
| `src/lib/sliders/types.ts` | **YENİ** — `Slider`/`Slide`/`SliderLayer` TS tipleri + §2.6 sabitleri |
| `src/components/admin/sidebar.tsx` | `{ href: "/admin/sliders", labelKey: "nav.sliders", icon: GalleryHorizontal, roles: ["ADMIN","MANAGER"] }` — `/admin/navigation` satırının yanına |
| `src/lib/i18n/dictionaries/nav.ts` | `"nav.sliders"`: `"Slider'lar"` / `"Sliders"` |

**`normalize.ts` DEĞİŞMEZ** — bilinmeyen/yeni yaprak blok tipleri olduğu gibi geçirilir.

### 6.5 Admin ekranları (frontend-agent + ui-designer)

- `/admin/sliders` — liste (ad, slayt sayısı, önizleme, çöp sekmesi, arama, kopyala,
  sil). `page.tsx` + istemci bileşeni; mevcut `admin/portfolio` liste deseni.
- `/admin/sliders/[id]` — **Hero Studio**:
  1. Üst çubuk: cihaz görünümü seçici (masaüstü/tablet/mobil — `DeviceMode` tipi
     `page-builder/types.ts`'ten **yeniden kullanılır**, yeni tip icat edilmez),
     kaydet, önizle/oynat.
  2. Sol/alt: slayt şeridi (sürükle-bırak sıralama → `PUT .../slides/order`,
     `@dnd-kit` zaten kurulu), slayt ekle/kopyala/sil, `isActive` anahtarı.
  3. Orta: canlı tuval — `Slider.heightMode`'a göre boyutlanmış, katmanlar
     sürüklenebilir (sürükleme `xPercent`/`yPercent` yazar), seçili katman tutamaçlı.
  4. Sağ: sekmeli müfettiş — **Slayt** (arka plan/overlay/Ken Burns/süre/link),
     **Katman** (içerik + stil), **Animasyon** (`inEffect`/`delayMs`/`durationMs`/
     `easing`), **Slider** (otomatik oynatma/geçiş/yükseklik/navigasyon).
  5. Alt: zaman çizelgesi — her katman bir çubuk (`delayMs` başlangıç, `durationMs`
     uzunluk), sürüklenebilir; "Oynat" tuvalde koreografiyi baştan çalıştırır.

**Cihaz görünümü + override yazma kuralı (bağlayıcı UX):** masaüstü görünümündeyken
yapılan düzenleme **kök alanları** yazar; tablet/mobil görünümündeyken yapılan düzenleme
`responsive.<device>` altına **yalnızca değişen grubu** yazar. Müfettişte her alanın
yanında "bu cihazda geçersiz kılındı" göstergesi + "override'ı kaldır" düğmesi bulunur.

### 6.6 ui-designer'a devredilenler

Slider navigasyon kromu (ok/bullet/ilerleme çubuğu boyut-kenarlık-gölge-hover, `light`/
`dark` tema karşılıkları), `SliderLayerStyle.shadow` token tablosu (`sm`/`md`/`lg` →
gerçek `box-shadow` değerleri), buton katmanı varyantlarının site temasıyla (`--site-*`
değişkenleri) ilişkisi, ve Hero Studio tuval/müfettiş/zaman çizelgesi düzeni.
**Renk/gölge/boşluk ham değerlerini frontend-agent kendi kararıyla yazmaz.**

---

## 7. QA kapsamı (qa-agent — Playwright)

Dosya: `frontend/tests/e2e/admin-slider-studio.spec.ts` (+ public taraf için
`advanced-slider-public.spec.ts`).

**Admin:**
1. Slider oluştur → slayt ekle → katman ekle (`heading`) → kaydet → sayfa yenile →
   katman metni/konumu korunuyor.
2. Katmanı tuvalde sürükle → `xPercent`/`yPercent` değişiyor → kaydet → kalıcı.
3. Cihaz görünümünü **mobil**e al → yalnızca `fontSize`'ı değiştir → masaüstüne dön →
   masaüstü `fontSize` **DEĞİŞMEMİŞ** (override izolasyonu — §2.4'ün kritik testi).
4. Mobil override'ı kaldır → mobil değer masaüstünden miras alınıyor.
5. Slaytları sürükle-bırakla yeniden sırala → yenile → sıra korunuyor.
6. Zaman çizelgesinde "Oynat" → katmanlar `delayMs` sırasına göre görünür oluyor.
7. Slider'ı kopyala → slayt ve katman sayıları eşit, katman id'leri **FARKLI**.
8. Kullanılan bir slider'ı sil → `409` + kullanan sayfa listesi görünüyor; `force` ile
   silinebiliyor.
9. **RBAC:** EDITOR `/admin/sliders`'ı görebiliyor (okuma) ama "Yeni slider" /
   "Kaydet" 403 alıyor; USER/CUSTOMER `/admin/sliders`'ta 403.

**Page-builder + public:**
10. Sayfa düzenleyicide "Gelişmiş Slider" bloğu ekle → slider seç → yayınla →
    public sayfada slaytlar görünüyor.
11. `sliderId` seçilmemiş blok → public sayfada **hiçbir şey render edilmiyor**, hata yok.
12. Slider'ı sil (`force`) → public sayfa **hâlâ 200 dönüyor**, blok sessizce boş.
13. **Sıfır CLS:** public sayfada slider'ın dış kutusunun yüksekliği hidrasyon ÖNCESİ ve
    SONRASI aynı (`boundingBox` karşılaştırması); `aspect-ratio` modunda CLS = 0.
14. Dokunma/kaydırma: sağa/sola swipe slaytı değiştiriyor; dikey scroll engellenmiyor.
15. **A11y:** `autoplay` açıkken duraklat düğmesi DOM'da; `ArrowRight` slaytı ilerletiyor;
    pasif slaytlar `aria-hidden`; `jest-axe`/`axe` ihlali yok.
16. `prefers-reduced-motion: reduce` emülasyonuyla: otomatik oynatma çalışmıyor,
    Ken Burns yok.

**Backend birim testleri (backend-agent):** `SlideLayersSchema` — 21 katman → hata;
64 KB üstü → `413`; yinelenen katman id → hata; `javascript:` href → hata;
`content` override'ı gönderme girişimi → strict şema reddi.

---

## 8. Definition of Done

- [ ] Prisma modelleri + migration uygulandı (db-agent)
- [ ] `/admin/sliders*` + `/sliders/{id}` openapi.yaml ile BİREBİR (backend-agent)
- [ ] `advanced-slider` bloğu 4 dosyada kayıtlı: `types.ts`, `registry.ts`,
      `builder-canvas.tsx`, `site/blocks/index.tsx` + iki `template-fields` dosyası
      senkron (frontend-agent)
- [ ] Tasarım tokenleri tanımlı (ui-designer)
- [ ] `SafeHrefSchema` katman `href`/`linkHref`/`bgVideoUrl` üzerinde; XSS/`javascript:`
      denetimi geçti (security-agent)
- [ ] Sıfır CLS ve a11y testleri yeşil (qa-agent)
- [ ] `CHANGELOG.md` (repo kökü) + README güncel (documentation-agent)
- [ ] Lint/format/bağımlılık politikası (Swiper eklenmedi) doğrulandı (code-quality-agent)
