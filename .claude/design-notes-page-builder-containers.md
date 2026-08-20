# Tasarım Notları: Page-Builder Hiyerarşik Konteyner (Container) Mimarisi

Ajan: **architect** · Durum: **v3 kontratı (karar verildi, implementasyon bekliyor)** · Sahibi: Mimar
Kapsam: **Yalnızca `Page.blocks`** (ve `Page.translations.<LOCALE>.blocks`). `BlogPost`'un blok sistemi YOKTUR (§10.17.1 aynen geçerli) — bu tur da blog'a dokunmaz.
Bağlayıcı kaynak: bu doküman + güncellenecek `docs/architecture/openapi.yaml`. Çelişki halinde **openapi.yaml** tek doğru kaynaktır (single source of truth).
Önceki tur: §10.17 v1 (sabit `columnCount`/`ratio`) → v2 (esnek N-sütun `width`) → **v3 (bu doküman: hiyerarşik `container`)**.

Bu doküman **kod implementasyonu İÇERMEZ**. İçindeki TypeScript/Zod blokları, ilgili ajanların (frontend-agent / backend-agent) dosyalarına **birebir taşıyacağı kontrat tanımlarıdır** — placeholder değildir, ancak bu dokümanı yazan ajan bunları implementasyon dosyalarına YAZMAMIŞTIR.

---

## 0. Yönetici özeti (kararlar, tek bakışta)

| # | Soru | KARAR |
|---|---|---|
| 1 | `ColumnsBlock` değiştirilsin mi, genişletilsin mi? | **Değiştirilir (supersede).** Kanonik model tek bir `container` düğümüdür. `columns` **hiç üretilmeyen ama okunan/kabul edilen legacy şekil** olarak kalır. |
| 2 | Kök şekil değişiyor mu? | **HAYIR.** `Page.blocks` **dizi** olarak kalır (`PageNode[]`). Kök dizi = "örtük konteyner". Tek bir root `Container` nesnesine geçiş REDDEDİLDİ (gerekçe §2.2). |
| 3 | Derinlik kısıtı | `MAX_CONTAINER_DEPTH = 4` (kök seviye = 1). Yaprak bloklar en fazla 5. seviyede. |
| 4 | Diğer sınırlar | `MAX_CHILDREN_PER_CONTAINER = 24` (eski 20 ve 24'ün birleşimi), `MAX_TOTAL_PAGE_NODES = 300` (eski 200'den yükseltildi, gerekçe §4.3), `MAX_PAGE_BLOCKS_BYTES = 256 KB` (**YENİ**, §10.16'daki e-posta bloklarıyla aynı desen). |
| 5 | Migration | **DB migration script'i YOK.** İki katmanlı BC: (a) backend `z.preprocess` ile **yazma anında** `columns → container`, (b) frontend `normalizePageNodes()` ile **okuma anında**. Mevcut §10.17.8 deseninin aynısı, yapısal seviyeye yükseltilmiş hali. db-agent için **yapılacak hiçbir şey yok**. |
| 6 | `hero` sütun içine girebilir mi? | **EVET — yasak KALDIRILDI.** Gerekçe §3.4. `LeafBlock` ayrımı ortadan kalkar. |
| 7 | Palette / `registry.ts` | **§10.17.6'nın "columns palette'e EKLENMEZ" kararı GEÇERSİZ KILINDI.** Konteyner artık **doğrudan eklenebilir** (Layout Picker, 7 hazır ızgara ön ayarı). Detay ve gerekçe §8. |
| 8 | Render motoru | **Flexbox** (grid DEĞİL). `widthFr` → `flex-grow`. Gerekçe §6.1. |
| 9 | `minHeight` tipi | Kullanıcının önerdiği `string` **REDDEDİLDİ** → `{ value: number; unit: "px" \| "vh" }`. Gerekçe §5.3 (CSS injection). |
| 10 | Boxed varsayılan genişlik | **1170px** (istekteki slider varsayılanı). İstekte geçen `max-w-[1200px]` ile çelişki mimar tarafından 1170 lehine çözüldü; ayrıca **Tailwind arbitrary class DEĞİL, inline `maxWidth`** (dinamik değer, JIT statik tarama çalışmaz). |

---

## 1. Ortak terminoloji (bütün ajanlar bu kelimeleri kullanır)

| Terim | Anlamı | Yasak eşanlamlılar |
|---|---|---|
| **node** (`PageNode`) | Ağaçtaki herhangi bir düğüm: bir `container` **veya** bir içerik bloğu | "element", "item" |
| **container** (`ContainerNode`) | `type: "container"`, `settings` + `children` taşır | "section", "row", "column", "wrapper" — bunlar **yalnızca UI ön-ayar adlarıdır**, veri modelinde YOKTUR |
| **content block** (`ContentBlock`) | `hero`/`text`/`image`/`gallery`/`cta`/`featured-*` — `children` taşımaz | "leaf block" (v2 terimi, artık deprecated) |
| **legacy columns** | `type: "columns"` — v1/v2'de üretilmiş, artık **hiç üretilmeyen** şekil | — |
| **preset** | Layout Picker'daki hazır ızgara şablonu (100 / 50-50 / …) | "template", "layout" tek başına |

"Satır" ve "sütun" kelimeleri **yalnızca kullanıcıya dönük metinlerde** (Türkçe UI etiketleri) kullanılır; kod/şema/API'de `container` + `settings.direction` vardır.

---

## 2. Karar 1 — `ColumnsBlock` yerine geçen `container` (supersede), fakat kök dizi korunur

### 2.1 Değerlendirilen üç seçenek

**(A) Tam değiştirme, `columns` tipi tamamen kaldırılır.**
Reddedildi: DB'de canlı sayfalar var, `PageRevision` snapshot'ları var, `translations.<LOCALE>.blocks` var. `columns`'ı okuma tarafında da tanımaz hale getirmek, dokunulmamış sayfaların **sessizce boş render edilmesi** demektir. Bu, §10.17.8'de bilinçle kurulmuş BC felsefesinin tersidir.

**(B) `container` ve `columns` yan yana, ikisi de birinci sınıf.**
Reddedildi: iki paralel konteyner kavramı = iki dnd-kit sözleşmesi, iki sanitize yolu, iki render dalı, iki test seti. §10.17.4'te bulunan **stored XSS**'in kök nedeni tam olarak "bir konteyner tipi eklendi ama özyineleyen tüketicilerden biri güncellenmedi" idi. İkinci bir konteyner tipi bu riski ikiye katlar.

**(C) `container` kanonik, `columns` *yalnızca okunan/kabul edilen* legacy şekil.** ← **SEÇİLEN**

Somut anlamı:
- Yeni kod **asla** `type: "columns"` üretmez. `wrapInColumns`/`addColumnToRow`/`setColumnWidth` fonksiyonları `container` üreten karşılıklarıyla değiştirilir.
- Backend WRITE tarafında gelen bir `columns` düğümü **422 vermez**, `z.preprocess` ile sessizce `container`'a çevrilir ve DB'ye **container olarak** yazılır (v2'deki `ColumnsBlockDataPreprocessed` deseninin yapısal versiyonu).
- Frontend READ tarafında `normalizePageNodes()` aynı çevrimi uygular (GET yanıtı re-validate edilmeden ham JSON döndüğü için — bkz. `pages.routes.ts`).
- Sonuç: `columns` tipi **kontratta "deprecated, read-only"** olarak yaşar; her sayfa bir kez kaydedildiğinde kendiliğinden kaybolur.

### 2.2 Kök şekil neden `PageNode[]` olarak kalıyor (tek root `Container` nesnesi REDDEDİLDİ)

İstek metni "Root/Container düzeyi alanları" diyor. Bu, kök `blocks` alanının bir **nesne** olmasını gerektirmez ve gerektirmemelidir:

1. `pages.routes.ts::applyLocale` içindeki `PAGE_ARRAY_FIELDS = ["blocks"]` **dizinin tamamını** değiştirir (`Array.isArray` kontrolüne bağlı). Nesneye geçiş bu mekanizmayı sessizce bozar → çeviri sızıntısı/kaybı.
2. `openapi.yaml`'da `blocks` **beş ayrı yerde** `type: array` olarak tanımlı (`CreatePageRequest`, `UpdatePageRequest`, `AutosavePageRequest`, `PageDetail`, public page). Şekil değişimi **kırıcı (breaking) API değişikliği** olurdu; bu turda buna gerek YOK.
3. DB'deki her mevcut sayfa `[]` (dizi) — nesneye geçiş **zorunlu bir DB migration** üretirdi; §10.17.2'nin "db-agent için yapılacak hiçbir şey yok" kazanımı kaybolurdu.
4. `PageRevision` snapshot'ları ve `import.worker.ts` (tek `text` bloğu üretir) diziyi varsayar.

**Karar:** kök dizi = **örtük (implicit) root container**'dır. Ayarları sabittir ve serileştirilmez: `direction: "column"`, `layout: "full-width"`, `gap: 0`, `padding/margin: 0`. Kullanıcı sayfanın tamamına arka plan/genişlik vermek isterse **kök diziye tek bir `container` ekler** — Elementor'daki "Section" tam olarak budur. Bu, hiçbir şey kaybettirmez.

---

## 3. Veri modeli — kesin TypeScript tanımları

> **Hedef dosya:** `frontend/src/lib/page-builder/types.ts` (tam yeni hali)
> **Sahibi:** frontend-agent. `docs/architecture/shared-types.ts` §1387 bloğu da buna göre documentation-agent tarafından güncellenir.

```ts
// ============================================================================
// 1) İÇERİK BLOKLARI — data şekilleri BİREBİR DEĞİŞMEZ (geriye dönük uyumluluk)
// ============================================================================

export type ContentBlockType =
  | "hero"
  | "text"
  | "image"
  | "gallery"
  | "cta"
  | "featured-products"
  | "featured-portfolio";

/** Kanonik konteyner düğümü. */
export type ContainerNodeType = "container";

/** v1/v2'de üretilmiş, ARTIK ÜRETİLMEYEN şekil — yalnızca `normalize.ts` tanır. */
export type LegacyBlockType = "columns";

export type BlockType = ContentBlockType | ContainerNodeType;

interface BaseNode {
  id: string;
}

export interface HeroBlock extends BaseNode {
  type: "hero";
  data: { heading: string; subheading?: string; imageUrl?: string };
}

export interface TextBlock extends BaseNode {
  type: "text";
  data: { html: string };
}

export interface ImageBlock extends BaseNode {
  type: "image";
  data: { url: string; alt: string };
}

/** Galeri bloğunun görsel düzeni — bkz. `.claude/design-notes-page-builder-gallery.md`. */
export type GalleryLayout = "grid" | "carousel" | "masonry";

export interface GalleryBlock extends BaseNode {
  type: "gallery";
  data: {
    images: { url: string; alt: string }[];
    /** Eski kayıtlarda YOK olabilir — okuyan taraf `?? "grid"` ile varsayılana düşer. */
    layout: GalleryLayout;
  };
}

export interface CtaBlock extends BaseNode {
  type: "cta";
  data: { heading: string; buttonLabel: string; buttonHref: string };
}

export interface FeaturedProductsBlock extends BaseNode {
  type: "featured-products";
  data: { heading?: string; limit: number; categoryId?: string };
}

export interface FeaturedPortfolioBlock extends BaseNode {
  type: "featured-portfolio";
  data: { heading?: string; limit: number; categoryId?: string };
}

/**
 * `children` TAŞIMAYAN düğümler. v2'nin `LeafBlock`'undan farkı: `hero` ARTIK DAHİLDİR
 * (§3.4 — tam-genişlik ihtiyacı artık `container.settings.layout: "full-width"` ile
 * karşılanıyor, tip seviyesinde yasaklamaya gerek kalmadı).
 */
export type ContentBlock =
  | HeroBlock
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | CtaBlock
  | FeaturedProductsBlock
  | FeaturedPortfolioBlock;

/** @deprecated v2 adı — yalnızca geçiş sırasında import kırılmasın diye. Yeni kodda `ContentBlock` kullanın. */
export type LeafBlock = ContentBlock;

// ============================================================================
// 2) KONTEYNER
// ============================================================================

/** `boxed` = ortalanmış içerik kuyusu (max-width + güvenli gutter). `full-width` = kenardan kenara. */
export type ContainerLayout = "boxed" | "full-width";

export type ContainerDirection = "row" | "column";

/**
 * CSS `justify-content` karşılıkları — HAM CSS DEĞERİ SAKLANMAZ (`"flex-start"` gibi),
 * Tailwind sınıf son eki saklanır. Gerekçe: depolanan değer asla doğrudan CSS'e
 * enterpole edilmez (§5.3), sabit bir sınıf tablosundan geçer.
 */
export type ContainerJustify = "start" | "center" | "end" | "between" | "around" | "evenly";

/** CSS `align-items` karşılıkları — aynı gerekçe. */
export type ContainerAlign = "stretch" | "start" | "center" | "end";

export type ContainerLengthUnit = "px" | "vh";

/** Sayısal, birimi enum — serbest CSS string'i DEĞİL (§5.3). */
export interface ContainerLength {
  value: number;
  unit: ContainerLengthUnit;
}

/** Dört kenar, **piksel** cinsinden tam sayı. */
export interface ContainerSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ContainerBackgroundPosition = "center" | "top" | "bottom" | "left" | "right";
export type ContainerBackgroundSize = "cover" | "contain" | "auto";
export type ContainerBackgroundRepeat = "no-repeat" | "repeat";

/**
 * Ayrık birlik (discriminated union) — `{ type: "color", value }` ile
 * `{ type: "image", value }` aynı `value` alanını PAYLAŞMAZ; şema seviyesinde
 * farklı doğrulama kuralları uygulanır (hex regex vs. güvenli-URL kontrolü).
 */
export type ContainerBackground =
  | { type: "none" }
  | { type: "color"; value: string }
  | {
      type: "image";
      value: string;
      position: ContainerBackgroundPosition;
      size: ContainerBackgroundSize;
      repeat: ContainerBackgroundRepeat;
    };

export interface ContainerSettings {
  /** `boxed` → ortalanmış + `maxWidth`; `full-width` → `w-full`. */
  layout: ContainerLayout;
  /** YALNIZCA `layout: "boxed"` iken anlamlı. Verilmezse `DEFAULT_CONTAINER_MAX_WIDTH` (1170). */
  customWidth?: number;
  minHeight?: ContainerLength;

  direction: ContainerDirection;
  justifyContent: ContainerJustify;
  alignItems: ContainerAlign;
  /** Piksel. `gap-*` Tailwind sınıfı DEĞİL — dinamik değer, inline style. */
  gap: number;

  padding: ContainerSpacing;
  margin: ContainerSpacing;
  background: ContainerBackground;

  /**
   * Bu konteynerin, `direction: "row"` olan EBEVEYNİ içindeki göreli genişlik ağırlığı.
   * CSS: `flex: <widthFr> 1 0%` (yani `flex-grow`). v2'deki `PageColumn.width` (`fr`)
   * ile SAYISAL OLARAK BİREBİR AYNI anlam — `1fr 2fr` ≡ `flex-grow: 1` + `flex-grow: 2`.
   * Ebeveyn `direction: "column"` ise veya düğüm kökteyse YOK SAYILIR.
   * `customWidth` ile KARIŞTIRILMAMALI: o, konteynerin KENDİ dış max-width'i (px).
   */
  widthFr?: number;
}

export interface ContainerNode extends BaseNode {
  type: "container";
  settings: ContainerSettings;
  children: PageNode[];
}

/** Ağaçtaki herhangi bir düğüm. `Page.blocks` = `PageNode[]` (kök dizi = örtük konteyner). */
export type PageNode = ContainerNode | ContentBlock;

/** @deprecated v2 adı — yeni kodda `PageNode`. */
export type Block = PageNode;

// ============================================================================
// 3) LEGACY OKUMA TİPLERİ — YALNIZCA `normalize.ts` kullanır, başka hiçbir yer DEĞİL
// ============================================================================

export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

/** @deprecated v1/v2 şekli — sadece `normalizePageNodes` girdisi olarak tanınır. */
export interface LegacyPageColumn {
  id: string;
  width?: number;
  blocks: unknown[];
}

/** @deprecated v1/v2 şekli. `data.columnCount`/`data.ratio` v1 kalıntılarıdır. */
export interface LegacyColumnsBlock {
  id: string;
  type: "columns";
  data: {
    gap?: PageBlockGap;
    verticalAlign?: PageColumnVerticalAlign;
    columns?: LegacyPageColumn[];
    columnCount?: number;
    ratio?: string;
  };
}

// ============================================================================
// 4) dnd-kit SÖZLEŞMESİ
// ============================================================================

/**
 * Konteyner kimliği sözleşmesi v3: kök liste `"root"`, her konteyner
 * `"container:<node.id>"`. v2'nin `"col:<column.id>"` biçimi KALDIRILDI
 * (sütun artık ayrı bir varlık değil, sıradan bir `container`).
 */
export type BuilderContainerId = "root" | `container:${string}`;

// ============================================================================
// 5) SINIRLAR (backend `pages.schemas.ts` ile SAYISAL OLARAK AYNI OLMAK ZORUNDA)
// ============================================================================

/** Kök = 1. Bir konteyner en fazla 4. seviyede olabilir → yaprak bloklar en fazla 5. seviyede. */
export const MAX_CONTAINER_DEPTH = 4;
/** Bir konteynerin doğrudan çocuk sayısı (v2'nin 20 ve 24'ünün birleşimi — §4.3). */
export const MAX_CHILDREN_PER_CONTAINER = 24;
/** Sayfa başına TOPLAM düğüm (konteynerler DAHİL) — v2'nin 200'ünden yükseltildi (§4.3). */
export const MAX_TOTAL_PAGE_NODES = 300;
/** Bu eşiğin üzerinde `direction: "row"` konteynerde okunabilirlik UYARISI (engelleyici DEĞİL). */
export const ROW_CHILDREN_READABILITY_WARNING_THRESHOLD = 6;
/** `layout: "boxed"` varsayılan max-width (px) — inline style, Tailwind sınıfı değil. */
export const DEFAULT_CONTAINER_MAX_WIDTH = 1170;
export const MIN_CONTAINER_MAX_WIDTH = 320;
export const MAX_CONTAINER_MAX_WIDTH = 1920;
/** Galeri bloğu başına en fazla görsel — DEĞİŞMEDİ. */
export const GALLERY_MAX_IMAGES = 30;

/** @deprecated v2 adları — geçiş süresince alias, sonra silinir. */
export const MAX_BLOCKS_PER_COLUMN = MAX_CHILDREN_PER_CONTAINER;
export const MAX_COLUMNS_PER_ROW = MAX_CHILDREN_PER_CONTAINER;
export const MAX_TOTAL_BLOCKS = MAX_TOTAL_PAGE_NODES;
export const COLUMN_READABILITY_WARNING_THRESHOLD = ROW_CHILDREN_READABILITY_WARNING_THRESHOLD;
```

### 3.1 Varsayılan `ContainerSettings` (tek kaynak — `presets.ts`)

```ts
export const DEFAULT_CONTAINER_SETTINGS: ContainerSettings = {
  layout: "boxed",
  direction: "column",
  justifyContent: "start",
  alignItems: "stretch",
  gap: 16,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: "none" },
};
```

Bu nesne **backend'in zod `.default()` değerleriyle birebir aynı** olmak zorundadır; aksi halde "editörde gördüğüm ≠ kaydedilen" (WYSIWYG yalanı) oluşur. code-quality-agent PR checklist'ine bu eşleşme kontrolü eklenir.

### 3.2 `widthFr` neden `settings` içinde, düğüm seviyesinde değil?

v2'de `width` `PageColumn`'un kendi alanıydı (`{ id, width, blocks }`). v3'te sütun diye ayrı bir varlık yok — sütun sıradan bir `container`. Alanı `settings`'e koymak: (a) tek bir `settings` panelinin tüm görsel kontrolleri barındırmasını sağlar, (b) `PageNode` tipini `container`/`content` arasında asimetrik yapmaz, (c) ileride `flexShrink`/`order` gibi kardeş-bağlamlı alanlar eklenirse doğal yeri orasıdır.

### 3.3 `data` vs `settings` ayrımı (bilinçli)

İçerik blokları `data` taşır (içerik), konteynerler `settings` taşır (sunum). Bir konteynerin `data`'sı, bir içerik bloğunun `settings`'i **YOKTUR**. Bu ayrım sayesinde `sanitize-blocks.ts` gibi tüketiciler "`data.html` var mı" sorusunu konteynerler için hiç sormaz ve `settings` alanı sanitize kapsamının dışında (ama şema kapsamının içinde) kalır.

### 3.4 `hero` yasağının kaldırılması (v2 kararının geçersiz kılınması)

§10.17.3'teki gerekçe aynen şuydu: *"`hero` de konulamaz (tam-genişlik banner'dır, dar bir sütunda anlamsızdır)"*. Bu gerekçe **v2'de doğruydu**, çünkü v2'de konteynerin genişliği üzerinde hiçbir kontrol yoktu — bir `columns` her zaman `max-w-5xl` bir kuyunun içindeydi.

v3'te `settings.layout: "full-width"` + `minHeight` + `background` tam olarak "hero" davranışını **konteyner seviyesinde** sağlar; dahası kullanıcı bir hero'yu tam-genişlik bir konteynere koyup yanına ikinci bir kolon ekleyebilmelidir (Elementor'un en yaygın kullanım kalıbı). Yasağı sürdürmek artık **keyfi** olurdu.

**Sonuç:** `PAGE_COLUMNS_LEAF_FORBIDDEN_TYPES` seti tamamen **KALDIRILIR**. Yerine geçen tek yapısal kısıt `MAX_CONTAINER_DEPTH`'tir. `hero`'nun bir konteyner içindeyken kendi iç `px-4 py-16` gutter'ını bırakması gereği → §6.3 (chrome sözleşmesi).

---

## 4. Karar 3 — DoS / güvenlik sınırlarının nested modelde korunması

### 4.1 Yeni tehdit yüzeyi (v2'de YOKTU)

v2'de derinlik şema seviyesinde ≤1 idi; bu yüzden `flattenPageBlocks`, `sanitizePageBlocks`, `sanitizePageTranslations` özyinelemelerinin **hepsi pratikte tek seviye** iniyordu. v3 keyfi derinliğe izin verdiği anda:

1. **Zod'un kendi parse'ı bir DoS vektörü olur.** `z.lazy` ile yazılmış özyinelemeli bir şema, 5.000 seviye derinlikte bir payload'da **doğrulama tamamlanmadan** `RangeError: Maximum call stack size exceeded` fırlatır. Yani "derinlik ≤ 4" kuralını zod içinde `.superRefine` ile yazmak **çok geç** kalır — sınır kontrolü, özyinelemeli parse **başlamadan önce** yapılmalıdır.
2. `flattenPageBlocks` bugün **özyinelemeli** yazılmıştır ve `refineTotalBlockCount` içinden **ham (henüz doğrulanmamış) `blocks` dizisi** üzerinde çağrılır. Bu, aynı call-stack DoS'unun ikinci girişidir.
3. `sanitizePageBlocks` de özyinelemelidir ve `pages.routes.ts:619`'da **revision snapshot'ı** üzerinde çağrılır — bu veri yeni şemadan hiç geçmez.
4. Fastify global `bodyLimit`'i bu projede **~5 MB**'a ayarlıdır (`app.ts:126`, `MAX_UPLOAD_BYTES + 64 KB`). Yani `blocks` için tek başına yeterli bir tavan DEĞİLDİR — 5 MB'lık bir gövdeye on binlerce düğüm sığar.

### 4.2 Bağlayıcı savunma sırası (backend-agent bu SIRAYA uymak zorunda)

```
1. Fastify bodyLimit (~5 MB, mevcut)
        ↓
2. MAX_PAGE_BLOCKS_BYTES = 256 KB       ← YENİ, byte tavanı (JSON.stringify)
        ↓
3. scanPageNodeStructure(raw)           ← YENİ, İTERATİF (explicit stack, ÖZYİNELEME YOK)
   → maxDepth, totalNodes, maxFanOut ölçülür; ihlal varsa BURADA 422
        ↓
4. z.lazy(...) özyinelemeli parse        ← ancak şimdi güvenli
        ↓
5. sanitizePageBlocks (özyinelemeli, ama artık derinlik ≤ 4 garantili
   + savunma amaçlı sabit bir depth cutoff taşır)
```

Adım 3 ve `flattenPageBlocks` **iteratif** (kendi `stack`/`while` döngüsü) yazılır. Bu, "derinlik sınırı var" demenin kendi kendini baltalamasını önler. Ayrıca döngüye mutlak bir tavan (`guard > 100_000 → break`) konur (patolojik/döngüsel referans içeren elle üretilmiş JSON'a karşı).

### 4.3 Sayısal sınırlar ve **neden değiştikleri**

| Sabit | v2 | v3 | Gerekçe |
|---|---|---|---|
| Derinlik | 1 (sabit) | `MAX_CONTAINER_DEPTH = 4` | Elementor'un pratik tavanı (Section > Row > Column > Inner-row) tam 4'tür. 4 seviyede özyineleme derinliği ~5 frame — call-stack açısından ihmal edilebilir; buna rağmen **sınırsız değil**, yani okunabilirlik ve editör performansı korunur. |
| Konteyner başına çocuk | 20 (sütun içi blok) / 24 (satır içi sütun) | **24 (tek sabit)** | v3'te "sütun içi blok" ile "satırdaki sütun" **aynı ilişkidir** (`container.children`). İki sayıyı **büyük olanda** birleştirmek, hâlihazırda geçerli olan HİÇBİR belgeyi geçersiz kılmaz (20→24 gevşeme, 24→24 aynı). Küçük olanda birleştirmek 21-24 sütunlu bir sayfayı sessizce 422'ye düşürürdü. |
| Toplam düğüm | 200 | **300** | v3'te konteynerler de sayılır ve bir legacy `columns` düğümü normalize edilince **1 + N (sütun sarmalayıcı) + M** düğüme dönüşür. 200'de kalmak, sınıra yakın **mevcut** bir sayfanın ilk kaydında sebepsiz 422 almasına yol açardı. 300 düğüm + 256 KB tavanı DoS açısından fazlasıyla güvenli. |
| Gövde boyutu | (yok) | **256 KB** | §10.16.4'te e-posta blokları için zaten uygulanan desen (`EMAIL_BLOCKS_MAX_BYTES`). `blocks`'un asıl büyüme riski derinlik değil **genişlik**tir; byte tavanı bunu doğrudan kapatır. |
| Okunabilirlik uyarısı | 6 sütun | 6 (`direction: "row"` konteynerlerde) | Değişmedi, engelleyici değil. |

### 4.4 `translations.<LOCALE>.blocks` için AYNI kurallar

§10.17'nin security-agent denetiminde bulunan boşluk (`translations` yolunun şemadan geçmemesi) v3'te **kesinlikle tekrarlanmamalıdır**. `TranslationsSchema.superRefine` içindeki her `locale` için:
byte tavanı → `scanPageNodeStructure` → `z.array(PageNodeSchema)` → toplam düğüm kontrolü, **hepsi** uygulanır. Bu, §9'daki mevcut kodun genişletilmiş halidir, yeni bir desen değil.

---

## 5. Kesin Zod şeması

> **Hedef dosya:** `backend/src/modules/pages/pages.schemas.ts`
> **Sahibi:** backend-agent. Sayısal sabitler `frontend/src/lib/page-builder/types.ts` ile **birebir** aynı olmak zorundadır.
> zod sürümü: `^3.23.8` (mevcut). Aşağıdaki API'ler v3 içindir.

### 5.1 Yardımcı: iteratif yapı tarayıcısı

> **Hedef dosya:** `backend/src/lib/page-blocks.ts` (mevcut dosya genişletilir)

```ts
export const MAX_CONTAINER_DEPTH = 4;
export const MAX_CHILDREN_PER_CONTAINER = 24;
export const MAX_TOTAL_PAGE_NODES = 300;
/** Patolojik/elle üretilmiş girdide `while` döngüsünün mutlak tavanı. */
const ABSOLUTE_VISIT_CAP = 100_000;

export interface PageNodeStructureReport {
  totalNodes: number;
  maxContainerDepth: number;
  maxChildren: number;
  truncated: boolean;
}

/**
 * Bir düğümün ÇOCUKLARINI döner — hem kanonik (`container.children`) hem legacy
 * (`columns` → `data.columns[].blocks`) şekli tanır. Legacy'de her SÜTUN, normalize
 * sonrası bir konteynere dönüşeceği için burada da AYRI BİR DÜĞÜM olarak sayılır
 * (ölçüm, normalize SONRASI ağacı yansıtmalıdır — aksi halde 300 tavanı yanıltıcı olur).
 */
function childrenOfRawNode(node: unknown): unknown[] { /* container.children | columns sütunları */ }

/**
 * İTERATİF (explicit stack) — ÖZYİNELEME YOK. Bu fonksiyon, zod'un `z.lazy` özyinelemeli
 * parse'ından ÖNCE çağrılmak ZORUNDADIR: derinlik sınırını zod içinde kontrol etmek,
 * kontrolü yapan parse'ın kendisi stack'i taşırdığı için ÇOK GEÇTİR (bkz. tasarım notu §4.1).
 */
export function scanPageNodeStructure(raw: unknown[]): PageNodeStructureReport {
  let totalNodes = 0;
  let maxContainerDepth = 0;
  let maxChildren = 0;
  let visits = 0;

  const stack: { node: unknown; depth: number }[] = raw.map((node) => ({ node, depth: 1 }));
  maxChildren = raw.length;

  while (stack.length > 0) {
    if (++visits > ABSOLUTE_VISIT_CAP) return { totalNodes, maxContainerDepth, maxChildren, truncated: true };

    const { node, depth } = stack.pop()!;
    totalNodes += 1;

    const isContainer =
      !!node && typeof node === "object" &&
      ((node as Record<string, unknown>).type === "container" || (node as Record<string, unknown>).type === "columns");

    if (isContainer && depth > maxContainerDepth) maxContainerDepth = depth;
    // Sınırı AŞTIYSA daha derine İNMEYİZ: ihlal zaten raporlanacak, gereksiz iş yapmayız.
    if (depth > MAX_CONTAINER_DEPTH) continue;

    const children = childrenOfRawNode(node);
    if (children.length > maxChildren) maxChildren = children.length;
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }

  return { totalNodes, maxContainerDepth, maxChildren, truncated: false };
}

/**
 * Mevcut `flattenPageBlocks` — İMZASI DEĞİŞMEZ (seo-score.ts tüketicisi korunur),
 * ancak GÖVDESİ ÖZYİNELEMEDEN İTERATİF hale getirilir ve `container.children`'ı da
 * dolaşır. Doküman sırası (soldan sağa / yukarıdan aşağıya) KORUNUR.
 */
export function flattenPageBlocks(blocks: unknown[]): unknown[] { /* iteratif */ }
```

### 5.2 Ayar (settings) şemaları

```ts
import { z } from "zod";

const ContainerSpacingSchema = z
  .object({
    top: z.number().int().min(0).max(200).default(0),
    right: z.number().int().min(0).max(200).default(0),
    bottom: z.number().int().min(0).max(200).default(0),
    left: z.number().int().min(0).max(200).default(0),
  })
  .default({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * NEGATİF margin v1'de KASITLI OLARAK yasak (0..200). Elementor negatif margin'e izin verir
 * ama bu, admin editöründe bir bloğun kendi ebeveyninin dışına taşıp KOMŞU KONTROLLERİ
 * ÖRTMESİNE (tıklama hırsızlığına benzer bir editör-içi UX tuzağı) yol açar. İhtiyaç
 * doğarsa ayrı bir turda, security-agent onayıyla açılır.
 */

const ContainerLengthSchema = z.object({
  value: z.number().min(0).max(5000),
  unit: z.enum(["px", "vh"]).default("px"),
});

/** `#rgb` | `#rrggbb` | `#rrggbbaa` — başka hiçbir CSS renk sözdizimi KABUL EDİLMEZ. */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Arka plan görseli URL'i `url("…")` içine enterpole EDİLECEĞİ için, CSS bağlamından
 * kaçış yapabilecek her karakter YASAKLANIR. `image` blok tipindeki `data.url` gibi
 * relative/absolute serbestliği KORUNUR, yalnızca bu karakterler engellenir.
 */
const CSS_URL_UNSAFE_RE = /["'()\\;{}<>\s]/;

const ContainerBackgroundSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("color"), value: z.string().regex(HEX_COLOR_RE, "Geçersiz renk değeri.") }),
    z.object({
      type: z.literal("image"),
      value: z
        .string()
        .min(1)
        .max(2048)
        .refine((v) => !CSS_URL_UNSAFE_RE.test(v), "Arka plan görseli URL'i güvensiz karakter içeriyor."),
      position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
      size: z.enum(["cover", "contain", "auto"]).default("cover"),
      repeat: z.enum(["no-repeat", "repeat"]).default("no-repeat"),
    }),
  ])
  .default({ type: "none" });

const ContainerSettingsSchema = z
  .object({
    layout: z.enum(["boxed", "full-width"]).default("boxed"),
    customWidth: z.number().int().min(320).max(1920).optional(),
    minHeight: ContainerLengthSchema.optional(),

    direction: z.enum(["row", "column"]).default("column"),
    justifyContent: z.enum(["start", "center", "end", "between", "around", "evenly"]).default("start"),
    alignItems: z.enum(["stretch", "start", "center", "end"]).default("stretch"),
    gap: z.number().int().min(0).max(128).default(16),

    padding: ContainerSpacingSchema,
    margin: ContainerSpacingSchema,
    background: ContainerBackgroundSchema,

    widthFr: z.number().positive().max(12).optional(),
  })
  // Bilinmeyen anahtarlar SESSİZCE DÜŞÜRÜLÜR (zod varsayılanı `strip`). `.passthrough()`
  // KULLANILMAZ: `settings` doğrudan inline style'a beslendiği için bilinmeyen alanın
  // taşınması, ileride bir render hatası/enjeksiyon yüzeyi açar.
  .default({});
```

### 5.3 `minHeight: string` reddi (kullanıcı isteğinin mimar tarafından değiştirilmesi)

İstek metni `minHeight?: string` diyordu. **REDDEDİLDİ.** Gerekçe:

`settings` alanının tamamı, render motorunda **inline `style` nesnesine** beslenir (dinamik px değerleri Tailwind'in derleme-zamanı JIT taramasıyla ifade edilemez — bu, §10.17.5'te `gridTemplateColumns` için zaten verilmiş bir karardır). Serbest bir string, `style={{ minHeight: value }}` üzerinden CSS bağlamına girer. React `style` nesnesi `expression(...)`/`url(javascript:...)` gibi klasik vektörleri kendi başına engellemez ve daha önemlisi: `sanitizePageBlocks` **yalnızca `data.html`'i** temizler, `settings`'e HİÇ bakmaz. Yani serbest string, sanitize kapsamının tamamen dışında kalan bir CSS enjeksiyon yüzeyi olurdu.

`{ value: number; unit: "px" | "vh" }` ile:
- Değer sayısal, birim kapalı bir enumdan → enjeksiyon **yapısal olarak imkânsız**,
- Editör UI'ı (slider + birim seçici) doğrudan bu şekle oturur,
- İleride `rem`/`svh` eklemek geriye dönük uyumlu (enum genişletme).

Aynı ilke `gap`, `padding`, `margin`, `customWidth` için de geçerlidir: **hiçbiri string değildir.** `background.value` string olmak zorundadır (renk/URL) — bu yüzden ikisi de dar regex/refine ile kilitlenmiştir.

### 5.4 Özyinelemeli düğüm şeması + legacy dönüşüm

```ts
/* ---------- legacy `columns` → kanonik `container` ---------- */

const LEGACY_GAP_PX: Record<string, number> = { none: 0, sm: 8, md: 16, lg: 32 };
const LEGACY_ALIGN: Record<string, "start" | "center" | "end"> = { top: "start", center: "center", bottom: "end" };
/** v1 `ratio` → per-column ağırlık (v2'deki `legacyRatioToWidths` AYNEN korunur). */
function legacyRatioToWidths(ratio: unknown, count: number): number[] {
  if (ratio === "2-1") return [2, 1];
  if (ratio === "1-2") return [1, 2];
  return Array.from({ length: count }, () => 1);
}

/**
 * v1/v2 `columns` bloğunu, GÖRSEL OLARAK EŞDEĞER bir konteyner ağacına çevirir.
 *
 * Geometrik parite (bkz. components/site/blocks/columns-block.tsx):
 *   dış sarmalayıcı  `mx-auto max-w-5xl px-4 py-4 sm:px-6`
 *   → layout: "boxed", customWidth: 1024 (= max-w-5xl), padding: { top: 16, bottom: 16 }
 *     (yatay `px-4 sm:px-6` gutter'ı `boxed` modunun YAPISAL gutter'ıdır, `padding`'e
 *      YAZILMAZ — bkz. tasarım notu §6.2)
 *   `gap` token'ı → px (0/8/16/32, mevcut GAP_CLASS ile birebir)
 *   `verticalAlign` → alignItems
 *   her sütun → `direction: "column"`, `widthFr` taşıyan bir alt konteyner
 */
function legacyColumnsToContainer(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const node = raw as Record<string, unknown>;
  const data = (node.data && typeof node.data === "object" ? node.data : {}) as Record<string, unknown>;
  const rawColumns = Array.isArray(data.columns) ? data.columns : [];
  const widths = legacyRatioToWidths(data.ratio, rawColumns.length);
  const gapPx = LEGACY_GAP_PX[String(data.gap)] ?? 16;

  const zero = { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    id: node.id,
    type: "container",
    settings: {
      layout: "boxed",
      customWidth: 1024,
      direction: "row",
      justifyContent: "start",
      alignItems: LEGACY_ALIGN[String(data.verticalAlign)] ?? "start",
      gap: gapPx,
      padding: { top: 16, right: 0, bottom: 16, left: 0 },
      margin: zero,
      background: { type: "none" },
    },
    children: rawColumns.map((column, index) => {
      const col = (column && typeof column === "object" ? column : {}) as Record<string, unknown>;
      return {
        id: col.id,
        type: "container",
        settings: {
          layout: "full-width",
          direction: "column",
          justifyContent: "start",
          alignItems: "stretch",
          gap: gapPx,
          padding: zero,
          margin: zero,
          background: { type: "none" },
          widthFr: typeof col.width === "number" && col.width > 0 ? col.width : (widths[index] ?? 1),
        },
        children: Array.isArray(col.blocks) ? col.blocks : [],
      };
    }),
  };
}

/* ---------- galeri (v2'den DEĞİŞMEDEN devralınır) ---------- */

const GALLERY_MAX_IMAGES = 30;
const GalleryBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("gallery"),
  data: z.object({
    images: z.array(z.object({ url: z.string().min(1), alt: z.string() })).max(GALLERY_MAX_IMAGES),
    layout: z.enum(["grid", "carousel", "masonry"]).default("grid"),
  }),
});

/* ---------- özyinelemeli düğüm ---------- */

function applySubSchema(schema: z.ZodTypeAny, node: unknown, ctx: z.RefinementCtx): unknown {
  const parsed = schema.safeParse(node);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue(issue);
    return node;
  }
  return parsed.data;
}

/**
 * v2'deki `.transform()` deseninin AYNISI (yalnızca doğrulamak yetmez — NORMALLEŞTİRİLMİŞ
 * çıktı DB'ye yazılmalıdır, aksi halde geriye dönük uyumluluk göstermelik kalır).
 *
 * `type` bilinmiyorsa blok SERBEST bırakılır (`z.record(z.unknown())`) — v2'deki
 * "minimum diff" kararı KORUNUR; yalnızca `container`/`columns`/`gallery` dar şemaya girer.
 *
 * ÖZYİNELEME GÜVENLİĞİ: bu şema `ContainerNodeSchema` üzerinden kendini çağırır. Derinlik
 * sınırı BURADA DEĞİL, `PageBlockListSchema` içindeki İTERATİF ön-taramada uygulanır
 * (bkz. tasarım notu §4.1/§4.2) — buraya ulaşan veri zaten derinlik ≤ 4 garantilidir.
 */
const PageNodeSchema: z.ZodType<unknown, z.ZodTypeDef, unknown> = z
  .record(z.unknown())
  .transform((node, ctx) => {
    const type = (node as Record<string, unknown>).type;
    if (type === "container") return applySubSchema(ContainerNodeSchema, node, ctx);
    if (type === "columns") return applySubSchema(LegacyColumnsNodeSchema, node, ctx);
    if (type === "gallery") return applySubSchema(GalleryBlockSchema, node, ctx);
    return node;
  });

const ContainerNodeSchema: z.ZodTypeAny = z.object({
  id: z.string().min(1),
  type: z.literal("container"),
  settings: ContainerSettingsSchema,
  children: z.array(PageNodeSchema).max(MAX_CHILDREN_PER_CONTAINER).default([]),
});

const LegacyColumnsNodeSchema: z.ZodTypeAny = z.preprocess(legacyColumnsToContainer, ContainerNodeSchema);
```

> **Not (TDZ):** `PageNodeSchema`'nın gövdesindeki `ContainerNodeSchema`/`LegacyColumnsNodeSchema` referansları **`.transform()` geri çağrısının içindedir** — modül yüklenirken değil, parse anında çözülürler. Bu yüzden `z.lazy()` sarmalayıcısına gerek YOKTUR ve `const` bildirim sırası (önce `PageNodeSchema`, sonra `ContainerNodeSchema`) sorun çıkarmaz. `ContainerNodeSchema.children` içindeki `z.array(PageNodeSchema)` ise modül yüklenirken çözülür ve `PageNodeSchema` o noktada zaten tanımlıdır.

### 5.5 Liste seviyesi: byte tavanı + iteratif ön-tarama + toplam sayım

```ts
const MAX_PAGE_BLOCKS_BYTES = 256 * 1024;

/**
 * `blocks` alanı için TEK giriş noktası. SIRA ÖNEMLİDİR:
 *   byte tavanı → iteratif yapı taraması → özyinelemeli parse.
 * Bu sıra bozulursa (örn. parse önce çalışırsa) derinlik sınırının kendisi bir
 * stack-overflow DoS'una dönüşür (bkz. tasarım notu §4.1).
 */
export const PageBlockListSchema = z
  .array(z.unknown())
  .superRefine((blocks, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(blocks), "utf8");
    if (bytes > MAX_PAGE_BLOCKS_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `blocks gövdesi en fazla ${MAX_PAGE_BLOCKS_BYTES / 1024} KB olabilir.`,
      });
      return z.NEVER;
    }

    const report = scanPageNodeStructure(blocks);
    if (report.truncated) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "İçerik yapısı işlenemeyecek kadar karmaşık." });
      return z.NEVER;
    }
    if (report.maxContainerDepth > MAX_CONTAINER_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Konteyner iç içe geçme derinliği en fazla ${MAX_CONTAINER_DEPTH} olabilir.`,
      });
      return z.NEVER;
    }
    if (report.maxChildren > MAX_CHILDREN_PER_CONTAINER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Bir konteyner en fazla ${MAX_CHILDREN_PER_CONTAINER} öğe içerebilir.`,
      });
      return z.NEVER;
    }
    if (report.totalNodes > MAX_TOTAL_PAGE_NODES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sayfa başına toplam öğe sayısı (iç içe dahil) en fazla ${MAX_TOTAL_PAGE_NODES} olabilir.`,
      });
      return z.NEVER;
    }
  })
  .pipe(z.array(PageNodeSchema));
```

`CreatePageRequestSchema` / `UpdatePageRequestSchema` / `AutosavePageRequestSchema` içindeki
`blocks: z.array(BlockSchema).optional()` → **`blocks: PageBlockListSchema.optional()`** olur.
`refineTotalBlockCount` + `TOTAL_BLOCK_COUNT_REFINEMENT` **kaldırılır** (kontrol artık `PageBlockListSchema` içinde, doğru sırada).

`TranslationsSchema.superRefine` içindeki `z.array(BlockSchema).safeParse(fields.blocks)` →
**`PageBlockListSchema.safeParse(fields.blocks)`**; hata yolları bugünkü gibi `["translations", locale, "blocks", ...issue.path]` altına taşınır.

### 5.6 `sanitize-blocks.ts` değişikliği (STORED XSS — kritik)

`sanitizeSinglePageBlock` bugün `b.type === "columns"` dalında `data.columns[].blocks`'a iniyor. **`container.children` dalı EKLENMEZSE**, konteyner içine konan her `text` bloğu `sanitizeRichHtml`'i atlar → §10.17.4'te bulunan **aynı stored XSS yeniden açılır**. Bu, bu turun **en kolay ve en sessiz hatasıdır**.

```ts
if (b.type === "container") {
  if (!Array.isArray(b.children)) return block;
  return { ...b, children: sanitizePageBlocks(b.children as unknown[], depth + 1) };
}
if (b.type === "columns") { /* MEVCUT legacy dal AYNEN KALIR — snapshot'lar hâlâ bu şekilde */ }
```

Ek olarak `sanitizePageBlocks` bir `depth` parametresi alır ve `depth > MAX_CONTAINER_DEPTH + 2` olduğunda daha derine inmez. Gerekçe: bu fonksiyon `pages.routes.ts:619`'da **revision snapshot'ı** üzerinde de çağrılır ve o veri yeni şemadan hiç geçmez.

---

## 6. Render motoru kontratı

### 6.1 Flexbox kararı (CSS Grid DEĞİL)

v2 `display: grid` + `gridTemplateColumns: "1fr 2fr"` kullanıyordu. v3 **flexbox** kullanır:

- İstenen ayarların tamamı (`direction`, `justifyContent`, `alignItems`, `gap`) **flexbox semantiğidir**. Grid'de `justify-content` farklı anlama gelir; ikisini karıştırmak WYSIWYG'i bozar.
- `widthFr` → `flex: <n> 1 0%`. Bu, `<n>fr` ile **matematiksel olarak aynı** sonucu verir (eşit `flex-basis: 0` + orantılı `flex-grow`). Yani **v2'de kaydedilmiş her oran piksel-piksel korunur.**
- Grid'de `direction: "column"` için ayrı bir `gridTemplateRows` mantığı gerekirdi; flex'te tek bir `flexDirection` yeter.
- İç içe geçmede flex, grid'e göre çok daha öngörülebilir (grid track'leri iç içe geçince hizalanmaz).

### 6.2 Sınıf/inline-style bölüşümü (frontend-agent için bağlayıcı)

**Statik değerler → Tailwind sınıfı** (JIT taranabilir sabit tablolar):

```
layout:  boxed      → "mx-auto w-full px-4 sm:px-6"      (+ inline maxWidth)
         full-width → "w-full"
direction: row      → "flex flex-col md:flex-row"
           column   → "flex flex-col"
justifyContent      → justify-start | justify-center | justify-end
                      | justify-between | justify-around | justify-evenly
alignItems          → items-stretch | items-start | items-center | items-end
```

**Dinamik değerler → inline `style`** (Tailwind arbitrary class KULLANILAMAZ — derleme-zamanı statik tarama dinamik `N` için çalışmaz; §10.17.5'te `gridTemplateColumns` için verilmiş kararla aynı):

```
maxWidth      = layout === "boxed" ? (customWidth ?? 1170) : undefined
minHeight     = minHeight ? `${minHeight.value}${minHeight.unit}` : undefined
gap           = `${gap}px`
padding       = `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`
margin        = aynı
flex          = widthFr ? `${widthFr} 1 0%` : undefined
background    = type "color" → backgroundColor: value
                type "image" → backgroundImage: `url("${value}")`
                               + backgroundPosition/Size/Repeat (enum → sabit string)
```

**Mobil davranış:** `direction: "row"` daima `flex-col md:flex-row`'a çevrilir — mobilde (`md` = 768px altı) her satır otomatik yığılır. `stackOnMobile` gibi bir veri alanı **EKLENMEZ** (§10.17.3'ün kararı aynen geçerli). Mobilde `flex-col` aktifken `widthFr`'nin ürettiği `flex-grow` etkisiz kalır (ana eksen dikey), ek bir kod gerekmez.

**Kapsam dışı (bilinçli ertelendi, v4 adayı):** cihaz-bazlı (responsive) ayar setleri — Elementor'un "Desktop/Tablet/Mobile" sekmeleri. v3'te tek bir ayar seti tüm kırılma noktalarında geçerlidir; tek istisna yukarıdaki `row` yığılmasıdır. Bunun bilinen sonucu: `padding.top: 120` gibi büyük bir değer mobilde de 120px kalır. ui-designer bunu **oransal/`clamp()` tabanlı bir ölçekleme** ile hafifletmeyi önerebilir; bu, render motoru detayı olarak ui-designer + frontend-agent'a bırakılmıştır, **veri modeli değişmez**.

### 6.3 "Chrome" sözleşmesi — yaprak blokların kendi gutter'ı (gözden kaçırılması KOLAY)

Mevcut yaprak görünümleri kendi dış boşluklarını taşıyor:
`text-block` → `prose mx-auto max-w-3xl px-4 py-8 sm:px-6`, `hero-block` / `cta-block` → `px-4 py-16 sm:px-6`, `gallery-block` → `px-4 py-8 sm:px-6`.

Bir konteynerin içindeyken bu gutter'lar **konteynerin kendi `padding`/`gap`'iyle üst üste biner** (bugün `columns` içinde de bu sorun var). Kontrat:

```ts
export type BlockChrome = "page" | "bare";
// BlockRenderer({ nodes, chrome })
```

- Kök dizideki yaprak bloklar → `chrome: "page"` → **bugünkü davranış birebir korunur** (regresyon yok).
- Bir `container`'ın içindeki yaprak bloklar → `chrome: "bare"` → kendi `mx-auto max-w-*` ve yatay/dikey gutter'larını **bırakır**; boşluk artık konteynerin `padding` + `gap`'inden gelir.

**Bilinçli ve dokümante edilmiş görsel sapma:** bugün bir `columns` sütununun içindeki `text` bloğu `px-4 py-8` taşıyor; v3'te bu boşluk konteynerden gelecek (legacy normalizasyonda sütun konteynerlerinin `gap`'i satırın gap'inden devralınır). Yani **mevcut çok-sütunlu sayfalarda birkaç piksellik dikey boşluk farkı oluşabilir.** Satır/sütun geometrisi (genişlik oranları, hizalama, dış kuyu) **piksel-piksel korunur**; sapma yalnızca sütun-içi blokların kendi iç dolgusundadır. Bu, bir hata değil, çift-gutter'ın giderilmesidir. qa-agent bunu görsel karşılaştırma testine alır.

---

## 7. Karar 2 — Geriye dönük uyumluluk / migration stratejisi

### 7.1 Karar: **(b) okuma-anında normalize + yazma-anında dönüşüm. DB migration script'i YOK.**

Soruda geçen (a)/(b)/(c) şıkları için net cevap: **(a) REDDEDİLDİ, (b) SEÇİLDİ** (ve "yazma anında `z.preprocess`" (b)'nin ayrılmaz ikinci katmanıdır — §10.17.8'de kurulan iki katmanlı desenin aynısı, sadece alan-seviyesinden yapı-seviyesine yükseltilmiş hali).

**Neden batch migration script'i yazılmıyor:**

1. `Page.blocks` bir **`Json` kolonu**dur; içindeki şekil DB şemasının parçası değildir. Bir `prisma migrate` bunu **doğrulayamaz**; gereken şey bir **veri backfill job'ı** olurdu (tüm sayfaları oku → dönüştür → yaz).
2. Bu backfill, `translations.<LOCALE>.blocks` ve **`PageRevision` snapshot'larını** da kapsamak zorunda kalırdı. Snapshot'lar tanım gereği **geçmişin fotoğrafıdır** — onları toplu düzenlemek, "geri yükle" özelliğinin verdiği sözü bozar. Yani okuma-anında normalizasyon **her koşulda gereklidir**; backfill onu ORTADAN KALDIRMAZ, sadece üstüne bir risk daha ekler.
3. INFRA.md'nin "additive, backward-compatible" migration felsefesi ve §10.17.8'in bilinçli "lazy/on-write geçiş" kararı bu yönde emsal oluşturuyor.
4. Backfill'in geri alınması (rollback) zordur; lazy geçişin geri alınması **bir deploy**dır.

**Çıkış stratejisi (deferred, tetik koşuluyla birlikte):** `columns` okuma şimi (`normalizePageNodes`'un legacy dalı + backend'in `LegacyColumnsNodeSchema`'sı) **süresiz kalmaz**. Kaldırma koşulu: *"telemetriye/DB sorgusuna göre hiçbir canlı `Page.blocks` ve hiçbir son-N-revizyon `columns` içermiyor"*. O noktada `chore/drop-legacy-columns-shim` branch'iyle şim silinir. Bu, gelecekteki bir turun işidir; **bu turda YAPILMAZ**.

### 7.2 Okuma tarafı: tek merkez `normalizePageNodes`

> **Hedef dosya (YENİ):** `frontend/src/lib/page-builder/normalize.ts`

```ts
/**
 * Ham (GET'ten gelen, re-validate EDİLMEMİŞ) `blocks` JSON'unu kanonik `PageNode[]`'a çevirir.
 * TAM OLARAK İKİ giriş noktasından çağrılır:
 *   1) admin editör sayfayı builder state'ine yüklerken,
 *   2) public render kökünde (`BlockRenderer`'ın çağrıldığı sayfa bileşenleri).
 * Aşağı akıştaki HİÇBİR bileşen legacy şekil görmez — `resolveColumnWidth` gibi
 * dağıtık savunmacı okuma şimlerine v3'te GEREK KALMAZ (o fonksiyon SİLİNİR,
 * mantığı bu dosyanın legacy dalına taşınır).
 */
export function normalizePageNodes(raw: unknown): PageNode[];
```

Kurallar:
- `columns` → `legacyColumnsToContainer` (backend'dekiyle **birebir aynı** eşleme; §5.4'teki tablo bağlayıcıdır).
- Eksik `settings` alanları → `DEFAULT_CONTAINER_SETTINGS`'ten tamamlanır.
- Eksik/geçersiz `id` → deterministik olmayan bir `newId()` **üretilmez** okuma tarafında değil; bunun yerine `index` tabanlı stabil bir fallback (`__n{index}`) kullanılır — aksi halde her render'da yeni key üretilir ve React ağacı gereksiz yere sıfırlanır.
- Tanınmayan `type` → düğüm **korunur ve olduğu gibi geçirilir** (ileri uyumluluk); `BlockRenderer` bilinmeyen tipi sessizce `null` render eder.
- Fonksiyon **iteratiftir veya derinlik sayaçlıdır** (bozuk veriye karşı; backend'deki aynı gerekçe).

`frontend/src/lib/page-builder/columns.ts` **SİLİNİR**; ağaç işlemleri `containers.ts`'e, `resolveColumnWidth` mantığı `normalize.ts`'e taşınır.

### 7.3 Uyumluluk matrisi

| Senaryo | Davranış |
|---|---|
| v1 sayfa (`columnCount`/`ratio`), hiç dokunulmadan görüntülenir | `normalizePageNodes` `ratio → widthFr` çevirir; **görsel oran korunur** |
| v2 sayfa (`width`), hiç dokunulmadan görüntülenir | `width → widthFr` birebir; **piksel parite** |
| v1/v2 sayfa, başka bir alanı düzenlenip kaydedilir | Editör zaten normalize edilmiş ağacı gönderir → DB'ye `container` olarak yazılır |
| Eski bir istemci (ör. cache'lenmiş admin bundle) hâlâ `columns` gönderirse | Backend `LegacyColumnsNodeSchema` ile kabul eder, `container` olarak yazar — **422 vermez** |
| Eski bir `PageRevision` geri yüklenirse | `pages.routes.ts:619` sanitize eder → yazma yolundaki şemadan geçer → `container` olur |
| Public API / headless tüketici | `blocks` **hem** `container` **hem** legacy `columns` içerebilir; openapi'de bu açıkça yazılır |
| `hero` bir konteyner içindeyken | Artık geçerli (§3.4) |

---

## 8. Karar 6 — Palette / `registry.ts` / Layout Picker

### 8.1 §10.17.6 kararının geçersiz kılınması

§10.17.6 aynen şöyle diyordu: *"`lib/page-builder/registry.ts`'e `columns` **EKLENMEZ** — blok paletinde 'Sütun' diye bir öğe yoktur."*

**Bu karar v3'te GEÇERSİZ KILINDI.** Gerekçe: v2'de bir sütun, **içeriği olmadan hiçbir anlam taşımayan saf bir sarmalayıcıydı** — bu yüzden "önce blok, sonra sarmala" akışı doğruydu. v3'te bir konteyner **kendi başına görsel bir varlıktır** (arka plan, min-height, genişlik, dolgu). Boş bir konteyner ekleyip sonra doldurmak, artık **birincil ve doğru** akıştır (istekteki Layout Picker'ın tam olarak istediği şey).

### 8.2 İki ayrı kayıt (registry), tek palette UI'ı

`blockRegistry` **İÇERİK** kaydı olarak kalır ve `container` ORAYA EKLENMEZ:

```ts
// registry.ts — İÇERİK blokları (mevcut haliyle, `PaletteBlockType` = ContentBlockType)
export const blockRegistry: Record<ContentBlockType, { label: string }> = { /* değişmedi */ };
export function createBlock(type: ContentBlockType): ContentBlock { /* değişmedi */ }
```

Ayrı, YENİ bir kayıt eklenir:

```ts
// presets.ts (YENİ)
export type LayoutPresetId =
  | "100" | "50-50" | "33-66" | "66-33" | "33-33-33" | "25-50-25" | "25-25-25-25";

export interface LayoutPreset {
  id: LayoutPresetId;
  label: string;          // TR, kullanıcıya dönük: "Tam Genişlik", "İki Eşit Sütun", …
  /** Alt konteynerlerin `widthFr` ağırlıkları. Uzunluk = oluşacak sütun sayısı. */
  weights: number[];
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: "100",         label: "Tek Sütun",           weights: [1] },
  { id: "50-50",       label: "İki Eşit Sütun",      weights: [1, 1] },
  { id: "33-66",       label: "Dar + Geniş",         weights: [1, 2] },
  { id: "66-33",       label: "Geniş + Dar",         weights: [2, 1] },
  { id: "33-33-33",    label: "Üç Eşit Sütun",       weights: [1, 1, 1] },
  { id: "25-50-25",    label: "Dar + Geniş + Dar",   weights: [1, 2, 1] },
  { id: "25-25-25-25", label: "Dört Eşit Sütun",     weights: [1, 1, 1, 1] },
];

export function createContainerFromPreset(preset: LayoutPreset): ContainerNode;
```

`weights` **ağırlıktır, yüzde değil** — `33/66` tam olarak `1fr 2fr` (%33.33/%66.67) demektir; `25/50/25` → `1,2,1`. Yüzdeleri ayrıca saklamak, `widthFr` ile senkron kalması gereken ikinci bir gerçek kaynağı yaratırdı (v1'in `columnCount` hatası).

`"100"` ön ayarı **tek bir konteyner** üretir (alt konteyner YOK) — "sadece bir bölüm/section ekle" durumu. Diğerleri: dış konteyner (`direction: "row"`) + `weights.length` adet alt konteyner (`direction: "column"`).

### 8.3 Palette UI kararı

Blok palette'i **iki bölüme** ayrılır:
1. **Düzen** — 7 ön ayar, ızgara ikonlarıyla (Layout Picker).
2. **İçerik** — mevcut 7 blok (`blockRegistry`), değişmeden.

Ekleme hedefi: **seçili konteyner** (yoksa kök dizi). Görsel dil, ikonografi, ızgara önizleme çizimleri ve iki bölümün ayrımı **ui-designer'ındır**.

### 8.4 `layout-menu.tsx` (mevcut "Düzen" dropdown'ı) ne olacak?

**KALIR ama yeniden hedeflenir.** Mevcut blokları düzene sokmanın iki yolu olur ve ikisi de gereklidir:
- **Layout Picker** (yeni, birincil): boş konteyner ekle → doldur.
- **"Konteynere Sar"** (mevcut dropdown'ın devamı, ikincil): var olan bir bloğu tek hamlede bir konteynerin ilk çocuğu yapar. `wrapInColumns` → **`wrapInContainer`** olarak yeniden adlandırılır ve `container` üretir.

`LayoutValue = "full" | "row"` ikilisi kaldırılır; menü artık "Konteynere Sar" + (konteyner üzerindeyken) "Konteyneri Kaldır (unwrap)" gösterir. `unwrapColumns` → **`unwrapContainer`**; **veri kaybı tuzağı koruması (`needsConfirmToUnwrap` + onay diyaloğu) AYNEN KORUNUR** — v3'te daha da kritiktir, çünkü unwrap edilen konteynerin çocukları başka konteynerler olabilir (§10.17.3'ün "sessizce silmek YASAK" kuralı geçerli).

---

## 9. Karar 4 — API kontratı etkisi (`openapi.yaml`)

`docs/architecture/openapi.yaml` **mevcuttur** ve güncellenmesi ZORUNLUDUR. Sahibi: **documentation-agent** (architect onayıyla).

### 9.1 Şeklin değişip değişmediği — net cevap

| Alan | Değişiyor mu? |
|---|---|
| `blocks`'un **tipi** (`array`) | **HAYIR** — `type: array` kalır, `maxItems: 200` → **300** |
| Dizi elemanının **şekli** | **EVET, genişliyor** (kırıcı değil, additive): yeni `type: "container"` değeri + `settings`/`children` alanları |
| `columns` desteği | **KALDIRILMIYOR** — `deprecated` işaretlenir, WRITE'ta kabul edilir ve `container` olarak normalize edilir |
| Endpoint sayısı/yolları | **DEĞİŞMİYOR** — yeni uç YOK, yol değişikliği YOK |
| HTTP status kodları | **DEĞİŞMİYOR** — ihlaller `422 VALIDATION_ERROR` + `error.details.blocks` (mevcut standart) |

**Sonuç: bu bir MINOR (geriye dönük uyumlu) kontrat değişikliğidir.** Eski bir istemci `columns` göndermeye devam edebilir; yeni bir istemci `container` gönderir.

### 9.2 Yapılacak somut düzenlemeler (satır referanslarıyla)

| Yer | Değişiklik |
|---|---|
| `PageBlock` (~8410) | Şema **adı KORUNUR** (5 yerden `$ref` ediliyor, kitlesel yeniden adlandırma gereksiz risk). `type` enum'una **`container`** eklenir. `data` alanı "yalnızca içerik blokları" olarak, `settings`+`children` "yalnızca `container`" olarak tarif edilir. `columns` için `deprecated: true` notu + "yeni içerik üretmez, okuma/geçiş içindir". |
| **YENİ** `PageContainerSettings` | §5.2'deki tüm alanlar, enum'lar, min/max/default değerleri. `minHeight`'ın **string olmadığı** ve nedeni açıkça yazılır. |
| **YENİ** `PageContainerNode` | `{ id, type: container, settings, children }`, `children.maxItems: 24`. |
| `PageColumnsBlockData` (~8439) | `deprecated: true`. Açıklaması "§10.17 v2 — v3'te `PageContainerNode`'a normalize edilir; `gap` token→px, `verticalAlign`→`alignItems`, `width`→`widthFr` eşlemesi" ile güncellenir. "Derinlik en fazla 1" cümlesi **kaldırılır**, yerine "derinlik en fazla `MAX_CONTAINER_DEPTH = 4`". |
| `CreatePageRequest.blocks` (~8492) | `maxItems: 200 → 300`; açıklamaya derinlik ≤4, konteyner başına ≤24 çocuk, gövde ≤256 KB eklenir. |
| `UpdatePageRequest.blocks` (~8540) | Aynısı. |
| `AutosavePageRequest` (~1573, ~8679) | `blocks` aynı doğrulamalardan geçer — açıkça yazılır (autosave "gevşek" değildir). |
| `PageDetail.blocks` (~7963) | "Ham JSON olarak döner, **legacy `columns` düğümleri içerebilir**; istemci normalize etmelidir" notu. |
| Public page `blocks` (~11224) | Aynı not. |
| `PageRevision` snapshot alanları (~8765) | "Snapshot'lar **kaydedildikleri dönemin şeklini** taşır (v1/v2/v3 karışık olabilir); restore yazma yolundan geçtiği için v3'e normalize edilir." |
| SEO puanı notu (~8357) | `blocks` içindeki görsellerin **konteyner derinliğinden bağımsız** sayıldığı (`flattenPageBlocks`) teyit edilir. |

`docs/architecture/shared-types.ts` (~1387 bloğu) ve `ARCHITECTURE.md` **§10.19 (YENİ bölüm)** aynı içerikle güncellenir; §10.17 başlığına *"v3 ile SUPERSEDE edildi — bkz. §10.19"* notu düşülür (silinmez, tarihsel karar kaydı olarak kalır).

---

## 10. Karar 5 — Ajan görev dağılımı (sıra + net görev tanımı)

Branch: **`feature/page-builder-containers`** · Commit formatı: Conventional Commits (`feat(pages): …`, `refactor(page-builder): …`).
Bu iş, tek bir PR'a sığmayacak kadar büyüktür — **üç PR'a bölünür** (aşağıdaki dalgalar).

### Dalga 0 — db-agent: **DEVREYE GİRMEZ**

`Page.blocks` zaten `Json @default("[]")`. **Yeni tablo, yeni kolon, migration, backfill job GEREKMEZ.** Bu madde §10.17.2 ile aynı gerekçeyle açıkça yazılmıştır ki db-agent boşuna bir migration üretmesin.

### Dalga 1 — Sözleşme + backend (PR #1: `feat(pages): hiyerarşik konteyner veri modeli`)

| Sıra | Ajan | Net görev | Dokunacağı dosyalar |
|---|---|---|---|
| 1.1 | **security-agent** (ÖN denetim — kod yazılmadan ÖNCE) | §4 ve §5.2/§5.3'ü denetle: (a) iteratif ön-tarama + zod parse **sırası** yeterli mi, (b) `MAX_CONTAINER_DEPTH=4` / `MAX_TOTAL_PAGE_NODES=300` / `256 KB` üçlüsü kabul edilebilir mi, (c) `background.value` regex'leri ve `minHeight` sayısallaştırması CSS enjeksiyonunu kapatıyor mu, (d) negatif margin yasağı gerekli mi. **Çıktı: onay veya sayısal/regex düzeltme talebi.** Kod YAZMAZ. | — (rapor) |
| 1.2 | **backend-agent** | §5'teki şemayı **birebir** uygula. `page-blocks.ts`: `scanPageNodeStructure` (YENİ, iteratif) + `flattenPageBlocks` (özyinelemeli → **iteratif**, `container.children` desteği, imza değişmez). `pages.schemas.ts`: `PageBlockListSchema` + `PageNodeSchema` + `ContainerNodeSchema` + `LegacyColumnsNodeSchema`; `refineTotalBlockCount` kaldır; `TranslationsSchema`'yı `PageBlockListSchema`'ya bağla. `sanitize-blocks.ts`: **`container.children` özyineleme dalı** (§5.6 — atlanırsa stored XSS) + `depth` cutoff. `seo-score.ts`: **değişmez** (flatten üzerinden otomatik kazanır) — doğrula. Mapper'lar **değişmez**. | `backend/src/lib/page-blocks.ts`, `backend/src/modules/pages/pages.schemas.ts`, `backend/src/modules/pages/lib/sanitize-blocks.ts` |
| 1.3 | **backend-agent** (unit test) | (a) legacy `columns` → `container` dönüşümü (v1 `ratio` ve v2 `width` varyantları), (b) derinlik 5 → 422, derinlik 4 → OK, (c) 25 çocuk → 422, (d) 301 düğüm → 422, (e) 257 KB → 422, (f) **10.000 seviye derinlikte payload `RangeError` FIRLATMAZ, temiz 422 döner** (regresyon testi — bu turun imza testi), (g) `container` içindeki `text.data.html` sanitize edilir (XSS regresyonu), (h) `translations.<LOCALE>.blocks` için (b)-(g)'nin hepsi. | `backend/tests/unit/*` |
| 1.4 | **documentation-agent** | §9.2 tablosundaki tüm `openapi.yaml` düzenlemeleri + `shared-types.ts` + `ARCHITECTURE.md §10.19` (yeni bölüm, §10.17'ye supersede notu) + `CHANGELOG.md`. | `docs/architecture/*`, `CHANGELOG.md` |

### Dalga 2 — Tasarım + frontend (PR #2: `feat(page-builder): konteyner editörü ve render motoru`)

| Sıra | Ajan | Net görev | Dokunacağı dosyalar |
|---|---|---|---|
| 2.1 | **ui-designer** (frontend-agent'tan ÖNCE / paralel başlar) | Kod YAZMAZ, spesifikasyon üretir → `.claude/design-notes-page-builder-container-ui.md`. Kapsam: (a) **Layout Picker**'ın 7 ön ayar ikonu/ızgara önizlemeleri ve palette'in "Düzen"/"İçerik" iki-bölüm ayrımı; (b) **konteyner ayar paneli**nin bilgi mimarisi — hangi kontrol hangi grupta (Düzen / Boşluk / Arka Plan), Boxed↔Full-Width geçişi, genişlik slider'ı (320–1920, varsayılan 1170), `minHeight` (değer + birim), 4-kenar padding/margin kontrolü, `justifyContent`/`alignItems` icon-toggle-group'ları (mevcut `style-controls.tsx` dili); (c) editörde **iç içe konteynerlerin görsel hiyerarşisi** — 4 seviye derinlik ayırt edilebilir olmalı (kenarlık/etiket/girinti), seçili konteynerin vurgusu, boş konteyner bırakma alanı; (d) `ROW_CHILDREN_READABILITY_WARNING_THRESHOLD` (6) uyarısının dili — **`warning` tonu, asla `danger`** (proje idiomu); (e) `chrome: "bare"` yaprak bloklarının konteyner içindeki görünümü. **Kapsam DIŞI (mimar kararı): veri şeması, `MAX_*` sayısal değerleri, `md` kırılma noktası, flexbox kararı, sınıf/inline-style bölüşümü.** | `.claude/design-notes-page-builder-container-ui.md` |
| 2.2 | **frontend-agent** — tipler & saf mantık | §3'teki `types.ts`'i birebir uygula. **YENİ** `normalize.ts` (§7.2), **YENİ** `containers.ts` (ağaç işlemleri: `findNode`, `findParentId`, `insertNode`, `removeNode`, `moveNode`, `updateContainerSettings`, `wrapInContainer`, `unwrapContainer`, `countNodes`, `containerDepth`, **`isDescendant`** — bir konteyneri kendi torununun içine bırakmayı engeller, aksi halde ağaç kopar), **YENİ** `presets.ts` (§8.2). `columns.ts` **SİLİNİR**. | `frontend/src/lib/page-builder/*` |
| 2.3 | **frontend-agent** — public render | **YENİ** `container-block.tsx` (§6.1/§6.2 sınıf+inline-style tabloları). `columns-block.tsx` **SİLİNİR**. `blocks/index.tsx`: `container` dalı + **`chrome` prop'u** (§6.3) + bilinmeyen tip → `null`. Yaprak görünümleri (`text`/`hero`/`cta`/`gallery`) `chrome === "bare"` iken dış gutter'ı bırakır. Sayfa bileşenleri kökte `normalizePageNodes` çağırır. | `frontend/src/components/site/blocks/*`, `frontend/src/app/[lang]/(site)/**` |
| 2.4 | **frontend-agent** — admin editör | `builder-canvas.tsx`'i **özyinelemeli** hale getir: tek `DndContext` (en dışta, `closestCorners` korunur), her konteyner için `useDroppable({ id: "container:<id>" })` + kendi `SortableContext`'i, `onDragOver` konteyner değişimi / `onDragEnd` sıralama bölüşümü korunur, **`isDescendant` guard'ı** ile kendi içine bırakma engellenir. **Yukarı/aşağı ok butonları KALDIRILMAZ** (a11y yedeği, §10.17.6 kararı geçerli) + "Üst konteynere taşı"/"Alt konteynere taşı" eşdeğeri eklenir. **YENİ** `container-settings-panel.tsx` (ui-designer spesifikasyonuna göre). `layout-menu.tsx` → `wrapInContainer`/`unwrapContainer` (onay diyaloğu KORUNUR, §8.4). **YENİ** `layout-picker.tsx`. | `frontend/src/components/admin/page-builder/*` |
| 2.5 | **frontend-agent** (unit test) | `normalizePageNodes` (v1/v2/v3 girdileri, bozuk veri), `containers.ts` ağaç işlemleri (özellikle `isDescendant`, `moveNode` konteynerler arası, `unwrapContainer` iç içe konteyner içerirken), `createContainerFromPreset` × 7 ön ayar, `MAX_*` sınırlarında editörün engelleme davranışı. | `frontend/tests/unit/*` |

### Dalga 3 — Doğrulama (PR #3: `test(page-builder): konteyner e2e kapsamı`)

| Sıra | Ajan | Net görev |
|---|---|---|
| 3.1 | **security-agent** (SON denetim) | Uygulanmış kodu denetle: (a) `sanitize-blocks.ts`'in `container.children` dalı **gerçekten var mı** (§10.17.4 XSS'inin tekrarı), (b) ön-tarama gerçekten **iteratif** mi ve zod parse'tan **önce** mi çalışıyor, (c) `settings` → inline style yolunda enterpole edilen **her** değer ya sayısal ya kapalı enum ya da regex'li mi, (d) `translations` yolu ana `blocks` yoluyla **aynı** doğrulamayı alıyor mu. |
| 3.2 | **code-quality-agent** | Lint/format; `types.ts` ↔ `pages.schemas.ts` **sayısal sabit eşleşmesi**; `DEFAULT_CONTAINER_SETTINGS` ↔ zod `.default()` eşleşmesi; deprecated alias'ların (`Block`, `LeafBlock`, `MAX_BLOCKS_PER_COLUMN`…) yalnızca geçiş amaçlı olduğunun işaretlenmesi; ölü kod (`columns.ts`, `columns-block.tsx`) gerçekten silinmiş mi. Yeni npm bağımlılığı **beklenmiyor** — eklenmişse gerekçe iste. |
| 3.3 | **qa-agent** | E2E: (1) Layout Picker'dan 50/50 ekle → her sütuna blok koy → kaydet → public'te doğrula; (2) 4 seviye iç içe konteyner kur, 5.'yi denerken engellendiğini doğrula; (3) konteyneri kendi çocuğunun içine sürüklemeyi dene → reddedilir; (4) **legacy fixture** (v1 `ratio` + v2 `width` içeren bir sayfa) → dokunmadan public render → oran korunur; sonra kaydet → DB'de `container` olur; (5) unwrap onay diyaloğu → içerik kaybı yok; (6) mobil viewport'ta `row` konteyner yığılır. `frontend/tests/e2e/support/api.ts`'teki blok fixture'ları güncellenir. |
| 3.4 | **compliance-agent** | **Devreye girmez** — bu değişiklik hiçbir kişisel veri (PII) alanı eklemiyor/işlemiyor; `blocks` editör tarafından üretilen içeriktir. (Bu satır, "değerlendirildi ve kapsam dışı" kaydı olarak bilinçle yazılmıştır.) |
| 3.5 | **performance-agent** | **İsteğe bağlı**, Dalga 2 sonrası: iç içe konteynerlerin admin editöründe re-render maliyeti (300 düğüm × 4 seviye), `normalizePageNodes`'un public SSR'deki maliyeti (memoize edilmeli mi), `blocks` JSON'unun sayfa yükü etkisi. Yeni özellik geliştirmez. |
| 3.6 | **devops-agent** | CI pipeline; migration **YOK** olduğu için deploy sırası kısıtı yok. Not: backend (Dalga 1) frontend'den (Dalga 2) **önce** deploy edilebilir ve edilmelidir — backend `columns`'ı da `container`'ı da kabul ettiği için **her iki yönde de uyumludur**, downtime/feature-flag gerekmez. |
| 3.7 | **observability-agent** | `422 VALIDATION_ERROR` içinde **yeni** hata mesajlarının (derinlik/çocuk sayısı/byte tavanı) loglarda ayırt edilebilir olması; sınırlara çarpma oranı bir metrik olarak izlenirse, sabitlerin doğru seçilip seçilmediği veriye dayalı olarak değerlendirilebilir. |

---

## 11. Bu turda BİLİNÇLE KAPSAM DIŞI bırakılanlar

Aşağıdakiler **reddedilmedi**, ertelendi. Yeniden gündeme gelirlerse architect karar verir:

1. **Cihaz-bazlı (responsive) ayar setleri** — Elementor'un Desktop/Tablet/Mobile sekmeleri. Veri modeli etkisi büyük (`settings` → `settings.desktop/tablet/mobile`), v3'te tek set + `row` yığılması yeterli (§6.2).
2. **Negatif margin** (üst üste binen bölümler) — editör içi tıklama tuzağı riski (§5.2).
3. **Arka plan overlay/gradient/video** — `background` union'ı genişletilebilir tasarlandı, v3'te `none|color|image`.
4. **Global "bölüm şablonu" (saved sections) kütüphanesi** — ayrı bir özellik, muhtemelen yeni bir DB tablosu (db-agent) gerektirir.
5. **Legacy `columns` şiminin kaldırılması** — çıkış koşulu §7.1'de tanımlı.
6. **Blog'a konteyner getirmek** — §10.17.1 kararı aynen geçerli (TipTap node + sanitize allow-list işi, ayrı ve çok daha büyük).
7. **`Page.blocks`'un JSON'dan ilişkisel tabloya taşınması** — 300 düğüm/256 KB ölçeğinde gereksiz; ölçek değişirse db-agent ile yeniden değerlendirilir.

---

## 12. Definition of Done (bu özellik için somutlaştırılmış)

- [ ] `openapi.yaml` §9.2'deki tüm maddelerle güncel (architect onayı)
- [ ] db-agent: **uygulanacak migration YOK** (açıkça teyit edildi)
- [ ] Backend unit testleri, özellikle **10k-derinlik → temiz 422** ve **konteyner içi `text` sanitize** regresyonları geçiyor
- [ ] Frontend unit testleri: `normalizePageNodes` v1/v2/v3 + `isDescendant`
- [ ] Lint/format geçiyor; `types.ts` ↔ `pages.schemas.ts` sabitleri eşleşiyor
- [ ] security-agent ÖN (1.1) ve SON (3.1) denetimlerinin ikisi de onaylı
- [ ] compliance-agent: kapsam dışı olarak kayda geçti
- [ ] E2E: legacy fixture parite testi dahil 6 senaryo geçiyor
- [ ] `ARCHITECTURE.md §10.19` + `shared-types.ts` + `CHANGELOG.md` güncel
- [ ] CI yeşil; deploy sırası kısıtı yok (backend önce gidebilir)

---

## 13. Security-agent ön denetim notu (Dalga 1.1, kod yazılmadan önce)

Durum: **KOŞULLU ONAY.** backend-agent implementasyona başlayabilir, ancak aşağıdaki 2 madde (13.1, 13.3) **bağlayıcı düzeltme**, geri kalanı doğrulama/gerekçe genişletmesidir.

### 13.1 (a) Savunma sırası — KENDİ KENDİNİ BALTALAYAN BİR ADIM VAR (düzeltme zorunlu)

§5.5'teki sıra `byte tavanı (JSON.stringify) → scanPageNodeStructure` şeklinde, yani `JSON.stringify(blocks)` **iteratif taramadan önce** çalışıyor. `JSON.stringify` V8'de iç içe nesne/dizi için **özyinelemelidir** (parse'ın aksine — parse iteratif hale getirildi, stringify EDİLMEDİ). 256 KB'nin altında ama on binlerce seviye derin (`[[[[…]]]]` gibi minimal payload) bir girdi, byte ölçümü sırasında `RangeError` fırlatabilir — bu, §4.1'de zod parse için tarif edilen tehlikenin AYNISI, sadece bir adım erken devreye giriyor.

**Zorunlu düzeltme:** Adım 2 ile 3'ün yeri değiştirilir → önce `scanPageNodeStructure` (tamamen iteratif, stack-safe, kendi `ABSOLUTE_VISIT_CAP`'i var) çalışır; derinlik/toplam-düğüm/fan-out onaylandıktan SONRA (ağaç artık küçük ve sığ garantilidir) `JSON.stringify` ile byte ölçümü yapılır. Ek savunma: `JSON.stringify` çağrısı `try/catch`'e alınıp olası `RangeError` 422'ye çevrilir (defense-in-depth, sıra bozulursa bile kırılmaz). backend-agent ayrıca Fastify'nin gövde JSON parse aşamasının (bu kod çalışmadan ÖNCEki katman) aşırı derin JSON'da `RangeError`'ı 400'e çevirdiğini (500/crash olmadığını) doğrulamalı.

### 13.2 (b) Sayısal sınırlar — kabul edilebilir, BİR netleştirme gerekli

`MAX_CONTAINER_DEPTH=4`, `MAX_CHILDREN_PER_CONTAINER=24`, `MAX_TOTAL_PAGE_NODES=300`, `256 KB` DoS açısından yeterli (300 düğüm × derinlik 4 iş yükü önemsiz, 256 KB Fastify'nin 5 MB tavanının çok altında). **Netleştirme:** `scanPageNodeStructure`, `maxChildren`'ı `raw.length` (KÖK dizinin kendi uzunluğu) ile başlatıyor ve bunu da `MAX_CHILDREN_PER_CONTAINER=24`'e karşı kontrol ediyor — yani kök `blocks` dizisi, bir "konteyner" olmamasına rağmen fiilen 24 öğeyle sınırlanmış oluyor. Güvenlik açığı değil ama v2'ye göre sessiz bir davranış daralması: konteynersiz, doğrudan kökte 25+ içerik bloğu olan (mevcut) bir sayfa artık kaydedilirken 422 alabilir. architect'in bilinçli onayı istenmeli — kök için ayrı/daha yüksek bir fan-out sabiti mi tanımlanacak, yoksa bu daralma kabul mü edilecek.

### 13.3 (c) CSS enjeksiyonu — yaklaşım doğru, kara liste kırılgan (düzeltme talep)

Regex + kapalı enum + sayısal aralık (serbest CSS string yok) doğru temel. `CSS_URL_UNSAFE_RE` bir kara listedir ve `%` (URL-encoding) karakterini yasaklamıyor: `javascript:alert%281%29` veya percent-encoded bir `data:image/svg+xml,...` payload'ı hiçbir yasaklı karakter içermeden regex'i geçer. Modern tarayıcılar `background-image: url()` bağlamında `javascript:`'i çalıştırmaz ve SVG'yi "image" bağlamında sandbox'lar, yani bugünkü pratik sömürülebilirlik düşük — ama bu yine de bir kara liste kırılganlığıdır ve whitelisting ile kapatılmalı.

**Düzeltme talebi:** karakter kara listesine ek olarak bir **protokol beyaz listesi** eklenir — `value` yalnızca `/` (relative path) veya `https://`/`http://` (tercihen yalnızca izinli upload/CDN origin'i) ile başlayabilir; `javascript:`, `vbscript:`, `data:` önekleri (case-insensitive, baştaki boşluk/kontrol karakteri toleranslı) açıkça reddedilir.

### 13.4 (d) Negatif margin yasağı — yeterli, gerekçe genişletilmeli

Mevcut yasak (`padding`/`margin` `min(0).max(200)`) teknik olarak YETERLİ. Ancak gerekçe yalnızca "editör içi UX tuzağı" olarak yazılmış — eksik. Ek güvenlik gerekçesi: negatif margin, düşük yetkili bir Editor'ün **yayınlanmış/public** sayfada bir elemanı başka bir elemanın üzerine görünmez şekilde taşıyıp **site ziyaretçilerine yönelik** bir UI-redressing/tıklama-tuzağı benzeri desen üretmesine izin verirdi (örn. gerçek bir onay/consent kontrolünün üzerine görünmez bir alan bindirmek). Bu, yalnızca admin-içi bir tuzak değil, halka açık render'da bir içerik-bütünlüğü/spoofing riskidir — mevcut sınırlama bunu zaten kapatıyor, sadece dokümantasyonda bu ikinci gerekçe de kayıt altına alınmalı. Yasak ileride gevşetilirse (§11 madde 2) bu iki gerekçenin ikisi de yeniden değerlendirilmelidir.

### 13.5 (e) `sanitize-blocks.ts` — `container.children` dalı ZORUNLU, onaylandı + 1 ek doğrulama isteği

§10.17.4'teki stored XSS'in aynısının tekrarlanma riski gerçek ve `container.children` dalının eklenmesi **zorunlu, atlanamaz** bir adımdır — onaylıyorum. Depth-cutoff (`depth > MAX_CONTAINER_DEPTH + 2`) yaklaşımını da onaylıyorum, ŞU ŞARTLA: bu kontrol, `sanitizeSinglePageBlock`/`sanitizePageBlocks`'un **her çağrısının en başında**, children üzerinde herhangi bir map/iterasyon yapılmadan ÖNCE uygulanmalı — böylece kötü niyetli/eski bir revision snapshot'ı ne kadar derin olursa olsun gerçek JS çağrı yığını en fazla `MAX_CONTAINER_DEPTH+2` kadar büyür (scanPageNodeStructure'dan bağımsız, kendi başına stack-safe).

**Ek doğrulama isteği (backend-agent'a):** `sanitizePageBlocks` yalnızca `data.html`'e bakıyor, `settings`'e HİÇ bakmıyor (§3.3 — bilinçli tasarım). Bu, YENİ yazmalarda güvenlidir çünkü `ContainerSettingsSchema` (background regex, minHeight enum) her zaman devrededir. Ancak revision-snapshot'larını DOM'a render eden bir yol (restore'a commit ETMEDEN, salt "önizleme/diff" amaçlı) varsa veya eklenecekse, o yol write-schema'dan geçmeyebilir — bu durumda eski/bozuk `settings.background.value` ya da `minHeight` hiçbir regex/enum doğrulamasından geçmeden inline style'a gidebilir. backend-agent implementasyon sırasında teyit etmeli: revision `blocks`'unu DOM'a render eden HER yol (yalnızca restore değil, varsa preview/diff de) write-schema'daki background/length doğrulamasından geçiyor mu? Geçmiyorsa aynı doğrulama (en azından `HEX_COLOR_RE`/`CSS_URL_UNSAFE_RE`/`ContainerLengthSchema` seviyesinde) o yola da eklenmelidir.

**Sonuç:** 13.1 ve 13.3'teki düzeltmeler uygulandıktan sonra backend-agent (1.2) implementasyona geçebilir. 13.2, 13.4, 13.5 onay/netleştirme notlarıdır, implementasyonu bloklamaz ama backend-agent'ın unit testlerine (1.3) yansıtılmalıdır.

---

## 14. Security-agent SON denetim notu (Dalga 3.1, uygulanmış kod üzerinde)

Durum: **ONAY (koşullar karşılandı), + 1 YENİ KRİTİK bulgu bulundu ve DÜZELTİLDİ (kapsam dahilinde, kod yazıldı).**

Denetlenen dosyalar: `backend/src/lib/page-blocks.ts`, `backend/src/modules/pages/pages.schemas.ts`, `backend/src/modules/pages/lib/sanitize-blocks.ts`, `backend/src/modules/pages/pages.routes.ts`, ilgili `backend/tests/unit/*` ve `backend/tests/integration/revisions.test.ts`.

### 14.1 (a) Savunma sırası — DÜZELTİLDİ, doğrulandı

§13.1'in zorunlu düzeltmesi **birebir uygulanmış**: `pages.schemas.ts::PageBlockListSchema` içinde sıra artık `scanPageNodeStructure` (iteratif, `ABSOLUTE_VISIT_CAP` korumalı) → derinlik/çocuk/toplam-düğüm kontrolleri → **ancak SONRA** `JSON.stringify` ile byte ölçümü. `JSON.stringify` çağrısı `try/catch` içinde, olası bir `RangeError` `ctx.addIssue` ile temiz bir 422'ye çevriliyor (defense-in-depth — sıra ileride yanlışlıkla bozulsa bile crash olmaz). Kod içi yorum, Fastify'nin kendi `content-type-parser`'ının da aşırı derin JSON'da `RangeError`'ı zaten 400'e çevirdiğini belgeliyor. `pages-container-schema.test.ts`'teki "(f) 10.000 seviye derinlik → temiz 422, throw YOK" regresyon testi hem `blocks` hem `translations.EN.blocks` için mevcut ve geçiyor.

### 14.2 (b) Kök dizi sınırlaması — doğrulandı

`scanPageNodeStructure` kök `raw` dizisinin öğelerini `{node, depth:1}` olarak doğrudan stack'e koyuyor; `maxChildren` ölçümü `raw.length` ile **başlatılmıyor** (0'dan başlıyor) ve `childrenOfRawNode` yalnızca zaten bir konteyner/legacy-columns olan düğümler için çağrılıyor. Sonuç: kök `blocks` dizisi `MAX_CHILDREN_PER_CONTAINER=24`'e tabi DEĞİL, yalnızca gerçek `container.children` tabi — §13.2'nin işaret ettiği sessiz davranış daralması **giderilmiş**. `pages-container-schema.test.ts`'teki "(b clarification) 30 top-level content blocks, no container → kabul edilir" testiyle doğrulanıyor.

### 14.3 (c) Arka plan URL protokol beyaz listesi — DÜZELTİLDİ, bypass denemeleri geçemiyor

§13.3'ün istediği protokol beyaz listesi `isSafeContainerBackgroundImageUrl` ile eklenmiş: `value` yalnızca `/` ile başlayan (relative) veya `^https?:\/\//i` ile eşleşen bir dize olabilir; buna ek olarak `DANGEROUS_URL_SCHEME_RE = /^[\s -]*(javascript|vbscript|data):/i` (case-insensitive, baştaki boşluk/kontrol karakteri toleranslı) ve mevcut `CSS_URL_UNSAFE_RE` karakter kara listesi de korunuyor. Bu **pozitif beyaz liste birincil savunma**dır — `%`-encode edilmiş (`javascript:alert%281%29`), büyük/küçük harf karışık, öncü boşluklu (`   javascript:...`) veya `data:`/`vbscript:` varyantlarının HİÇBİRİ `/` veya `http(s)://` ile başlamadığı için, `DANGEROUS_URL_SCHEME_RE`'yi atlatsalar bile beyaz listeyi geçemezler — bypass yapısal olarak imkânsız (yalnızca kara listeye güvenmiyor). Statik analizle denenen tüm klasik atlatma teknikleri (encode, whitespace/tab/newline enjeksiyonu, mixed-case, `ftp://` gibi izinsiz şema) doğrulama testlerinde (`pages-container-schema.test.ts` §"protokol beyaz listesi") reddediliyor; `/uploads/bg.jpg` ve `https://cdn.example.com/bg.jpg` kabul ediliyor. Onay.

### 14.4 (d)/(e) `sanitize-blocks.ts` — `container.children` dalı VAR, depth-cutoff doğru yerde

`sanitizeSinglePageBlock` içinde `b.type === "container"` dalı mevcut ve `children`'ı `sanitizePageBlocks(..., depth + 1)` ile özyineliyor — §10.17.4'teki stored XSS'in `container.children` üzerinden sessizce yeniden açılması **engellenmiş**. Legacy `b.type === "columns"` dalı da aynen korunmuş (eski `PageRevision` snapshot'ları için). `SANITIZE_DEPTH_CUTOFF = MAX_CONTAINER_DEPTH + 2` kontrolü `sanitizePageBlocks`'un **en başında**, `blocks.map(...)`'ten ÖNCE uygulanıyor (§13.5'in şartı) — bu sayede kötü niyetli/keyfi derinlikte bir snapshot'ta bile gerçek JS çağrı yığını sabit bir tavanla sınırlı kalıyor, `scanPageNodeStructure`'dan bağımsız kendi başına stack-safe. `sanitize-page-blocks.test.ts`'teki 100 seviyelik pathological-depth testiyle doğrulanmış. Onay.

### 14.5 YENİ bulgu — `pages.routes.ts` revizyon restore endpoint'i, snapshot `blocks`/`translations` alanlarını YENİDEN doğrulamadan yazıyordu (backend-agent'ın flagledigi konu)

**Karar: GERÇEK bir güvenlik açığıydı, DOĞRULANDI ve KAPSAM DAHİLİNDE DÜZELTİLDİ.**

**Gerekçe (backend-agent'ın sorduğu iki soruya yanıt):**

1. **Somut, gerçekçi senaryo var mıydı?** Evet. v3 container mimarisi eklenmeden ÖNCE (`§13.5` notunda da işaret edildiği gibi) `PageNodeSchema`, bilinmeyen `type` değerlerini **serbest bırakıyordu** (`z.record(z.unknown())` — "minimum diff" kararı, tasarım notu §5.4). Bu, düşük yetkili bir **EDITOR** hesabının, o dönemde hiçbir şemadan geçmeden `{ type: "container", settings: { background: { type: "image", value: "javascript:alert(1)" } } }` gibi bir düğümü `blocks`'a yazdırabileceği anlamına gelir — bu veri bir sonraki PATCH'te otomatik olarak bir `PageRevision.snapshot`'a girer. v3 devreye girdikten SONRA bu revizyon geri yüklenirse, `settings.background.value` **hiçbir zaman** yeni protokol beyaz listesinden (§13.3/§14.3) geçmeden doğrudan canlı `Page.blocks`'a yazılıyor ve inline `style={{ backgroundImage: url("...") }}` ile render ediliyordu — CSS/URL enjeksiyonu. Aynı mekanizma `scanPageNodeStructure`'ın derinlik/çocuk/toplam-düğüm/byte sınırlarını da atlatıyordu (DoS yüzeyinin restore üzerinden sessizce yeniden açılması). Kod incelemesi doğruladı: restore, `snapshot.blocks`/`snapshot.translations`'ı yalnızca `sanitizePageBlocks`/`sanitizePageTranslations`'tan (yalnızca `data.html`'e bakar, `settings`'e HİÇ dokunmaz) geçiriyordu — `PageBlockListSchema`'ya (structural + background/length doğrulaması) hiç uğramıyordu. Create/Update/Autosave rotalarının aksine (bunlarda Fastify `schema: { body: ... }` ile `PageBlockListSchema` OTOMATİK devrede), restore `revision.snapshot` DB'den okunan serbest bir `Json` alanı olduğu için bu otomatik doğrulamadan hiç geçmiyordu.
2. **Düzeltme uygulandı mı?** Evet — `pages.routes.ts`'e `revalidateSnapshotBlocks`/`revalidateSnapshotTranslations` yardımcıları eklendi. Bu fonksiyonlar, herhangi bir DB yazımından ÖNCE (transaction başlamadan, hatta `snapshotBeforeUpdate` çağrılmadan ÖNCE) `snapshot.blocks` ve her `snapshot.translations.<LOCALE>.blocks`'u `PageBlockListSchema.safeParse`'tan geçirir:
   - **Başarılıysa:** normalleştirilmiş (`legacyColumnsToContainer` dahil) çıktı kullanılır — restore'un geri kalanı (title/slug/SEO/isLegalDocument) aynen mevcut davranışla devam eder.
   - **Başarısızsa:** restore **tamamen reddedilir** (`ValidationError` → 422 `VALIDATION_ERROR`, issue path'leri detaylara yansıtılır). `blocks`, sayfanın asıl içeriği olduğu için `isLegalDocument` gibi tek bir alanı atlayıp "kısmi kabul" (partial-apply) yapmak (§5.1'deki desen) burada anlamlı DEĞİLDİR — ya tüm içerik güvenli/tutarlı şekilde geri yüklenir ya da hiç yüklenmez. Hiçbir yazma (ne yeni revizyon snapshot'ı ne de `Page` güncellemesi) gerçekleşmeden fırlatılır.
   - Sonrasında `sanitizePageBlocks`/`sanitizePageTranslations` (HTML sanitizasyonu) normalleştirilmiş veri üzerinde ÇALIŞMAYA devam eder — savunma katmanları arasında sıra artık: **yapısal/protokol doğrulama (PageBlockListSchema) → HTML sanitizasyonu (sanitizePageBlocks)**, tıpkı create/update rotalarındaki gibi.

**Test kapsamı (`backend/tests/integration/revisions.test.ts`, yeni):**
- `ContentRevision` tablosuna API'yi (dolayısıyla `PageBlockListSchema`'yı) bypass ederek doğrudan Prisma ile "şemadan hiç geçmemiş" bir `javascript:` arka plan içeren snapshot enjekte edilir → restore isteği **422** döner, `error.code === "VALIDATION_ERROR"`, sayfa **hiç değişmez** (`pageAfter.blocks`/`title` restore öncesiyle birebir aynı — hiçbir yazma olmadığı doğrulanır).
- Aynı senaryo `translations.EN.blocks` için (`data:text/html,<script>...`) tekrarlanır → 422, sayfa değişmez.
- Regresyon: meşru (container/güvensiz alan içermeyen) bir eski revizyon hâlâ normal şekilde geri yükleniyor (200).

**Doğrulama:** `npx vitest run` (backend, tüm paket) — **84 dosya / 801 test, hepsi yeşil** (yeni 3 test dahil). `npx tsc --noEmit` hatasız.

### 14.6 Genel sonuç

Dalga 1.1 ön denetiminin (§13) tüm bağlayıcı maddeleri (13.1 sıra düzeltmesi, 13.3 protokol beyaz listesi) **kodda birebir uygulanmış** ve testlerle kilitlenmiş durumda; 13.2/13.4/13.5 onay/netleştirme maddeleri de kod ve yorumlarda karşılığını buluyor. Bu turda bulunan **tek yeni kritik bulgu** (revizyon restore'un `PageBlockListSchema`'yı bypass etmesi) doğrulanmış ve düzeltilmiştir. **Definition of Done (§12) açısından: security-agent SON denetimi (3.1) ONAYLANDI**, tespit edilen ek bulgu da bu turun kapsamında kapatıldı — yeni bir düzeltme turuna gerek yok.

**Operasyonel not (kapsam dışı ama kayda değer):** Bu denetim sırasında ortam, çalışma dizinindeki commit edilmemiş değişiklikleri (bu turun TAMAMI — backend-agent'ın Dalga 1 implementasyonu + bu denetimdeki düzeltme dahil) HEAD'e sıfırlayıp bir `git stash`'e taşıyan harici bir olay yaşadı; iş `git stash`'ten (`git checkout stash@{0} -- <path>` ile dosya dosya) eksiksiz kurtarıldı ve tüm testler (801/801) yeniden yeşil olarak doğrulandı. Veri kaybı YOK, ancak bu davranış incelenmeye değer bir ortam/orkestrasyon anomalisidir — devops-agent'a bilgi verilmesi önerilir.
