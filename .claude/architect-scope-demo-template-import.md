# architect-scope: 1 Tıkla Hazır Demo / Şablon İçe Aktarıcı (`demo-templates` modülü)

**Durum:** BAĞLAYICI karar dokümanı. Bu dosya ile `docs/architecture/openapi.yaml`
(`DemoTemplates` tag'i + `/admin/demo-templates*` yolları + `DemoTemplateSummary` /
`ImportDemoTemplateRequest` / `DemoTemplateImportResult` şemaları) TEK doğruluk
kaynağıdır. Çelişki olursa **openapi.yaml kazanır** (bkz. `.claude/CLAUDE.md`
"Çakışma Çözümü").

**Uygulayacak ajanlar:** db-agent → ui-designer ∥ backend-agent → frontend-agent →
security-agent ∥ compliance-agent → qa-agent → documentation-agent. Sıralamayı
release-coordinator planlar.

**Branş:** `feature/demo-template-import`. Commit'ler Conventional Commits
(`feat(demo-templates): ...`, `feat(db): ...`, `docs(openapi): ...`).

**İlk şablon:** `modern-architecture` — "Modern Mimarlık & İnşaat".

---

## 0. Bir cümlede karar

Sunucu tarafında yaşayan, **kod içi statik bir şablon registry'si**
(`MODULE_REGISTRY`/`APPEARANCE_PRESETS` paterni) + **tek bir POST ucunda, iki fazlı
(önce dosya, sonra tek transaction) çalışan bir "uygula" işlemi** + idempotency'yi
taşıyan **tek küçük bir işaret tablosu** (`DemoTemplateImport`). Yeni blok tipi YOK,
yeni sayfa-builder yeteneği YOK, `appearance-presets.ts`'e dokunma YOK.

---

## 1. İsimlendirme ve modül konumu (bağlayıcı)

### 1.1 Modül adı: `demo-templates` — "templates" DEĞİL

Kullanıcının önerdiği `/api/admin/templates/import` yolu **reddedildi.** Bu kod
tabanında "template" kelimesi ZATEN ÜÇ farklı şeyi ifade ediyor:

| Mevcut kullanım | Anlamı |
|---|---|
| `SiteTemplate` enum (`SHOWCASE`/`COMMERCE`/`PORTFOLIO`) + `SiteSettings.siteTemplate` | Modül ÖNERİSİ ipucu (hiçbir şeyi açıp kapatmaz) |
| `lib/page-template-fields.ts`, `lib/page-template-guard.ts`, `template-editor-view.tsx`, `PageEditMode.TEMPLATE` | Sayfa düzenleyicinin "standart mod" kısıtı |
| `EmailTemplate` modeli + `/admin/email-templates` | E-posta şablonları |

Dördüncü bir "template" anlamı eklemek, `.claude/CLAUDE.md`'nin **"ortak terminoloji —
her ajan kendi kısaltmasını uydurmaz"** kuralının doğrudan ihlalidir ve altı ay sonra
"hangi template?" sorusunu her PR'da doğurur.

**Bağlayıcı isimlendirme:**

| Katman | Ad |
|---|---|
| Backend modül dizini | `backend/src/modules/demo-templates/` |
| Route prefix | `/admin/demo-templates` |
| OpenAPI tag | `DemoTemplates` |
| Prisma modeli | `DemoTemplateImport` → `@@map("demo_template_imports")` |
| Admin sayfası | `frontend/src/app/admin/demo-templates/page.tsx` |
| Türkçe terim (UI + doküman) | **"demo şablonu"** |
| Audit action | `demo_template.import` |

### 1.2 `backend/src/modules/import/` ile KARIŞTIRILMAZ

Mevcut `import` modülü **kullanıcı verisi** içe aktarır (WXR/CSV/ZIP, `ImportJob`
kuyruğu, `ImportJobError`, retention politikası, dosya yükleme). Bizim işimiz
**kod içi sabit bir tanımı DB'ye uygulamaktır** — yükleme yok, kuyruk yok, kullanıcı
dosyası yok, retention yok. `ImportJobType` enum'ına değer **EKLENMEZ**
(`ALTER TYPE ... ADD VALUE` geri alınamaz ve bu iş bir "job" değildir; bkz. §5.3).

### 1.3 `backend/src/lib/appearance-presets.ts` ile KARIŞTIRILMAZ

`APPEARANCE_PRESETS` yalnızca **istemciye değer döner**; DB'ye kullanıcı `PATCH`
atarak yazar. Demo şablonu ise **sunucu tarafında, çok tabloya, tek transaction'da
YAZAN** bir işlemdir. İkisini aynı dosyaya koymak, "bu registry yazar mı yazmaz mı?"
belirsizliğini üretirdi. **backend-agent `appearance-presets.ts`'e bu turda
DOKUNMAZ.**

### 1.4 Dosya yerleşimi

```
backend/src/modules/demo-templates/
  demo-templates.routes.ts          # adminDemoTemplatesRoutes
  demo-templates.schemas.ts         # Zod: istek/param şemaları
  registry.ts                       # DEMO_TEMPLATE_REGISTRY (statik liste) + getDemoTemplate()
  types.ts                          # DemoTemplateDefinition & alt tipleri (§3)
  importer.ts                       # iki fazlı uygulama servisi (§5)
  lib/
    assets.ts                       # paket varlıklarını Media'ya dönüştürme (§4)
    asset-tokens.ts                 # `asset:<key>` token çözümleme + tarama (§3.4)
  templates/
    modern-architecture.ts          # ilk şablon TANIMI (veri, kod değil)
  assets/
    modern-architecture/
      *.png                         # §4 — paketlenmiş placeholder görseller
      _source/*.svg                 # §4.3 — üretim kaynağı, ÇALIŞMA ZAMANINDA OKUNMAZ
```

`backend/src/schemas/entities.ts` → `DemoTemplateSummarySchema`,
`DemoTemplateImportResultSchema` (yanıt DTO'ları).
`backend/src/app.ts` kaydı (appearance kayıtlarından sonra):

```ts
api.register(adminDemoTemplatesRoutes, { prefix: "/admin/demo-templates" });
```

---

## 2. Şablon tanımı NEREDE yaşar — `.ts`, çalışma zamanında okunan `.json` DEĞİL

Kullanıcı "template JSON dosya şeması" istedi. **Şema (şekil) aynen tanımlanıyor
(§3), ama TAŞIYICI bir `.json` dosyası DEĞİL, bir TypeScript modülüdür.** Gerekçeler:

1. **Proje emsali:** bu kod tabanındaki TÜM statik registry'ler TS modülüdür —
   `lib/module-registry.ts::MODULE_REGISTRY`, `lib/appearance-presets.ts::APPEARANCE_PRESETS`,
   `lib/permissions-matrix.ts::PERMISSIONS_MATRIX`. Yeni bir taşıyıcı biçim icat etmek
   emsalden sapmadır.
2. **Hata anı:** şablonun `page.blocks` içeriği `PageNode[]` sözleşmesine uymak
   ZORUNDA. `.ts` olduğunda uyumsuzluk **derleme zamanında** (`npm run typecheck`,
   CI) patlar. `.json` olduğunda **çalışma zamanında, kullanıcının "Uygula"
   düğmesine bastığı anda, üretimde** patlar. Bu tek başına belirleyicidir.
3. **Dağıtım tuzağı:** `tsc` `.json` dosyalarını `dist/`e KOPYALAMAZ.
   `resolveJsonModule` + build'e bir kopyalama adımı + `__dirname` çözümlemesinin
   `tsx watch` (dev) ile `node dist/server.js` (prod) arasında farklı davranması —
   hepsi devops-agent'a yüklenen gereksiz bir yük olurdu. (Bu tuzak `assets/*.png`
   için ZATEN VAR ve orada kaçınılmazdır — bkz. §4.4; ikinci kez yaşamaya gerek yok.)

**Ama tip güvenliği TEK BAŞINA YETMEZ (bağlayıcı):** bir `as any` tip hatasını
susturabilir. Şablonun `page.blocks` ve `slider.slides[].layers` içerikleri, DB'ye
yazılmadan ÖNCE **API'nin kullandığı AYNI Zod şemalarından** geçirilir
(`pages.schemas.ts::PageBlockListSchema`, `sliders/lib/layers.ts::SlideLayersSchema`).
İki katman bağımsızdır ve ikisi de zorunludur. Ayrıca qa-agent bunu bir birim testi
olarak sabitler (§10).

---

## 3. `DemoTemplateDefinition` — şablon şeması (bağlayıcı)

`backend/src/modules/demo-templates/types.ts`. Aşağıdaki şekil BAĞLAYICIDIR; alan
eklemek/çıkarmak bu dokümanın güncellenmesini gerektirir.

```ts
export interface DemoTemplateDefinition {
  /** Registry anahtarı, kebab-case, DB'de `DemoTemplateImport.templateKey`. */
  key: string;                    // "modern-architecture"
  /** Semver. Şablon içeriği değişince ARTIRILIR (§6.4 yeniden uygulama raporu için). */
  version: string;                // "1.0.0"
  name: string;                   // "Modern Mimarlık & İnşaat"
  description: string;            // 1-2 cümle Türkçe
  /** Admin panelinde gösterilen önizleme — Media DEĞİL, frontend statiği (§4.5). */
  previewImageUrl: string;        // "/demo-templates/modern-architecture/preview.webp"
  /** Filtreleme/rozet amaçlı serbest etiketler. */
  tags: string[];                 // ["mimarlık", "inşaat", "kurumsal"]

  /** §4 — TÜM görseller burada, TEK yerde tanımlanır. */
  assets: DemoTemplateAsset[];

  /** §7 — `UpdateSiteAppearanceRequest` gövdesiyle BİREBİR aynı şekil. */
  appearance: DemoTemplateAppearance;

  /** Singleton site ayarları — yalnızca aşağıdaki 5 alan yazılır, başkası DEĞİL (§6.2). */
  settings: {
    siteName: string;
    tagline: string | null;
    headerCtaLabel: string | null;
    headerCtaHref: string | null;
    footerCopyrightText: string | null;
  };

  /** Maks. 2 seviye — `NavigationItem.parentId` kuralı (§6.2). */
  navigation: DemoTemplateNavItem[];        // { label, href, children?: {label,href}[] }
  footer: { columns: { title: string; links: { label: string; href: string }[] }[] };
  socialLinks: { platform: SocialPlatform; url: string }[];

  portfolio: {
    categories: { name: string; slug: string }[];
    items: {
      title: string; slug: string; summary: string | null; contentHtml: string;
      clientName: string | null; categorySlug: string | null;
      /** `assets[].key` referansı → `PortfolioItem.coverMediaId` (GERÇEK Media FK). */
      coverAssetKey: string | null;
      /** `assets[].key` referansları → `PortfolioImage.mediaId` (GERÇEK Media FK). */
      galleryAssetKeys: string[];
      order: number;
      status: "PUBLISHED";        // §6.5 — şablon YALNIZCA PUBLISHED üretir
    }[];
  };

  /** Hero Studio slider'ı. `null` = bu şablon slider getirmiyor. */
  slider: {
    name: string; slug: string;
    autoplay: boolean; intervalMs: number; loop: boolean; pauseOnHover: boolean;
    transitionEffect: SliderTransitionEffect; transitionDurationMs: number;
    heightMode: SliderHeightMode; heightPx: number | null;
    aspectRatioWidth: number; aspectRatioHeight: number;
    widthMode: SliderWidthMode;
    showArrows: boolean; showBullets: boolean; showProgressBar: boolean;
    navigationTheme: SliderNavigationTheme;
    slides: {
      label: string | null; isActive: boolean;
      bgType: SlideBackgroundType;
      /** `assets[].key` → `Slide.bgMediaId` (GERÇEK Media FK). */
      bgAssetKey: string | null;
      bgPositionX: number; bgPositionY: number;
      bgOverlayColor: string | null; bgOverlayOpacity: number;
      bgGradientFrom: string | null; bgGradientTo: string | null; bgGradientAngle: number;
      bgKenBurns: boolean; durationMs: number | null;
      linkHref: string | null; linkNewTab: boolean;
      /** `frontend/src/lib/sliders/types.ts::SliderLayer[]` ile BİREBİR. */
      layers: SliderLayer[];
    }[];
  } | null;

  page: {
    title: string; slug: string;
    seoTitle: string | null; seoDescription: string | null;
    /** `frontend/src/lib/page-builder/types.ts::PageNode[]` ile BİREBİR. */
    blocks: PageNode[];
    /** true → `SiteSettings.homePageId` bu sayfaya YAZILIR (§6.3). */
    setAsHomePage: boolean;
  };
}

export interface DemoTemplateAsset {
  /** Şablon içinde benzersiz, kebab-case. `asset:<key>` token'ının gövdesi. */
  key: string;                    // "portfolio-cover-1"
  /** `assets/<templateKey>/` altındaki dosya adı. Yol ayracı İÇEREMEZ (§4.4 güvenlik). */
  file: string;                   // "portfolio-cover-1.png"
  /** `Media.altText` — a11y için ZORUNLU, boş olamaz. */
  altText: string;
}
```

### 3.1 `slider.slides[].layers` neden `SliderLayer[]`, `Slide` neden ayrı bölüm

`.claude/architect-scope-advanced-slider.md` §6.1 kararı: `advanced-slider` bloğu
İÇERİK TAŞIMAZ, yalnızca `sliderId` referansı taşır. Dolayısıyla şablon, slider'ı
`page.blocks`'un İÇİNE gömemez — **önce slider yaratılır, dönen `id` blok ağacındaki
`advanced-slider` düğümüne enjekte edilir.** Bu enjeksiyon `asset:` token'larıyla
AYNI mekanizmayla yapılır (§3.4): şablon ağacında `{ type: "advanced-slider",
data: { sliderId: "ref:slider" } }` yazar, importer bunu gerçek uuid ile değiştirir.

### 3.2 Şablon HANGİ tabloları YAZMAZ (bilinçli sınırlar — backend-agent genişletmez)

| Tablo | Neden yazılmaz |
|---|---|
| `ContactForm` / `ContactFormField` | Alan tanımları + KVKK onay metni + `consentLegalPageId` **compliance-agent'ın alanıdır** (`/admin/contact`). Bir demo şablonunun onay metni yazması hukuki risktir. `contact-form` bloğu eklenir, mevcut singleton'ı gömer. |
| `SiteCustomCode` | Keyfi kod yürütme yüzeyi, ADMIN-only PUT'lara ait. Bir şablon ASLA CSS/JS enjekte etmez. |
| `SiteModule` | Modül aç/kapa **site-geneli kill switch**tir (`PATCH /admin/modules/{key}`, ADMIN-only). Şablon bunu değiştirmez; `portfolio` kapalıysa yanıtta `warnings[]` ile bildirir (§6.6). |
| `Locale` / `ContentSlug` / `translations` | v1'de şablon TEK DİLLİDİR (varsayılan locale). Backlog: `feature/demo-template-i18n`. |
| `BlogPost` / `Product` / `User` | Kapsam dışı. Şablon hesap açmaz, ürün/blog üretmez. |
| `ContentRevision` | Şablonun oluşturduğu sayfa için revizyon üretilmez (ilk hâli zaten sıfır noktasıdır). |

### 3.3 Şablonun ÜRETTİĞİ kayıt hacmi (üst sınır, bağlayıcı)

Zod ile zorlanır; aşan bir şablon **derlenmez/testten geçmez**, çalışma zamanında
kullanıcıya sızmaz:

```ts
export const MAX_TEMPLATE_ASSETS = 24;
export const MAX_TEMPLATE_ASSET_BYTES = 512 * 1024;   // dosya BAŞINA
export const MAX_TEMPLATE_PORTFOLIO_ITEMS = 12;
export const MAX_TEMPLATE_NAV_ITEMS = 30;             // kök + alt, TOPLAM
export const MAX_TEMPLATE_FOOTER_COLUMNS = 6;
```

`page.blocks` için ayrı sınır TANIMLANMAZ — `MAX_TOTAL_PAGE_NODES` (300) ve
`MAX_PAGE_BLOCKS_BYTES` (256 KB) zaten `PageBlockListSchema` üzerinden uygulanır
(§2 madde 3). İkinci bir sayı tanımlamak §2.6 tipi "üç yerde birebir aynı olmak
zorunda" borcunu artırırdı.

### 3.4 Token çözümleme — `asset:` ve `ref:` (bağlayıcı)

Şablon tanımı **hiçbir uuid ve hiçbir URL İÇERMEZ.** İki token ailesi vardır:

| Token | Nerede geçer | Neye çözülür |
|---|---|---|
| `asset:<assetKey>` | `page.blocks` içindeki SERBEST URL alanları (`image.data.url`, `gallery.data.images[].url`, `testimonial` `avatarUrl`, `logo-marquee` `url`) | Materyalize edilen `Media.url` (mutlaklaştırılmış) |
| `ref:slider` | `page.blocks` içindeki `advanced-slider` düğümünün `data.sliderId` | Yeni oluşturulan `Slider.id` |

FK slotları (`coverAssetKey`, `galleryAssetKeys`, `bgAssetKey`) token DEĞİL, **tipli
alanlardır** — orada `assets[].key`'in doğrudan kendisi yazılır. Gerekçe: FK slotu
zaten `Media.id` bekler, string içinde token aramaya gerek yoktur; tipli alan
derleme zamanında korunur.

**Bağlayıcı kurallar:**

1. Çözümleme **ağaç üzerinde iteratif** yapılır (özyineleme YOK) —
   `lib/page-blocks.ts::scanPageNodeStructure` ile AYNI yaklaşım.
2. Sıra ZORUNLU: **(a)** token çözümle → **(b)** `PageBlockListSchema` ile Zod
   doğrula → **(c)** DB'ye yaz. Tersi olursa çözülmemiş token Zod'dan geçer
   (`ImageBlockDataSchema.url` yalnızca `z.string().min(1)`'dir, format doğrulamaz).
3. **Çözülemeyen bir token FATAL'dır** — import başarısız olur, `500` DEĞİL
   `422 VALIDATION_ERROR` döner (`error.details.unresolvedTokens: string[]`).
   Sessizce geçirmek, yayındaki sitede `<img src="asset:hero-1">` bırakırdı.
4. Token biçimi tek bir dosyada üretilir/ayrıştırılır (`lib/asset-tokens.ts`) —
   `sliders/shortcode.ts::buildSliderShortcode` ile AYNI "tek üretim noktası"
   disiplini.

---

## 4. Placeholder görsel stratejisi (bağlayıcı)

### 4.1 KARAR: SVG **servis edilmez / `Media` OLMAZ**. Paketlenmiş varlıklar **PNG**'dir.

Kullanıcı SVG önerdi. **Öneri, ÜRETİM KAYNAĞI olarak KABUL, ÇALIŞMA ZAMANI FORMATI
olarak REDDEDİLDİ.** Gerekçe kanıta dayalıdır, tercih değildir:

1. `backend/src/lib/mime-detect.ts:36-40` SVG'yi **"tanınan ama daima reddedilecek"**
   tür olarak modelliyor (`isSvg: true`) ve dosya başlığı gerekçeyi yazıyor:
   *"içine `<script>` gömülebildiği için depolanmış XSS riski taşır"*. Bu, security-agent
   tarafından zaten karara bağlanmış bir sınıftır — bir demo şablonu için delinemez.
2. `mime-detect.ts:44-49::MIME_TO_EXTENSION` içinde `image/svg+xml` **YOK** →
   `extensionForMimeType()` boş string döner → `LocalStorage.save()` diske
   **uzantısız** bir dosya yazar → `@fastify/static` bunu belirsiz bir
   `Content-Type` ile servis eder. Bu tam olarak `local.storage.ts:8-16`'daki
   güvenlik yorumunun engellemek için var olduğu durumdur.
3. `next/image`, SVG için `dangerouslyAllowSVG` gerektirir — adı zaten kararı
   veriyor; bunu tüm site için açmak, bir şablon uğruna global bir güvenlik
   gevşetmesidir.

**Karar: `assets/<templateKey>/*.png`.** WEBP değil, PNG — gerekçe §4.3.

### 4.2 KARAR: paketlenmiş varlıklar GERÇEK `Media` satırı olur (istisnasız)

Serbest-URL alanları (`ImageBlock.data.url` vb.) teknik olarak `frontend/public/...`
altındaki bir statiği gösterebilirdi. **Reddedildi.** Tüm şablon görselleri, FK
gerektirsin gerektirmesin, `Media` satırına dönüştürülür:

1. **Kullanıcının İLK işi bu görselleri kendi fotoğraflarıyla değiştirmektir.**
   Medya kütüphanesinde görünmeyen bir görsel, mevcut medya seçici (`MediaPicker`)
   ile değiştirilemez — demo şablonunun tüm değerini yok eder.
2. Backend ve frontend **farklı origin'lerde** çalışır (`FRONTEND_URL` /
   `PUBLIC_URL` ayrı env'ler). `frontend/public` yolu, backend'in ürettiği veriye
   gömülürse S3 sürücüsünde ve ayrık deploy'da kırılır.
3. Tek kod yolu = tek hata sınıfı. İki görsel sınıfı ("Media olan" / "olmayan")
   altı ay sonra "bu görseli neden değiştiremiyorum?" hatasını üretirdi.

**Uygulama (bağlayıcı, `lib/assets.ts`):** dosya `fs.readFile` ile Buffer'a alınır →
`detectImageMimeType(buffer)` (paketlenmiş varlık da AYNI kapıdan geçer, istisna
yok) → **`storage.save({ buffer, filename, mimeType })`** → `imageSize(buffer)` →
`Media.create`. **Dosya doğrudan `UPLOAD_DIR`'e KOPYALANMAZ** (`fs.copyFile` YASAK):
`storage` soyutlaması `STORAGE_DRIVER=s3` iken devrededir ve elle kopyalama S3
kurulumunda sessizce bozuk kayıt üretirdi. `sizeBytes` = `buffer.byteLength`
(`fs.stat` gereksiz, buffer zaten elimizde).

### 4.3 Varlıklar NASIL üretilir — SVG kaynak → PNG çıktı

Depoda `sharp`/`resvg` **YOKTUR ve EKLENMEZ** (kullanıcı kısıtı + code-quality-agent
bağımlılık politikası). Bu, formatı belirler: **PNG, Node'un yerleşik `zlib`'i ile
bağımlılıksız yazılabilen TEK raster formattır** (WEBP libwebp gerektirir). Karar
zinciri: bağımlılık yok → rasterizasyon yok → PNG.

İki katmanlı üretim:

| Katman | Ne | Kim | Nerede |
|---|---|---|---|
| Kaynak | Elle yazılmış SVG (soyut gradient bina silueti, ince çizgi motifi) | **ui-designer** | `assets/modern-architecture/_source/*.svg` — depoda tutulur, **çalışma zamanında OKUNMAZ**, servis EDİLMEZ |
| Çıktı | PNG | **backend-agent**, tek seferlik yardımcı script | `assets/modern-architecture/*.png` — depoya COMMIT edilir |

Yardımcı script: `backend/scripts/build-template-assets.ts` — **yalnızca `node:zlib`
ile** (yeni bağımlılık YOK) bildirimsel bir gradient/geometri tanımından PNG üretir.
CI'da ÇALIŞMAZ, çalışma zamanında ÇAĞRILMAZ; palet değişirse elle bir kez koşturulur
(`APPEARANCE_PRESETS`'in elle güncellenmesiyle aynı sınıf iş). Çıktı `imageSize()`
ile parse edilebilmelidir — bu, script'in kabul kriteridir.

**Ölçüler (bağlayıcı):** portföy kapağı 1200×900 (4:3), CTA/banner 1920×720,
`preview.webp` 1200×750. Dosya başına `MAX_TEMPLATE_ASSET_BYTES` (512 KB) —
gradient PNG'ler pratikte 40-80 KB'dir; sınır bir güvenlik tavanıdır.

### 4.4 Varlık sayısını MİNİMUMDA tutan üç karar

1. **Hero slaydının arka planı görsel DEĞİL, `bgType: GRADIENT`'tır.** `Slide` modeli
   gradient'i birinci sınıf destekliyor (`bgGradientFrom/To/Angle`). Referans sitenin
   hero'su bir bina fotoğrafıdır ve **onu zaten kopyalayamıyoruz**; koyu antrasit →
   yeşil bir gradient, sıfır varlık maliyetiyle aynı kompozisyonu (koyu zemin + sol-alt
   büyük başlık + pill CTA) verir. **Bonus:** LCP kaynağı ortadan kalkar.
2. **Altın "ince çizgi bina" motifi bir görsel DEĞİL, `icon-box` bloğudur** (lucide
   ikon + `accentColor`). Bir vektör illüstrasyonu PNG'ye rasterize edip 2× ölçekte
   bulanık göstermektense mevcut ikon setini kullanmak hem keskin hem sıfır varlıktır.
3. **`SiteSettings.logoUrl` BOŞ BIRAKILIR** (`null`). Şablon logo ÜRETMEZ — header
   `siteName` metnine düşer. Gerekçe hem telif (§9) hem doğruluk: kullanıcının kendi
   logosu vardır ve yer tutucu bir logo yayına sızma riski taşır.

Net sonuç: **`modern-architecture` şablonu ~6 PNG varlık taşır** (4 portföy kapağı,
1 CTA banner, 1 "hakkımızda" görseli). Kalan tüm görsellik gradient/renk/tipografidir.

### 4.5 Önizleme görseli (`previewImageUrl`) — Media DEĞİL

Bu, **admin panelinin kendi kromudur**, sitenin içeriği değildir: medya
kütüphanesine girmemeli, kullanıcı silememeli, import'la yaratılmamalıdır.
Yerleşim: **`frontend/public/demo-templates/<key>/preview.webp`**, registry
göreli yolu taşır, frontend kendi origin'iyle çözer. (Burada WEBP serbesttir —
`Media` boru hattından geçmez, elle üretilmiş tek bir dosyadır.)

---

## 5. İşlem modeli — iki fazlı, telafili (bağlayıcı)

### 5.1 Neden tek transaction YETMEZ

Dosya sistemi/S3 yazma işlemleri **transaction'a dahil edilemez.** Naif "her şeyi tek
`$transaction`'a koy" yaklaşımı iki hatadan birini üretir: (a) `Media` satırları
transaction dışında yaratılırsa, rollback sonrası **medya kütüphanesinde yetim
kayıtlar** kalır; (b) dosyalar transaction içinde yazılırsa, rollback sonrası
**diskte yetim dosyalar** kalır.

### 5.2 Bağlayıcı akış

```
FAZ 0 — DOĞRULAMA (yazma YOK)
  0.1 templateKey registry'de var mı            → yoksa 404 NOT_FOUND
  0.2 DemoTemplateImport kaydı var mı           → varsa ve !force → 409 CONFLICT (§6.4)
  0.3 asset:/ref: token çözümleme (§3.4)        → çözülemeyen → 422
  0.4 PageBlockListSchema + SlideLayersSchema   → başarısız → 422
  0.5 page.slug / slider.slug / portfolio slug çakışma kontrolü + benzersizleştirme (§6.5)

FAZ 1 — VARLIK MATERYALİZASYONU (transaction DIŞINDA, DB yazma YOK)
  her asset için: readFile → detectImageMimeType → storage.save() → imageSize()
  sonuç: SavedAsset[] = { key, path, url, mimeType, sizeBytes, width, height }
  → BU FAZDA HİÇBİR `Media` SATIRI YARATILMAZ.

FAZ 2 — TEK TRANSACTION (app.prisma.$transaction, sıra BAĞLAYICI)
  2.1  media.createMany            (Faz 1 sonuçlarından)
  2.2  siteAppearance.upsert       (§7)
  2.3  siteSettings.update         (§6.2 — 5 alan)
  2.4  navigationItem: deleteMany({}) → create (kök → çocuk)     [YIKICI, §6.1]
  2.5  footerColumn: deleteMany({}) → create (+ FooterLink)      [YIKICI, §6.1]
  2.6  socialLink: deleteMany({}) → createMany                   [YIKICI, §6.1]
  2.7  portfolioCategory.create → portfolioItem.create → portfolioImage.createMany
  2.8  slider.create → slide.create (order 0..n-1)
  2.9  `ref:slider` çözümlemesi blocks ağacına uygulanır → page.create
  2.10 setAsHomePage ise siteSettings.update({ homePageId })
  2.11 demoTemplateImport.upsert (§6.4)

TELAFİ — Faz 2 herhangi bir noktada fırlarsa
  Faz 1'de kaydedilen HER dosya için storage.remove(path)  [best-effort]
  başarısız silme → app.log.warn({ paths }) — kullanıcı isteğini ETKİLEMEZ
  → hata istemciye OLDUĞU GİBİ döner (yutulmaz)

TRANSACTION SONRASI (best-effort, hata yutulur)
  logAudit(...)  →  triggerPublicPageRevalidation(app, page, { isHomePage })
```

### 5.3 İzolasyon ve timeout (backend-agent — atlanırsa ÜRETİMDE PATLAR)

- **`runSerializable` KULLANILMAZ.** O yardımcı "check-then-act" yarışları içindir
  (son admin kontrolü, stok düşürme). Burada korunması gereken tek değişmez
  `DemoTemplateImport.templateKey` benzersizliğidir ve onu **DB kısıtı** zaten
  izolasyon seviyesinden bağımsız garanti eder. Uzun ve çok tablolu bir yazmayı
  Serializable'a almak, gereksiz P2034 retry fırtınası riski üretir.
- **`timeout` AÇIKÇA verilir:** Prisma interaktif transaction varsayılanı **5 sn**
  ve bu işlem (6 Media + ~15 nav + ~20 footer + ~12 portföy + slider + sayfa)
  yavaş bir veritabanında bunu aşabilir. Bağlayıcı:
  `app.prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 })`.

### 5.4 Asenkron kuyruk (job) AÇILMAZ

`ImportJob` deseni **kullanılmaz**, uç **senkron** yanıt verir. Gerekçe: iş yükü
sabit ve küçüktür (~50 satır + ~6 küçük dosya, saniyenin altı); bir kuyruk,
durum yoklama (polling) UI'ı, `ImportJobStatus` yönetimi ve iptal semantiği
getirirdi — kazanılan hiçbir şey karşılığında. Kullanıcı düğmeye basar, spinner
döner, sonuç gelir.

---

## 6. API sözleşmesi

### 6.1 Yıkıcılık matrisi (kullanıcıya AÇIKÇA gösterilir — ui-designer/frontend-agent)

| Alan | Davranış | Neden |
|---|---|---|
| `SiteAppearance` (renk/tipografi/bileşen) | **ÜZERİNE YAZILIR** | Singleton; "demo görünümü" zaten budur |
| `SiteSettings` (5 alan, §6.2) | **ÜZERİNE YAZILIR** | Singleton |
| `NavigationItem` | **TAMAMEN DEĞİŞTİRİLİR** | `PUT /admin/navigation` zaten tam-replace semantiğindedir — ikinci bir birleştirme semantiği icat etmek iki farklı doğruluk üretirdi |
| `FooterColumn`+`FooterLink`, `SocialLink` | **TAMAMEN DEĞİŞTİRİLİR** | Aynı gerekçe; kısmi birleştirme "hangi sütun benim?" sorusunu doğururdu |
| `PortfolioCategory`/`PortfolioItem`/`PortfolioImage` | **EKLENİR** (mevcut asla silinmez) | Kullanıcı içeriğidir; bir demo şablonu kullanıcı içeriğini SİLEMEZ |
| `Slider`+`Slide` | **EKLENİR** | Aynı |
| `Page` | **EKLENİR** (slug çakışmasında §6.5) | Aynı |
| `Media` | **EKLENİR** | Aynı |
| `SiteSettings.homePageId` | `setAsHomePage` ise **ÜZERİNE YAZILIR**; eski değer audit'e düşer | Geri dönüş için `metadata.previousHomePageId` |

**Bağlayıcı UI kuralı:** `POST` çağrısı öncesi onay diyaloğu bu matrisi **madde madde**
gösterir ve "Navigasyon menünüz, footer'ınız, sosyal medya linkleriniz ve site
renkleriniz SİLİNİP şablonunkilerle değiştirilecek" cümlesini içerir. Sunucu ayrıca
`confirm: true` ister (§6.3) — çift kapı.

### 6.2 `SiteSettings`'ten yazılan alanlar — TAM LİSTE

`siteName`, `tagline`, `headerCtaLabel`, `headerCtaHref`, `footerCopyrightText`
(+ koşullu `homePageId`). **`siteTemplate`, `logoUrl`, `headerLogoHeight`,
`headerLogoMaxWidth` YAZILMAZ.** `siteTemplate` yalnızca bir modül-öneri ipucudur
(schema.prisma:1008-1011: "hiçbir modülü OTOMATİK açmaz/kapatmaz") ve kullanıcının
kurulum sihirbazında verdiği karardır; bir demo şablonunun onu sessizce ezmesi
yanlış olurdu. `logoUrl` için bkz. §4.4 madde 3.

### 6.3 Uçlar

| Metot | Yol | SiteRole | Hız sınırı |
|---|---|---|---|
| GET | `/admin/demo-templates` | ADMIN, MANAGER, EDITOR (panel kapısı) | — |
| POST | `/admin/demo-templates/{templateKey}/import` | **yalnızca ADMIN** | 5 istek / 1 dk |

**Neden `POST .../{templateKey}/import`, kullanıcının önerdiği `POST /admin/templates/import`
(gövdede key) DEĞİL:** kaynak yolda kimlik taşıma bu kontratın her yerindeki desendir
(`POST /admin/sliders/{sliderId}/duplicate`, `PATCH /admin/modules/{key}`,
`POST /admin/import/jobs/{jobId}/start`). Ayrıca hız sınırı ve audit korelasyonu yol
üzerinden okunabilir olur.

**Neden yazma yalnızca ADMIN (bağlayıcı, security-agent'a gerekçe):** bu uç
`SiteSettings.homePageId`'yi YAZAR. `PATCH /admin/settings` ZATEN ADMIN-only'dir ve
`x-site-rbac` bloğunda MANAGER'ın dışlandığı **(a) ayrıcalık yükseltme yüzeyi**
kategorisinde açıkça sayılıdır. MANAGER'a bu ucu vermek, kapalı bir kapıyı yan
pencereden açmak olurdu. Ek olarak işlem, navigasyon/footer/sosyal linkleri **silip**
site-geneli görünümü ezer — `Import` tag'indeki "toplu içe aktarma kayıt-bazlı
incelemeyi atlar" gerekçesiyle aynı sınıftır.

**Neden okuma panel kapısı (ADMIN/MANAGER/EDITOR):** yanıt **kod içi statik bir
registry**dir, sıfır kullanıcı verisi taşır. Emsal `GET /admin/appearance/presets`
(authenticated). `/admin/import/*`'ın "okuma dahil ADMIN" kuralı BURAYA UYGULANMAZ,
çünkü orada okunan şey kullanıcının yüklediği veridir. Arayüz, ADMIN olmayan
kullanıcıya ekranı **salt-okunur** gösterir ("Uygula" düğmesi devre dışı + neden).

**Neden hız sınırı GEREKLİ:** her çağrı ~6 dosya yazar ve uzun bir transaction açar.
Çift tıklama/otomatik retry, `force` ile birlikte N kopya içerik + N×6 dosya
üretebilir. `CUSTOM_CODE_RATE_LIMIT` (10/dk) ile aynı sınıf koruma, daha sıkı eşikle.

### 6.4 İdempotency / tekrar çalıştırma (bağlayıcı)

- İlk import → `DemoTemplateImport` satırı yazılır (`templateKey` **@unique**).
- İkinci import, `force: false` (varsayılan) → **`409 CONFLICT`**,
  `error.details = { templateKey, importedAt, importedBy, templateVersion, pageId }`.
  Frontend bu detayla "12.03.2026'da uygulandı, yine de yeniden uygulansın mı?"
  diyaloğunu kurar.
- `force: true` → **izin verilir ve şu davranış BAĞLAYICIDIR:**
  - Yıkıcı bölüm (appearance/settings/nav/footer/social) **yeniden uygulanır**.
  - Additive bölüm (page/slider/portfolio/media) **İKİNCİ BİR KOPYA** üretir;
    slug'lar `-2`, `-3` … ile benzersizleştirilir (§6.5).
  - **Önceki import'un ürettiği içerik SİLİNMEZ.** Gerekçe: o kayıtlar oluşturulduktan
    sonra kullanıcı tarafından düzenlenmiş olabilir ve "şablondan gelen" ile
    "kullanıcının yazdığı" arasında güvenilir bir ayrım YOKTUR. Sessizce silmek veri
    kaybıdır; bir demo aracı bunu asla yapmaz.
  - `DemoTemplateImport` satırı **upsert** edilir (son uygulama kazanır).
- `409 + force` idiyomu, `DELETE /admin/sliders/{sliderId}` (kullanımdaysa 409,
  `force` ile geçilir) ile BİREBİR aynı desendir — yeni bir kaçış mekanizması
  icat edilmemiştir.

**Gövde ayrıca `confirm: true` ZORUNLU** (`ImportDemoTemplateRequest`). Eksikse
`422`. Gerekçe: bu, yıkıcı ve tek tıkla tetiklenen bir işlemdir; yanlışlıkla
gönderilmiş bir POST'un siteyi değiştirmemesi için sunucu tarafı açık niyet ister
(`Import` modülündeki `ImportDuplicateStrategy` açık seçimiyle aynı felsefe).

### 6.5 Slug çakışması

`page.slug`, `slider.slug`, `portfolioCategory.slug`, `portfolioItem.slug` hepsi
`@unique`'tir. **Karar: 409 DEĞİL, otomatik benzersizleştirme** —
`<slug>`, `<slug>-2`, `<slug>-3` … `lib/slug.ts` yardımcılarıyla, **Faz 0'da**
(transaction dışında ön kontrol) ve **Faz 2'de** `P2002` yakalanırsa yeniden
denemeli. Gerekçe: kullanıcının sitesinde zaten `anasayfa` adlı bir sayfa olması
tamamen normaldir; bunun için import'u komple reddetmek düşmanca olurdu.
`PortfolioItem.status` şablonda daima `PUBLISHED`'dır (demo'nun amacı **görünen**
bir site üretmektir); `Page.status` da `PUBLISHED` + `publishedAt: now()`.

### 6.6 `warnings[]` — engellemeyen uyarılar

`DemoTemplateImportResult.warnings: string[]`. Bilinen üreteçler:
- `portfolio` modülü kapalı → *"Portföy modülü kapalı olduğu için içe aktarılan
  projeler sitede görünmeyecek. /admin/modules üzerinden açabilirsiniz."*
- Slug benzersizleştirildi → *"`anasayfa` zaten kullanılıyordu, sayfa
  `anasayfa-2` olarak oluşturuldu."*
- `force: true` ile ikinci kopya üretildi.

Uyarılar **asla** başarısızlık değildir; HTTP `201` döner.

### 6.7 Denetim (observability/security)

```
logAudit(app, { action: "demo_template.import", status: SUCCESS|FAILURE, metadata: {
  templateKey, templateVersion, force, confirm,
  createdPageId, createdSliderId, previousHomePageId,
  counts: { media, portfolioCategories, portfolioItems, navigationItems,
            footerColumns, footerLinks, socialLinks, slides },
  warnings
}})
```

`previousHomePageId` **zorunludur** — kullanıcının ana sayfasını geri alabilmesinin
tek kaydıdır. Başarısız import de (`status: FAILURE`, `metadata.error`) loglanır.
**`WebhookEvent` enum'ına olay EKLENMEZ** (geri alınamaz `ALTER TYPE`; harici
entegratör için anlamsız).

---

## 7. `SiteFont` / `SiteBorderRadius` eşlemesi (bağlayıcı)

### 7.1 Work Sans → `SiteFont` enum'una EKLENMEZ

`SiteFont` kapalı bir enum'dur çünkü `next/font/google` derleme zamanında font adını
bilmek zorundadır (schema.prisma:1041-1044). Work Sans `next/font/google`'da
MEVCUTTUR — yani teknik engel yok. **Buna rağmen eklenmiyor**, çünkü bir font
enum'u **site-geneli bir yetenektir** ve sahibi tema/tipografi özelliğidir
(`.claude/architect-scope-theme-typography.md`); tek bir demo şablonu uğruna global
bir yeteneği genişletmek sahiplik ters çevirmesidir ve `schema.prisma` + 3 frontend
dosyasında eşzamanlı değişiklik gerektirir.

**Eşleme (bağlayıcı):**

| Slot | Değer | Gerekçe |
|---|---|---|
| `headingFont` | **`PLUS_JAKARTA_SANS`** | Work Sans'ın 58px kalın başlıklardaki sıcak/hümanist karakterine en yakın mevcut değer |
| `bodyFont` | **`INTER`** | Küçük gri gövde metninde nötr, ekran-optimize, tam Türkçe diakritik kapsama |
| `baseFontSize` | **16** | Varsayılan; referansın gövde ölçüsüyle uyumlu |

İki farklı font seçilmesinin gerekçesi: referans sitede Work Sans **iki rol**
üstleniyor (dev başlık + küçük gövde). Tek bir enum değeri ikisini de taklit
edemez; bölmek optik olarak daha yakın sonuç verir.

**Backlog (ayrı özellik, bu turda YAPILMAZ):** `feature/site-font-work-sans` —
`SiteFont`'a `WORK_SANS`, `site-fonts.ts` + `SITE_FONT_OPTIONS` girdileri. Eklenirse
şablonun tek yapması gereken iki string değiştirmektir. **ui-designer bunu isterse
architect'e eskale eder, kendi kararıyla enum'a değer ekletmez.**

### 7.2 `borderRadius: MD` — pill (`FULL`) DEĞİL

Referans sitenin butonları `border-radius: 100px` (pill), **kartları değil.**
`SiteAppearance.borderRadius` ise TEK bir global token'dır ve
`.claude/architect-scope-theme-typography.md` uyarınca hem butonlarda hem
yüzeylerde `rounded-[var(--site-radius)]` olarak kullanılır. `FULL` (9999px)
seçmek kartları/görsel kutuları tamamen yuvarlatırdı — görsel olarak bozuk.

**Karar: `borderRadius: MD` (8px), `buttonStyle: SOLID`.**

Pill görünümü, **token'ın olmadığı yerde taklit edilmez**; blok/katman seviyesinde
zaten var olan alanlarla elde edilir:
- Slider katmanları: `SliderLayerStyle.borderRadius` (0-200 int) → **`100`**.
  `button` katmanı için şablonda bu değer yazılır.
- Sayfa bloklarındaki CTA butonları global token'ı miras alır → **8px görünür.**
  Bu, kabul edilmiş ve dokümante edilmiş bir SAPMADIR; frontend-agent bunu
  düzeltmek için `!rounded-full` gibi tek seferlik sınıf **EKLEMEZ** (görsel karar
  ui-designer'ındır ve token sistemini delmek yasaktır).

**Architect bulgusu → backlog:** `SiteAppearance`'ta `borderRadius`'ın buton ve
yüzey için ayrışmaması gerçek bir tasarım sistemi eksiğidir. Önerilen çözüm
`SiteAppearance.buttonRadius SiteBorderRadius @default(MD)` (ayrı özellik:
`feature/site-appearance-button-radius`). **Bu turda YAPILMAZ** — bir demo şablonu
uğruna global görünüm kontratını genişletmek, sahipliği tersine çevirir. Bu madde
ui-designer + theme-typography sahibine devredilir.

### 7.3 Renk slotları — DEĞERLERİ ui-designer ONAYLAR

Aşağıdaki değerler orkestratörün canlı-site gözleminden **başlangıç noktasıdır**;
**nihai hex'ler ve WCAG AA doğrulaması ui-designer'ın kararıdır**
(`.claude/CLAUDE.md`: görsel çelişkide ui-designer kazanır).

| `SiteAppearance` alanı | Başlangıç | Gözlemdeki karşılığı |
|---|---|---|
| `primaryColor` | `#1C4B42` | koyu yeşil vurgu başlıklar |
| `secondaryColor` | `#1F2124` | antrasit header/footer |
| `buttonColor` / `buttonTextColor` | `#1F2124` / `#FFFFFF` | siyah dolgu pill CTA |
| `linkColor` | `#1C4B42` | — |
| `accentColor` | `#C9A227` | altın aksan (servis kartı motifi, ikonlar) |
| `backgroundColor` | `#F6F5F2` | sıcak krem zemin |
| `surfaceColor` | `#FFFFFF` | kart yüzeyi |
| `textColor` | `#1F2124` | — |
| `mutedTextColor` | `#6B6F76` | gri gövde metni |

**Lime `#B4E717` bilinçli olarak TOKEN'A ALINMAZ.** Referans sitede yalnızca ince
bir hover/aktif çizgisinde görünüyor ve `SiteAppearance`'ta bir "hover/vurgu çizgisi"
slotu YOK. İkinci bir aksanı `accentColor`'a sıkıştırmak altın motifi kaybettirirdi.
İhtiyaç duyulursa blok seviyesinde (`divider` rengi, container `background`) yerel
olarak kullanılabilir — ui-designer karar verir.

`presetKey`: **`null`** yazılır. Şablon bir görünüm ön ayarı DEĞİLDİR ve
`presetKey` "en son hangi ön ayardan başlandı" anlamını taşır; oraya bir şablon
anahtarı yazmak iki registry'yi (appearance-presets ↔ demo-templates) sessizce
birbirine bağlardı.

---

## 8. Sayfa kompozisyonu — mevcut bloklarla eşleme (YENİ BLOK TİPİ YOK)

Doğrulandı: gözlemlenen 10 bölümün tamamı mevcut blok setiyle karşılanır.
Aşağıdaki tablo BAĞLAYICI eşlemedir; **backend-agent bu tabloya sadık kalarak
somut `PageNode[]` JSON'unu yazar** (stil/token değerleri ui-designer'dan gelir).

| # | Bölüm | Blok bileşimi |
|---|---|---|
| 1 | Header | **Blok DEĞİL** — `NavigationItem` + `SiteSettings.headerCta*` + `SiteAppearance.stickyHeaderEnabled: true` |
| 2 | Hero (tam genişlik, sol-alt başlık, pill CTA, alt sekme şeridi) | `advanced-slider` (`data.sliderId = ref:slider`) → `Slider` (`widthMode: FULL_WIDTH`, `heightMode: ASPECT_RATIO 16:9`), slaytta `bgType: GRADIENT` + `heading`/`text`/`button` katmanları. **Alt sekme şeridi v1'de KAPSAM DIŞI** (slider'da sekme kroması yok; §8.1) |
| 3 | 3'lü hizmet kartları | `container` (`layout: boxed`, `direction: row`, `gap`) → 3 × `container` (her biri `background.type: solid`, biri koyu) → `icon-box` + `heading` + `text` |
| 4 | 4 sütunlu proje portföyü | `heading` (ortalı) + `featured-portfolio` + `button` (ortalı pill) |
| 5 | Koyu "Farkımızla Tanışın" paneli | `container` (`layout: full-width`, koyu `background`, `topDivider: { type: "curve" }`) → `heading` + iç `container` (row) → 4 × `icon-box` |
| 6 | Sayaç bandı | `counter` (4 öğe) |
| 7 | Koyu CTA banner | `container` (full-width, `background.type: image` → `asset:cta-banner` + overlay) → `cta` |
| 8 | Bölünmüş iletişim formu | `container` (row) → sol `container` (krem) → `heading` + `text` + `contact-form`; sağ `container` (koyu) → `icon-box` (altın motif, §4.4) + `text` |
| 9 | Bülten çubuğu | `container` (nötr zemin) → `cta` (**§8.2 — bülten aboneliği YOKTUR**) |
| 10 | 4 sütunlu koyu footer | **Blok DEĞİL** — `FooterColumn`/`FooterLink` + `SocialLink` + `SiteSettings.footerCopyrightText` |

### 8.1 Hero'nun alt sekme şeridi — KAPSAM DIŞI (bilinçli)

Referanstaki 4'lü yatay kategori sekmesi, slider kromunun bir parçasıdır ve
`Slider` modelinde karşılığı yoktur (`showArrows`/`showBullets`/`showProgressBar`
var, "sekme etiketi" yok). Bunu eklemek `Slider`'a yeni kolon + Hero Studio'da yeni
müfettiş sekmesi + yeni render kroması demektir — **`sliders` özelliğinin kapsamıdır,
bir demo şablonunun değil.** v1'de `showBullets: true` kullanılır.
Backlog: `feature/slider-tab-navigation`.

### 8.2 Bülten (newsletter) — KAPSAM DIŞI (bilinçli)

Sistemde e-posta aboneliği toplayan bir model/uç YOKTUR. Çalışmayan bir e-posta
input'u koymak, ziyaretçiden veri toplamayı **vaat edip toplamamaktır** — hem
kullanıcı güveni hem KVKK açısından kabul edilemez (compliance-agent notu). Bölüm,
mevcut `contact-form` bloğuna yönlendiren bir `cta` ile karşılanır. Gerçek bülten
istenirse: `feature/newsletter-subscription` (notification-agent + compliance-agent).

---

## 9. Telif ve kişisel veri (compliance-agent — BAĞLAYICI)

Bu bölüm kod incelemesinde **engelleyici** kontrol listesidir.

1. **Kopyalanabilir olan:** renk paleti, tipografi ölçek/ağırlık ilişkisi, blok
   kompozisyon sırası, boşluk ritmi. Tasarım dili analizi telif konusu değildir.
2. **KOPYALANMASI YASAK:** gerçek firmanın logosu, gerçek proje fotoğrafları,
   gerçek metin blokları (birebir cümleler dahil), gerçek adres/telefon/e-posta,
   gerçek proje/müşteri isimleri.
3. **Görseller:** yalnızca §4.3 ile bu depoda ÜRETİLEN PNG'ler. İnternetten indirme
   YOK, hotlink YOK, stok görsel YOK, AI-üretimi fotogerçekçi bina görseli YOK.
4. **Kurgusal firma adı:** `"Kütle Yapı"` (compliance-agent denetimi, önceki
   "Mimarist Yapı" adı TMMOB Mimarlar Odası'nın tanınan "Mimarist" dergisiyle
   çakışma riski taşıdığı için değiştirildi — bkz. `templates/modern-architecture.ts`
   dosya başı yorumu).
5. **İletişim yer tutucuları (bağlayıcı, uydurma değer YASAK):**
   - E-posta: **`info@example.com`** (RFC 2606 rezerve alan adı). Sahibi olmadığımız
     bir alan adı yazmak, yayına çıkan bir sitede yabancı birine posta gönderir.
   - Telefon: **`+90 212 000 00 00`** (atanmamış santral).
   - Adres: **"Örnek Mah. Örnek Cad. No: 1, Kadıköy / İstanbul"** — coğrafi olarak
     çözümlenemeyen jenerik ifade.
   - Sosyal linkler: `SocialLink` **BOŞ DİZİ** olarak uygulanır (var olmayan
     hesaplara link vermek 404 üretir; gerçek hesaplara link vermek başkasının
     hesabını tanıtır).
6. **PII yoktur** — şablon hiçbir kişisel veri taşımaz/üretmez, bu nedenle KVKK
   saklama/silme etkisi YOKTUR. `DemoTemplateImport.importedById` bir iç kullanıcı
   referansıdır ve mevcut `AuditLog`/`SiteModule.updatedById` ile aynı sınıftadır.
7. **Şablon metinleri jenerik Türkçe** olacak; ürün/proje açıklamaları "Lorem ipsum"
   DEĞİL, anlamlı ama kurgusal Türkçe metin (kullanıcı bunları kendi metniyle
   değiştirecek).

---

## 10. Veritabanı — db-agent

### 10.1 Karar: **EVET, tek bir küçük tablo gerekiyor**

Kullanıcının "muhtemelen migration YOK" beklentisi **kısmen doğrudur**: içeriği
yazmak için mevcut tablolar TAMAMEN YETERLİDİR, yeni kolon/enum gerekmez. Ama
"bu şablon daha önce uygulandı mı?" sorusunun **bir yeri olmalıdır** ve mevcut
alternatifler yetersizdir:

| Alternatif | Karar |
|---|---|
| `AuditLog`'u sorgula (`action = "demo_template.import"`) | **RED** — denetim izi *adli/insan* bir kayıttır, *uygulama durumu* değildir. compliance-agent yarın bir `audit-retention` süpürücüsü eklerse (mevcut `contact-retention`/`cart-retention`/`import.retention` emsalleri var) idempotency SESSİZCE bozulur. Ayrıca `/admin/logs` ADMIN-only'dir; okuma eşiği daha geniş olan bir uç için oradan veri türetmek yetki sızıntısı deseni doğurur. |
| `SiteSettings`'e `demoTemplateKey` kolonu | **RED** — tek slot (ikinci şablon geldiğinde kırılır) + singleton ayar tablosuna geçmiş kaydı sokar. |
| Türetme yok, her zaman 409 vermeden uygula | **RED** — kullanıcı çift tıklar, iki kopya site alır. |
| **Ayrı işaret tablosu** | **SEÇİLDİ.** |

### 10.2 Prisma modeli (doğrudan uygulanabilir)

Yerleşim: `backend/prisma/schema.prisma`, **`SiteModule` modelinden SONRA**
(en yakın kavramsal komşu: statik registry ↔ DB durum eşleşmesi). Yeni **enum YOK**.

```prisma
// 1 Tıkla Hazır Demo / Şablon İçe Aktarıcı — bkz.
// .claude/architect-scope-demo-template-import.md (bağlayıcı karar dokümanı) ve
// docs/architecture/openapi.yaml `DemoTemplates` tag'i.
//
// Bu tablo İÇERİK TUTMAZ; yalnızca "hangi demo şablonu, ne zaman, kim tarafından
// uygulandı" işaretini tutar (idempotency + panelde 'uygulandı' rozeti). Şablon
// TANIMI kod içi statik registry'dedir (SiteModule ↔ MODULE_REGISTRY ile AYNI
// patern): `templateKey` bir FK DEĞİL, o registry'ye referanstır.
//
// Oluşturulan kayıtların TAM listesi BURADA TUTULMAZ (§6.4): kullanıcı onları
// oluşturulduktan sonra düzenleyebilir/silebilir ve sahte bir referans grafiği
// yalan söylerdi. Yalnızca `pageId` tutulur — panelde "Oluşturulan sayfayı aç"
// bağlantısı için; sayfa silinirse SetNull ile boşalır.
model DemoTemplateImport {
  id          String   @id @default(uuid())
  templateKey String   @unique
  // Registry'deki semver. Şablon güncellenirse panel "yeni sürüm mevcut" gösterebilir.
  version     String
  importedAt  DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // Kullanıcı silinse de işaret korunur (SiteModule.updatedById ile AYNI desen).
  importedById String?
  pageId       String?

  importedBy User? @relation("DemoTemplateImporter", fields: [importedById], references: [id], onDelete: SetNull)
  page       Page? @relation("DemoTemplateImportedPage", fields: [pageId], references: [id], onDelete: SetNull)

  @@index([importedById])
  @@index([pageId])
  @@map("demo_template_imports")
}
```

Zorunlu karşı-ilişki alanları:

```prisma
// User modeline:
  demoTemplateImports DemoTemplateImport[] @relation("DemoTemplateImporter")

// Page modeline:
  demoTemplateImports DemoTemplateImport[] @relation("DemoTemplateImportedPage")
```

Migration adı: **`add_demo_template_imports`**. Salt-ekleme, veri kaybı riski YOK,
mevcut hiçbir tabloyu/enum'u değiştirmez, `ALTER TYPE` İÇERMEZ → tek migration'da
gönderilebilir.

---

## 11. Frontend (frontend-agent)

| Dosya | Değişiklik |
|---|---|
| `src/app/admin/demo-templates/page.tsx` | **YENİ** — sunucu bileşeni kabuğu (`admin/modules/page.tsx` deseni) |
| `src/app/admin/demo-templates/demo-templates-view.tsx` | **YENİ** — `"use client"`; kart ızgarası, "uygulandı" rozeti, yıkıcılık matrisi onay diyaloğu (§6.1), `force` ikinci onayı, sonuç/uyarı özeti |
| `src/lib/api/demo-templates.ts` | **YENİ** — `fetchDemoTemplates()`, `importDemoTemplate(key, body)` (`lib/api/portfolio.ts` deseni) |
| `src/lib/api/types.ts` | `DemoTemplateSummary`, `DemoTemplateImportResult` tipleri (openapi.yaml ile BİREBİR) |
| `src/components/admin/sidebar.tsx` | `{ href: "/admin/demo-templates", labelKey: "nav.demoTemplates", icon: LayoutTemplate, roles: ["ADMIN"] }` — `/admin/appearance` satırının HEMEN ARDINA |
| `src/lib/i18n/dictionaries/nav.ts` | `"nav.demoTemplates"`: `"Hazır Şablonlar"` / `"Starter Templates"` |
| `public/demo-templates/modern-architecture/preview.webp` | **YENİ** (§4.5) |

**Bağlayıcı UI kuralları:**
- Başarı sonrası **tam sayfa yenileme/`router.refresh()` ŞART** — appearance, nav
  ve footer değişti; mevcut istemci state'i artık yalandır.
- Sonuç ekranı `warnings[]`'i **tek tek** listeler ve oluşturulan sayfaya
  (`/admin/pages/{pageId}`) + slider'a (`/admin/sliders/{sliderId}`) doğrudan
  bağlantı verir.
- ADMIN olmayan panel kullanıcısı ekranı görür ama "Uygula" düğmesi devre dışıdır
  ve nedeni yazar (403'ü sürprize çevirmemek — `admin/modules` ile aynı desen).
- Import sırasında düğme **kilitlenir** (çift gönderim, hız sınırından ÖNCE
  istemcide engellenir).

---

## 12. QA kapsamı (qa-agent)

**Birim (backend-agent + qa-agent):**
1. `modern-architecture` tanımı `PageBlockListSchema`'dan geçer (§2 madde 3) —
   **bu test, şablon her değiştiğinde koruyucudur.**
2. Tüm `layers` dizileri `SlideLayersSchema`'dan geçer.
3. `assets[].key` benzersiz; `assets[].file` yol ayracı içermez; her `asset:` /
   `ref:` token'ı çözülebilir; her `coverAssetKey`/`bgAssetKey` `assets`'te var.
4. Çözülemeyen token → `422`, DB'ye HİÇBİR yazma yapılmamış.
5. Faz 2 hatası enjekte edildiğinde: `Media` satırı YOK **ve** `storage.remove`
   her dosya için çağrılmış (telafi testi — §5.2).

**E2E (`frontend/tests/e2e/admin-demo-template-import.spec.ts`):**
6. ADMIN olarak uygula → `201` → ana sayfa şablonun sayfası; public `/` yeni
   içeriği gösteriyor.
7. Aynı şablonu tekrar uygula → `409` + `importedAt` diyalogda görünüyor.
8. `force: true` → `201`, sayfa slug'ı `-2` ile oluşmuş, **önceki sayfa hâlâ var**.
9. `confirm` gönderilmeden POST → `422`.
10. **RBAC:** MANAGER `GET`i görüyor ama `POST`ta `403`; EDITOR aynı; USER/CUSTOMER
    `/admin/demo-templates`te `403`.
11. Import sonrası medya kütüphanesinde 6 yeni görsel var ve **medya seçiciyle
    değiştirilebiliyor** (§4.2'nin kabul kriteri).
12. `portfolio` modülü kapalıyken import → `201` + ilgili `warnings[]` girdisi.
13. Hız sınırı: 6. istek `429`.
14. Audit: `/admin/logs`'ta `demo_template.import` satırı ve
    `metadata.previousHomePageId` mevcut.

---

## 13. Definition of Done

- [ ] `DemoTemplateImport` modeli + `add_demo_template_imports` migration (db-agent)
- [ ] `/admin/demo-templates*` uçları openapi.yaml ile BİREBİR (backend-agent)
- [ ] Şablon tanımı Zod doğrulama testlerinden geçiyor (backend-agent + qa-agent)
- [ ] Varlıklar `storage.save()` üzerinden `Media` oluyor; `fs.copyFile` YOK;
      telafi (rollback) testi yeşil (backend-agent)
- [ ] Renk/tipografi/spacing değerleri + `_source/*.svg` teslim edildi, WCAG AA
      kontrast doğrulandı (ui-designer)
- [ ] `/admin/demo-templates` ekranı + yıkıcılık onay diyaloğu (frontend-agent)
- [ ] ADMIN-only yazma eşiği, `confirm` kapısı, hız sınırı, SVG reddi doğrulandı
      (security-agent)
- [ ] Telif/PII kontrol listesi (§9) madde madde imzalandı; kurgusal firma adı
      marka çakışması yok (compliance-agent)
- [ ] E2E testler yeşil (qa-agent)
- [ ] `CHANGELOG.md` + README + ARCHITECTURE.md yeni bölüm (documentation-agent)
- [ ] `assets/**` build çıktısına (`dist/`) kopyalanıyor; Docker imajında mevcut
      (devops-agent — §4 not: `tsc` yalnızca `.ts` derler, PNG'ler için
      `package.json` build script'ine kopyalama adımı eklenir)

---

## 14. Backlog (bu turda BİLİNÇLİ olarak YAPILMAYAN)

| Öğe | Branş |
|---|---|
| `SiteFont`'a `WORK_SANS` | `feature/site-font-work-sans` |
| `SiteAppearance.buttonRadius` (pill butonlar, yuvarlak olmayan kartlar) | `feature/site-appearance-button-radius` |
| Slider'da sekme/kategori navigasyonu | `feature/slider-tab-navigation` |
| Bülten aboneliği | `feature/newsletter-subscription` |
| Çok dilli demo şablonu | `feature/demo-template-i18n` |
| "Şablonu geri al" (undo) | `feature/demo-template-rollback` — §6.4'teki "kullanıcı düzenlemesini ayırt edemeyiz" sorunu çözülmeden AÇILMAZ |
