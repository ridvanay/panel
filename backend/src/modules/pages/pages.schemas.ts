import { z } from "zod";
import { PageEditModeSchema, PageStatusSchema, SocialPlatformSchema } from "../../schemas/entities";
import {
  refineScheduledAt,
  SCHEDULED_AT_REFINEMENT,
  DANGEROUS_URL_SCHEME_RE,
  SAFE_ABSOLUTE_URL_RE,
  SafeHrefSchema,
} from "../../schemas/common";
import { scanPageNodeStructure, MAX_CONTAINER_DEPTH, MAX_CHILDREN_PER_CONTAINER, MAX_TOTAL_PAGE_NODES } from "../../lib/page-blocks";

// §10.20 — `PageEditModeSchema` artık `schemas/entities.ts`'ten import edilir (bkz. `PageSchema`
// alanı da AYNI kaynağı kullanır). YALNIZCA `CreatePageRequestSchema`/`UpdatePageRequestSchema`'ya
// eklenir; `PageBlockListSchema` ve blok şemalarına DOKUNULMAZ (ikinci bir şema varyantı
// YAZILMAZ — §3.4 bunu kesin yasaklıyor).

export const PageIdParamSchema = z.object({
  pageId: z.string().uuid(),
});

export const PageSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const PageRevisionIdParamSchema = z.object({
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

// §9 backend-agent madde 2 — ortak `LocaleQuerySchema` artık `schemas/common.ts`'te (bkz. o
// dosya) — burada KOPYALANMIŞ, sabit `z.enum(["EN"])` şeması KALDIRILDI. Diğer route dosyaları
// da aynı şemayı import eder.
export { LocaleQuerySchema } from "../../schemas/common";

// ============================================================================================
// §10.19 (v3) Sayfa içerik bloklarında hiyerarşik `container` mimarisi — bkz.
// `.claude/design-notes-page-builder-containers.md` §5 (bağlayıcı kaynak) ve ARCHITECTURE.md
// §10.19 (§10.17 v1/v2'ye supersede eder — `columns`, artık hiç ÜRETİLMEYEN ama okunan/kabul
// edilen bir legacy şekil olarak kalır, bkz. tasarım notu §2.1 karar (C)).
// ============================================================================================

/* ---------- ayar (settings) şemaları — §5.2 ---------- */

const ContainerSpacingSchema = z
  .object({
    top: z.number().int().min(0).max(200).default(0),
    right: z.number().int().min(0).max(200).default(0),
    bottom: z.number().int().min(0).max(200).default(0),
    left: z.number().int().min(0).max(200).default(0),
  })
  .default({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * NEGATİF margin/padding v1'de KASITLI OLARAK yasak (0..200). İKİ ayrı gerekçesi var
 * (security-agent ön denetimi §13.4 — ikinci gerekçe bu turda EKLENDİ):
 * (1) UX-tuzağı: negatif margin, admin editöründe bir bloğun kendi ebeveyninin dışına taşıp
 *     KOMŞU KONTROLLERİ ÖRTMESİNE (tıklama hırsızlığına benzer bir editör-içi UX tuzağı) yol açar.
 * (2) Güvenlik/UI-redressing: negatif margin, düşük yetkili bir Editor'ün YAYINLANMIŞ/public
 *     sayfada bir elemanı başka bir elemanın üzerine GÖRÜNMEZ şekilde taşıyıp SİTE
 *     ZİYARETÇİLERİNE yönelik bir UI-redressing/tıklama-tuzağı benzeri desen üretmesine izin
 *     verirdi (ör. gerçek bir onay/consent kontrolünün üzerine görünmez bir alan bindirmek) —
 *     yalnızca admin-içi bir tuzak değil, halka açık render'da bir içerik-bütünlüğü/spoofing
 *     riski. İhtiyaç doğarsa ayrı bir turda, security-agent onayıyla ve bu iki gerekçenin
 *     yeniden değerlendirilmesiyle açılır.
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

/**
 * (c) security-agent ZORUNLU düzeltmesi (§13.3) — karakter kara listesi TEK BAŞINA
 * YETERSİZ: `%` (URL-encoding) yasaklı DEĞİL, bu yüzden `javascript:alert%281%29` gibi bir
 * payload hiçbir yasaklı karakter içermeden `CSS_URL_UNSAFE_RE`'yi geçebilir. Aşağıdaki
 * protokol BEYAZ LİSTESİ ek/bağımsız bir savunma katmanıdır (kara liste kırılganlığını
 * kapatır): `javascript:`/`vbscript:`/`data:` şemaları — baştaki boşluk/kontrol karakteri
 * toleranslı, case-insensitive — AÇIKÇA reddedilir.
 */
// `DANGEROUS_URL_SCHEME_RE`/`SAFE_ABSOLUTE_URL_RE` artik `schemas/common.ts`'te tanimlidir
// (bkz. o dosyanin `isSafeHref`/`SafeHrefSchema` yorumu,
// `.claude/architect-scope-advanced-slider.md` SS3.2.1 baglayici on kosulu) -- buradan
// IMPORT edilir, ikinci bir kopya YOKTUR.

/**
 * `value` yalnızca `/` ile başlayan (relative) ya da `https://`/`http://` ile başlayan bir URL
 * olabilir; VE karakter kara listesinden VE tehlikeli protokol beyaz-liste ihlalinden geçmelidir.
 */
function isSafeContainerBackgroundImageUrl(value: string): boolean {
  if (CSS_URL_UNSAFE_RE.test(value)) return false;
  if (DANGEROUS_URL_SCHEME_RE.test(value)) return false;
  return value.startsWith("/") || SAFE_ABSOLUTE_URL_RE.test(value);
}

/**
 * Gradient/animated arka plan renkleri için — `HEX_COLOR_RE`'DEN BİLEREK DAR (yalnızca 6 hane,
 * alfa kanalı YOK). Overlay'in kendi `opacity`si AYRI bir alan (bkz. frontend
 * `types.ts::ContainerBackgroundOverlay` yorumu) — bir renk alanında hem `#rrggbbaa` alfası hem
 * ayrı bir `opacity` alanı birlikte bulunması KAFA KARIŞTIRICI/çift-anlamlı olurdu.
 */
const OVERLAY_HEX_RE = /^#[0-9a-fA-F]{6}$/;

const ContainerBackgroundOverlaySchema = z.object({
  color: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri."),
  opacity: z.number().int().min(0).max(100),
});

const LINEAR_GRADIENT_DIRECTIONS = [
  "to-top",
  "to-top-right",
  "to-right",
  "to-bottom-right",
  "to-bottom",
  "to-bottom-left",
  "to-left",
  "to-top-left",
  "custom-angle",
] as const;

/**
 * "Animated" arka plan — `variant`e göre FARKLI alanlar taşır (`gradient-wave` iki renk,
 * `dots`/`grid` tek desen rengi). Tüm alanlar BURADA (şemanın kendisinde) OPSİYONEL — "variant'a
 * göre doğru alan(lar) zorunlu" kuralı dış `ContainerBackgroundSchema`nın SONUNA eklenen TEK bir
 * `superRefine` ile uygulanır (bkz. aşağısı). GEREKÇE: `.superRefine()`/`.refine()` bir şemayı
 * `ZodEffects`e SARAR — `z.discriminatedUnion`ın ARKADAŞ üyeleri `ZodObject` OLMAK ZORUNDADIR,
 * `ZodEffects` sarmalı bu koşulu BOZAR (doğrulandı: `Animated.superRefine(...)`'ı doğrudan
 * `discriminatedUnion` dizisine koymak `Cannot read properties of undefined` ile ÇÖKER).
 */
const AnimatedBackgroundSchema = z.object({
  type: z.literal("animated"),
  variant: z.enum(["gradient-wave", "dots", "grid"]),
  colorFrom: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri.").optional(),
  colorTo: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri.").optional(),
  patternColor: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri.").optional(),
});

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
        .refine(isSafeContainerBackgroundImageUrl, "Arka plan görseli URL'i güvensiz karakter ya da izinsiz bir protokol içeriyor."),
      position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
      size: z.enum(["cover", "contain", "auto"]).default("cover"),
      repeat: z.enum(["no-repeat", "repeat"]).default("no-repeat"),
      overlay: ContainerBackgroundOverlaySchema.optional(),
    }),
    z.object({
      type: z.literal("gradient"),
      gradientType: z.enum(["linear", "radial"]).default("linear"),
      colorFrom: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri."),
      colorTo: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri."),
      direction: z.enum(LINEAR_GRADIENT_DIRECTIONS).optional(),
      angle: z.number().int().min(0).max(360).optional(),
    }),
    AnimatedBackgroundSchema,
  ])
  .superRefine((val, ctx) => {
    if (val.type !== "animated") return;
    if (val.variant === "gradient-wave") {
      if (!val.colorFrom) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "colorFrom zorunlu.", path: ["colorFrom"] });
      if (!val.colorTo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "colorTo zorunlu.", path: ["colorTo"] });
    } else if (!val.patternColor) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "patternColor zorunlu.", path: ["patternColor"] });
    }
  })
  .default({ type: "none" });

/**
 * `minHeight` KASITLI OLARAK serbest bir `string` DEĞİLDİR (§5.3 — mimarın kullanıcı isteğini
 * reddetmesi). `settings`'in tamamı render motorunda inline `style` nesnesine beslenir; serbest
 * bir string CSS enjeksiyon yüzeyi olur ve `sanitizePageBlocks` yalnızca `data.html`'e bakar,
 * `settings`'e HİÇ bakmaz (§3.3). `{ value: number; unit: "px" | "vh" }` ile enjeksiyon
 * YAPISAL OLARAK İMKÂNSIZ hale gelir. Aynı ilke `gap`/`padding`/`margin`/`customWidth` için de
 * geçerlidir — hiçbiri string değildir.
 */

/** frontend `types.ts::MIN_DIVIDER_HEIGHT`/`MAX_DIVIDER_HEIGHT` ile SAYISAL OLARAK BİREBİR AYNI. */
const MIN_DIVIDER_HEIGHT = 0;
const MAX_DIVIDER_HEIGHT = 300;

/**
 * Şekilli Bölüm Ayırıcıları — frontend `types.ts::ShapeDividerSettings` yorumu: "Hex `#rrggbb` —
 * `ColorField` ile aynı doğrulama, alfa kanalı TAŞIMAZ". `container-settings-panel.tsx`'teki
 * `ShapeDividerField` içindeki `ColorField` çağrısı `maxLength` PROP'U GEÇMİYOR (varsayılan `7`
 * = `#rrggbb`, bkz. `color-field.tsx::ColorFieldProps.maxLength` varsayılanı) — yani
 * `ContainerBackgroundOverlaySchema`/`AnimatedBackgroundSchema` renkleriyle AYNI genişlik
 * (`OVERLAY_HEX_RE`, 6 hane, alfasız). Genel amaçlı 3/6/8 haneli `HEX_COLOR_RE` BİLEREK
 * KULLANILMAZ — frontend'in kabul ettiğinden DAHA GENİŞ bir regex burada gereksiz bir alfa-kanalı
 * kabulüne (ve dolayısıyla render tarafında öngörülmeyen bir CSS değerine) izin verirdi.
 */
const ShapeDividerSettingsSchema = z.object({
  type: z.enum(["wave", "slant", "triangle", "curve"]),
  color: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri."),
  height: z.number().int().min(MIN_DIVIDER_HEIGHT).max(MAX_DIVIDER_HEIGHT),
  flip: z.boolean().default(false),
});

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

    // Şekilli Bölüm Ayırıcıları — frontend `types.ts::ContainerSettings.topDivider/bottomDivider`
    // ile BİREBİR (opsiyonel, `undefined` = kapalı; `DEFAULT_CONTAINER_SETTINGS` bu alanları
    // İÇERMEZ, bu yüzden burada da `.default(...)` YOK).
    topDivider: ShapeDividerSettingsSchema.optional(),
    bottomDivider: ShapeDividerSettingsSchema.optional(),
  })
  // Bilinmeyen anahtarlar SESSİZCE DÜŞÜRÜLÜR (zod varsayılanı `strip`). `.passthrough()`
  // KULLANILMAZ: `settings` doğrudan inline style'a beslendiği için bilinmeyen alanın
  // taşınması, ileride bir render hatası/enjeksiyon yüzeyi açar.
  .default({});

/* ---------- legacy `columns` → kanonik `container` — §5.4 ---------- */

const LEGACY_GAP_PX: Record<string, number> = { none: 0, sm: 8, md: 16, lg: 32 };
const LEGACY_ALIGN: Record<string, "start" | "center" | "end"> = { top: "start", center: "center", bottom: "end" };

/** v1 `ratio` → per-column ağırlık (v2'deki `legacyRatioToWidths` AYNEN korunur). */
function legacyRatioToWidths(ratio: unknown, count: number): number[] {
  if (ratio === "2-1") return [2, 1];
  if (ratio === "1-2") return [1, 2];
  return Array.from({ length: count }, () => 1);
}

/**
 * v1/v2 `columns` bloğunu, GÖRSEL OLARAK EŞDEĞER bir konteyner ağacına çevirir (bkz. tasarım
 * notu §5.4 — geometrik parite tablosu). Bu, WRITE anında sessizce çalışan bir `z.preprocess`
 * fonksiyonudur: yeni kod ASLA `type: "columns"` üretmez, ama gelen bir `columns` düğümü
 * 422 VERMEZ — `container` olarak DB'ye yazılır (§2.1 karar (C)).
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

/**
 * Giriş Animasyonu (Scroll Reveal) — frontend `types.ts::RevealEffect`/`RevealDelay`/
 * `RevealEffectSettings` ile SAYISAL/İSİM OLARAK BİREBİR AYNI. Frontend'de `BaseNode.reveal`
 * TypeScript seviyesinde TÜM `PageNode` union üyelerine (23 içerik bloğu + `container`) otomatik
 * uygulanır; burada (Zod'da paylaşılan bir base şema OLMADIĞI için) her blok şemasına AYRI AYRI
 * `reveal: RevealEffectSettingsSchema.optional()` eklenir (bkz. aşağıdaki her blok tanımı).
 * `effect: "none"` VE `reveal` alanının HİÇ olmaması davranışsal olarak AYNI ("kapalı") — ikisi de
 * geçerli, bu yüzden `RevealEffectSettingsSchema`'nın kendisi `.optional()` DEĞİL, onu kullanan
 * alan `.optional()`dur.
 */
const RevealEffectSettingsSchema = z.object({
  effect: z.enum([
    "none",
    "fade-in",
    "fade-up",
    "fade-down",
    "slide-left",
    "slide-right",
    "zoom-in",
    "flip-up",
  ]),
  delayMs: z.union([
    z.literal(0),
    z.literal(100),
    z.literal(200),
    z.literal(300),
    z.literal(400),
    z.literal(500),
    z.literal(600),
    z.literal(700),
    z.literal(800),
    z.literal(900),
    z.literal(1000),
  ]),
  durationMs: z.union([z.literal(300), z.literal(600), z.literal(1000)]).optional(),
  once: z.boolean().optional(),
});

/* ---------- galeri (v2'den DEĞİŞMEDEN devralınır) ---------- */

/**
 * Galeri bloğu — bkz. görev kontratı (backend-agent, page-builder "Galeri" blok tipi). Önceden
 * bu blok tipi de `z.record(z.unknown())` ile tamamen serbestti: hem veri bütünlüğü (keyfi
 * `images[]` şekli) hem de DoS (sınırsız görsel sayısı) açısından bir boşluktu.
 *
 * `layout` alanı OPSİYONEL + `.default("grid")`: DB'de hâlen bu alan OLMADAN kaydedilmiş eski
 * `gallery` blokları var OLABİLİR — `.default(...)` bu eski kayıtların bir sonraki WRITE'ında
 * sessizce `layout: "grid"` ile normalize edilmesini sağlar.
 *
 * `images[].alt` bilinçli olarak boş string'e izin verir — UI'da eksik alt-metin bir UYARI'dır,
 * engelleyici bir hata değil. `images[].url` için katı bir URL/format regex'i YOK: medya
 * kütüphanesindeki URL'ler relative/absolute karışık olabilir.
 */
const GALLERY_MAX_IMAGES = 30;
const GalleryBlockDataSchema = z.object({
  images: z
    .array(
      z.object({
        url: z.string().min(1),
        alt: z.string(),
      })
    )
    .max(GALLERY_MAX_IMAGES),
  layout: z.enum(["grid", "carousel", "masonry"]).default("grid"),
});

const GalleryBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("gallery"),
  data: GalleryBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- §Faz "Temel Elemanlar" — Başlık/Buton/İkon Kutusu/Ayırıcı (yeni) ---------- */

/**
 * Buton/İkon Kutusu `href` alanı — `isSafeContainerBackgroundImageUrl` ile AYNI protokol
 * güvenlik gerekçesi (yalnızca relative veya http(s) mutlak, `javascript:`/`vbscript:`/`data:`
 * YASAK), ama CSS `url("…")` bağlamına YERLEŞMEDİĞİ için `CSS_URL_UNSAFE_RE` karakter kara
 * listesi burada uygulanmaz (bir `href` boşluk/parantez İÇEREBİLİR, tırnak-kaçışı riski yok).
 * `isSafeHref`/`SafeHrefSchema` artık `schemas/common.ts`'te tanımlıdır (§backend-agent ön
 * koşulu, `.claude/architect-scope-advanced-slider.md` §3.2.1) — buradan İMPORT edilir.
 */

const HeadingBlockDataSchema = z.object({
  text: z.string().min(1).max(300),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).default(2),
  align: z.enum(["left", "center", "right"]).default("left"),
  underline: z.boolean().default(false),
});
const HeadingBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("heading"),
  data: HeadingBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/**
 * `icon` gevşek doğrulanır (`min(1).max(40)`) — frontend `lib/page-builder/icon-options.ts`deki
 * kapalı allowlist'in İKİNCİ, "numaraca birebir aynı" tutulması gereken bir kopyası BURADA
 * TUTULMAZ (senkron kayma riski); render tarafı zaten tanınmayan bir isim için güvenli bir
 * varsayılana düşer (`resolveIcon`) — bu SADECE bir görsel seçim, dinamik import/require ASLA
 * yapılmadığı için tanınmayan bir isim güvenlik açığı DEĞİLDİR.
 */
const ButtonBlockDataSchema = z.object({
  label: z.string().min(1).max(120),
  href: SafeHrefSchema,
  style: z.enum(["solid", "outline", "ghost"]).default("solid"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  icon: z.string().min(1).max(40).optional(),
  align: z.enum(["left", "center", "right"]).default("left"),
});
const ButtonBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("button"),
  data: ButtonBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

const IconBoxBlockDataSchema = z.object({
  icon: z.string().min(1).max(40),
  heading: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  href: SafeHrefSchema.optional(),
});
const IconBoxBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("icon-box"),
  data: IconBoxBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Ayırıcı VE Boşluk TEK blok tipi — `variant` ayrımlar (bkz. frontend `types.ts::DividerBlock`). */
const DividerBlockDataSchema = z.object({
  variant: z.enum(["line", "space"]).default("line"),
  style: z.enum(["solid", "dashed"]).default("solid"),
  height: z.number().min(0).max(400).default(32),
});
const DividerBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("divider"),
  data: DividerBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- §Faz "Medya & İnteraktif" — Görsel (zenginleştirme)/Video/Akordiyon/Sekmeler ---------- */

/**
 * Görsel bloğu — daha önce (Gallery/Container dışındaki çoğu blok gibi) tamamen doğrulanmadan
 * geçiyordu; bu turda `caption`/`radius`/`lightbox` alanları eklendiği için şema TANIMLANIR.
 * Eski alanlar (`url`/`alt`) Gallery'nin `images[].url`/`alt`'iyle AYNI gerekçeyle katı bir
 * format regex'i TAŞIMAZ. Yeni 3 alan OPSİYONEL — eski kayıtlarda YOK olabilir.
 */
const ImageBlockDataSchema = z.object({
  url: z.string().min(1),
  // `.default("")` — `alt` bu blok tipiyle YAŞIT olsa da (§0'dan beri zorunlu), bu şema
  // BLOĞUN İLK KEZ doğrulandığı tur; savunma derinliği için Gallery'nin `layout` deseniyle
  // AYNI şekilde eksikse SESSİZCE normalize edilir, 422 ile REDDEDİLMEZ.
  alt: z.string().default(""),
  caption: z.string().max(300).optional(),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
  lightbox: z.boolean().optional(),
});
const ImageBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("image"),
  data: ImageBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/**
 * Video bloğu — `url` `SafeHrefSchema` ile doğrulanır (relative veya http(s) mutlak,
 * `javascript:`/`data:` YASAK). ID ÇIKARIMI/embed URL İNŞASI yalnızca frontend'de yapılır
 * (`lib/page-builder/video-embed.ts`) — backend ham `url`i OLDUĞU GİBİ saklar, bir iframe'e
 * DOĞRUDAN YAZILMAZ (bkz. o dosyanın başlığı, "yapılandırılmış embed" güvenlik deseni).
 *
 * `coverUrl` YENİ, OPSİYONEL (google-map-corporate-blocks turu, mimar §2.6, security-review §5
 * "ONAYLANDI") — `<img src>` bağlamında kullanılacağı için `BeforeAfterSliderBlockDataSchema.
 * beforeUrl` ile AYNI serbestlik sınıfı (`SafeHrefSchema` GEREKMEZ: `<img>` bağlamı
 * `javascript:` şemasını yürütmez, iframe/CSS enjeksiyon yüzeyi yok). `playStyle ?? "inline"`
 * (bugünkü davranış), `loop ?? false`.
 */
const VideoBlockDataSchema = z.object({
  provider: z.enum(["youtube", "vimeo", "mp4"]).default("youtube"),
  url: SafeHrefSchema,
  autoplay: z.boolean().default(false),
  muted: z.boolean().default(false),
  coverUrl: z.string().min(1).max(2048).optional(),
  playStyle: z.enum(["inline", "lightbox"]).optional(),
  loop: z.boolean().optional(),
});
const VideoBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("video"),
  data: VideoBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Frontend `types.ts::ACCORDION_MAX_ITEMS`/`TABS_MAX_ITEMS` ile SAYISAL OLARAK BİREBİR AYNI. */
const ACCORDION_MAX_ITEMS = 20;
const TABS_MAX_ITEMS = 10;

/**
 * Akordiyon / SSS — `answer` KASITLI OLARAK düz metin (HTML DEĞİL, bkz. frontend tip yorumu).
 * `layoutStyle`/`items[].isOpenDefault` YENİ, OPSİYONEL alanlar (google-map-corporate-blocks
 * turu, mimar §2.2/§5/7) — `.default()` TAŞIMAZLAR, yoksa render tarafı `layoutStyle ?? "bordered"`
 * ile bugünkü görünümle piksel-eş davranır (§1.2 geriye dönük uyumluluk sözleşmesi).
 */
const AccordionBlockDataSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1).max(300),
        answer: z.string().max(3000),
        isOpenDefault: z.boolean().optional(),
      })
    )
    .max(ACCORDION_MAX_ITEMS),
  allowMultipleOpen: z.boolean().default(false),
  layoutStyle: z.enum(["bordered", "card", "minimal"]).optional(),
});
const AccordionBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("accordion"),
  data: AccordionBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

const TabsBlockDataSchema = z.object({
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(100),
        content: z.string().max(5000),
      })
    )
    .max(TABS_MAX_ITEMS),
});
const TabsBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("tabs"),
  data: TabsBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- §Faz "Pazarlama & Sosyal Kanıt" — CTA (zenginleştirme)/Sayaç/Müşteri Yorumları/Fiyatlandırma Tablosu ---------- */

/**
 * CTA bloğu — daha önce (`hero`/`text`/`featured-*` gibi) tamamen doğrulanmadan geçiyordu; bu
 * turda `description`/`align`/`style`/ikincil buton alanları eklendiği için şema İLK KEZ
 * TANIMLANIR (`ImageBlockDataSchema`'nın yorumundaki AYNI desen — bkz. yukarısı). `heading`/
 * `buttonLabel`/`buttonHref` MEVCUT davranışa uygun ZORUNLU kalır; yeni alanların HİÇBİRİ
 * `.default()` TAŞIMAZ (mimar notu: default'lar eski kayıtları şişirir, varsayılana düşme
 * render tarafında yapılır — bkz. frontend `types.ts::CtaBlock` yorumu). `buttonHref`/
 * `secondaryButtonHref` `SafeHrefSchema` ile doğrulanır — `Button`/`IconBox`/`Video` ile AYNI
 * protokol beyaz listesi.
 */
const CtaBlockDataSchema = z.object({
  heading: z.string().min(1).max(200),
  buttonLabel: z.string().min(1).max(120),
  buttonHref: SafeHrefSchema,
  description: z.string().max(500).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  style: z.enum(["plain", "soft", "solid", "outline"]).optional(),
  secondaryButtonLabel: z.string().max(120).optional(),
  secondaryButtonHref: SafeHrefSchema.optional(),
});
const CtaBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("cta"),
  data: CtaBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Frontend `types.ts::COUNTER_MAX_ITEMS`/`TESTIMONIAL_MAX_ITEMS`/`PRICING_MAX_PLANS`/
 *  `PRICING_MAX_FEATURES` ile SAYISAL OLARAK BİREBİR AYNI. */
const COUNTER_MAX_ITEMS = 8;
const TESTIMONIAL_MAX_ITEMS = 12;
const PRICING_MAX_PLANS = 6;
const PRICING_MAX_FEATURES = 15;

/** Sayaç / İstatistik — `value` KASITLI OLARAK sayı (string DEĞİL), biçimlendirme render
 *  anında yapılır (bkz. frontend `CounterItem.value` yorumu). */
const CounterBlockDataSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        value: z.number().finite(),
        prefix: z.string().max(8).optional(),
        suffix: z.string().max(8).optional(),
        label: z.string().min(1).max(120),
      })
    )
    .min(1)
    .max(COUNTER_MAX_ITEMS),
});
const CounterBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("counter"),
  data: CounterBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/**
 * Müşteri Yorumları — `quote` KASITLI OLARAK düz metin (HTML DEĞİL, `AccordionQAItem.answer`
 * ile AYNI gerekçe). `avatarUrl` `SafeHrefSchema` ile doğrulanır (frontend tip yorumu: konteyner
 * background görseliyle AYNI katılıkta protokol beyaz listesi — `javascript:`/`data:` YASAK).
 */
const TestimonialBlockDataSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        quote: z.string().min(1).max(1000),
        authorName: z.string().min(1).max(120),
        authorRole: z.string().max(150).optional(),
        avatarUrl: SafeHrefSchema.optional(),
        rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
      })
    )
    .min(1)
    .max(TESTIMONIAL_MAX_ITEMS),
});
const TestimonialBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("testimonial"),
  data: TestimonialBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/**
 * Fiyatlandırma Tablosu — `price` KASITLI OLARAK serbest metin (sayı DEĞİL); "Ücretsiz"/"Bize
 * Sorun" gibi biçimler geçerlidir, sayısal doğrulama YAPILMAZ (bkz. frontend `PricingPlan.price`
 * yorumu). `features` plan BAŞINA en fazla `PRICING_MAX_FEATURES` satır taşır.
 */
const PricingTableBlockDataSchema = z.object({
  plans: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(80),
        price: z.string().min(1).max(40),
        period: z.string().max(30).optional(),
        description: z.string().max(300).optional(),
        features: z.array(z.string().min(1).max(200)).max(PRICING_MAX_FEATURES),
        highlighted: z.boolean().optional(),
        buttonLabel: z.string().min(1).max(120),
        buttonHref: SafeHrefSchema,
      })
    )
    .min(1)
    .max(PRICING_MAX_PLANS),
  // YENİ, OPSİYONEL (google-map-corporate-blocks turu, mimar §2.4) — v1'de SALT GÖRSEL bir
  // etikettir ("Aylık"/"Yıllık" rozeti); interaktif geçiş anahtarı KAPSAM DIŞI (mimar gerekçesi:
  // gerçek bir toggle `plans[].priceYearly` gerektirirdi, bu turda yok). Yoksa hiçbir ek etiket
  // render EDİLMEZ.
  billingInterval: z.enum(["monthly", "yearly"]).optional(),
});
const PricingTableBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("pricing-table"),
  data: PricingTableBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- §Faz 4 "Dinamik & CMS İçerikleri" — Son Blog Yazıları/İletişim Formu/Özel HTML ---------- */

/** Frontend `types.ts::LATEST_POSTS_MAX_LIMIT` ile SAYISAL OLARAK BİREBİR AYNI. */
const LATEST_POSTS_MAX_LIMIT = 12;

/**
 * Son Blog Yazıları — `categoryId`/`tagId` yalnızca ŞEKİL doğrulanır (var olan bir
 * `BlogCategory`/`BlogTag` id'sine karşılık gelip gelmediği KONTROL EDİLMEZ, `featured-products`
 * `categoryId`'siyle AYNI gerekçe): geçersiz/silinmiş bir id public tarafta filtre eşleşmesi
 * bulamayıp SESSİZCE boş sonuç üretir (`site/blocks/latest-posts-block.tsx`), 422 ÜRETMEZ.
 */
const LatestPostsBlockDataSchema = z.object({
  heading: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(LATEST_POSTS_MAX_LIMIT).default(3),
  categoryId: z.string().min(1).max(100).optional(),
  tagId: z.string().min(1).max(100).optional(),
});
const LatestPostsBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("latest-posts"),
  data: LatestPostsBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/**
 * İletişim / Form Bloğu — kendi alan şemasını TAŞIMAZ, site genelindeki TEK `ContactForm`
 * singleton'ını gömer (bkz. frontend `types.ts::ContactFormBlock` yorumu). `data` yalnızca bir
 * görünüm anahtarı taşır, KVKK/onay/alan tanımları `/admin/contact` ucundan yönetilir.
 */
const ContactFormBlockDataSchema = z.object({
  showTitle: z.boolean().default(true),
});
const ContactFormBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("contact-form"),
  data: ContactFormBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Frontend `types.ts::CUSTOM_HTML_MAX_LENGTH` ile SAYISAL OLARAK BİREBİR AYNI. */
const CUSTOM_HTML_MAX_LENGTH = 20000;

/**
 * Özel HTML / Kod Bloğu — `html` BURADA yalnızca ŞEKİL/UZUNLUK doğrulanır (ham, sanitize
 * EDİLMEMİŞ hâliyle). Gerçek güvenlik temizliği `modules/pages/lib/sanitize-blocks.ts` içinde,
 * Zod parse'ından SONRA, DB'ye yazılmadan HEMEN ÖNCE `lib/html-sanitize.ts::sanitizeCustomHtmlBlock`
 * ile yapılır (bkz. o dosyanın başlığı — Zod SEKME/UZUNLUK katmanı, sanitize-blocks İÇERİK
 * GÜVENLİĞİ katmanı, ikisi BAĞIMSIZ).
 */
const CustomHtmlBlockDataSchema = z.object({
  html: z.string().max(CUSTOM_HTML_MAX_LENGTH),
});
const CustomHtmlBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("custom-html"),
  data: CustomHtmlBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- Görsel widget'lar — Öncesi/Sonrası, Logo Bandı, İlerleme Çubuğu, Ekip ---------- */

/**
 * Öncesi / Sonrası Karşılaştırma — `beforeUrl`/`afterUrl` yalnızca `<img src>` olarak render
 * edilir (`ImageBlockDataSchema.url` ile AYNI gerekçe/serbestlik — `iframe`/CSS enjeksiyon
 * yüzeyi YOK, `SafeHrefSchema` GEREKMEZ).
 */
const BeforeAfterSliderBlockDataSchema = z.object({
  beforeUrl: z.string().min(1).max(2048),
  afterUrl: z.string().min(1).max(2048),
  beforeLabel: z.string().min(1).max(60),
  afterLabel: z.string().min(1).max(60),
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  // YENİ, OPSİYONEL (google-map-corporate-blocks turu, mimar §2.3) — tam sayı 0..100, yoksa
  // render `useState(initialSliderPosition ?? 50)` ile bugünkü sabit %50 davranışı korunur.
  initialSliderPosition: z.number().int().min(0).max(100).optional(),
});
const BeforeAfterSliderBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("before-after-slider"),
  data: BeforeAfterSliderBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Frontend `types.ts::LOGO_MARQUEE_MAX_ITEMS` ile SAYISAL OLARAK BİREBİR AYNI. */
const LOGO_MARQUEE_MAX_ITEMS = 20;

/** Logo Bandı — `items[].href` opsiyonel bir bağlantı, `SafeHrefSchema` ile doğrulanır
 *  (`TestimonialItem.avatarUrl` ile AYNI desen: opsiyonel href alanı → protokol beyaz listesi). */
const LogoMarqueeBlockDataSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        url: z.string().min(1).max(2048),
        alt: z.string().max(200).default(""),
        href: SafeHrefSchema.optional(),
      })
    )
    .max(LOGO_MARQUEE_MAX_ITEMS),
  speedSeconds: z.number().int().min(5).max(120).default(30),
  pauseOnHover: z.boolean().default(true),
  // YENİ, OPSİYONEL alanlar (google-map-corporate-blocks turu, mimar §2.5). `grayscale` bugün
  // KOD İÇİNDE SABİT (`logo-marquee-block.tsx` — hard-code `grayscale hover:grayscale-0` sınıfı) —
  // render tarafı `grayscale ?? true` KULLANMAK ZORUNDADIR (mimar §1.2/R1: `?? false` yazılırsa
  // TÜM mevcut logo bantlarının görünümü sessizce değişir, bu KESİNLİKLE YASAK). `displayMode`
  // yoksa `?? "marquee"` (bugünkü tek davranış).
  displayMode: z.enum(["marquee", "grid"]).optional(),
  grayscale: z.boolean().optional(),
});
const LogoMarqueeBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("logo-marquee"),
  data: LogoMarqueeBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Frontend `types.ts::SKILL_BAR_MAX_ITEMS` ile SAYISAL OLARAK BİREBİR AYNI. */
const SKILL_BAR_MAX_ITEMS = 12;

const SkillBarBlockDataSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1).max(80),
        percent: z.number().int().min(0).max(100),
        color: z.string().regex(OVERLAY_HEX_RE, "Geçersiz renk değeri.").optional(),
      })
    )
    .min(1)
    .max(SKILL_BAR_MAX_ITEMS),
});
const SkillBarBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("skill-bar"),
  data: SkillBarBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/** Frontend `types.ts::TEAM_MAX_MEMBERS`/`TEAM_MAX_SOCIAL_LINKS_PER_MEMBER` ile SAYISAL OLARAK
 *  BİREBİR AYNI. `socialLinks[].platform` — `SocialPlatformSchema` (`schemas/entities.ts`,
 *  site footer'ının "sosyal hesap linkleri" özelliğiyle AYNI kapalı küme, TEK kaynak). */
const TEAM_MAX_MEMBERS = 12;
const TEAM_MAX_SOCIAL_LINKS_PER_MEMBER = 5;

const TeamBlockDataSchema = z.object({
  members: z
    .array(
      z.object({
        id: z.string().min(1),
        photoUrl: z.string().min(1).max(2048).optional(),
        name: z.string().min(1).max(120),
        role: z.string().max(120).optional(),
        bio: z.string().max(1000).optional(),
        socialLinks: z
          .array(z.object({ id: z.string().min(1), platform: SocialPlatformSchema, url: SafeHrefSchema }))
          .max(TEAM_MAX_SOCIAL_LINKS_PER_MEMBER),
      })
    )
    .min(1)
    .max(TEAM_MAX_MEMBERS),
});
const TeamBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("team"),
  data: TeamBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- Gelişmiş Slider / Hero Studio — bkz. .claude/architect-scope-advanced-slider.md §3.5/§6.1 ---------- */

/**
 * Gelişmiş Slider bloğu — İÇERİK TAŞIMAZ, yalnızca REFERANS taşır (gerekçe:
 * `.claude/architect-scope-advanced-slider.md` §6.1). `sliderId` OPSİYONELDİR: yeni
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

/* ---------- Google Harita — bkz. .claude/architect-scope-google-map-corporate-blocks.md §2.1/§5
 * (mimar, BAĞLAYICI) ve .claude/security-review-google-map-corporate-blocks.md §2/§3/§7
 * (security-agent, mimarın §3.2/§3.4 önerisini SIKILAŞTIRIR/DEĞİŞTİRİR — çakışmada bu doküman
 * kazanır, bkz. .claude/CLAUDE.md "Çakışma Çözümü"). ---------- */

/**
 * Frontend `types.ts::GOOGLE_MAP_*` sabitleriyle SAYISAL OLARAK BİREBİR AYNI (mimar §2.1).
 * `GOOGLE_MAP_MIN_HEIGHT_PX`/`GOOGLE_MAP_DEFAULT_HEIGHT_PX`/`GOOGLE_MAP_DEFAULT_ZOOM` bu şemada
 * bir `.min()`/`.max()`/`.default()` argümanı olarak KULLANILMAZ (mimar §5/3 ve security-review
 * §3 ile tutarlı: `.default()` YASAK — bkz. §1.2 "geriye dönük uyumluluk sözleşmesi"; teknik
 * doğrulama tavanı `value.min(1).max(GOOGLE_MAP_MAX_HEIGHT_PX)`dir, `120` yalnızca frontend
 * editöründeki ÖNERİLEN/UX minimumudur) — burada yalnızca frontend'le sayısal parite ve
 * dokümantasyon amacıyla TANIMLANIRLAR.
 */
const GOOGLE_MAP_MIN_ZOOM = 1;
const GOOGLE_MAP_MAX_ZOOM = 20;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- frontend `types.ts` ile sayısal parite dokümantasyonu (mimar §2.1); şemada `.default()` olarak KULLANILMAZ.
const GOOGLE_MAP_DEFAULT_ZOOM = 15;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- frontend'deki ÖNERİLEN/UX minimumu (mimar §2.1); Zod'un teknik tavanı `.min(1)`dir, bkz. yukarıdaki yorum.
const GOOGLE_MAP_MIN_HEIGHT_PX = 120;
const GOOGLE_MAP_MAX_HEIGHT_PX = 2000;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- frontend `types.ts` ile sayısal parite dokümantasyonu (mimar §2.1); şemada `.default()` olarak KULLANILMAZ.
const GOOGLE_MAP_DEFAULT_HEIGHT_PX = 400;
const GOOGLE_MAP_MAX_HEIGHT_VH = 100;
const GOOGLE_MAP_MAX_ADDRESS_LENGTH = 300;
const GOOGLE_MAP_MAX_MARKER_TITLE_LENGTH = 120;

/**
 * `embedUrl` beyaz listesi — NİHAİ regex (`security-review-google-map-corporate-blocks.md` §2,
 * mimarın §3.2 taslağını SIKILAŞTIRIR: query karakter kara listesine backtick/backslash EKLENDİ).
 * AYNEN, karakter karakter, frontend `map-embed.ts`'teki kopyayla UYUMLU olmalıdır — TEK kaynak
 * budur. Case-insensitive DEĞİL (`i` bayrağı YOK) — BİLİNÇLİ, security-review §2 "Not" bölümü:
 * `i` bayrağı `HTTPS://GOOGLE.COM/...` gibi girdileri de kabul ederdi, bu sessizce genişleyen bir
 * saldırı yüzeyi olurdu. Yalnızca `google.com`/`www.google.com` host'u, yalnızca `https:`,
 * yalnızca `/maps/embed` (+ 5 sabit `/v1/<mod>` yolu) kabul edilir; bölgesel domainler
 * (`google.com.tr`), `maps.google.com`, `goo.gl`, userinfo-trick (`google.com@evil.com`), port
 * enjeksiyonu, backslash normalizasyonu, enum-prefix bypass (`/v1/placeholder`) hepsi REDDEDİLİR
 * (security-review §2'deki denetlenmiş senaryo listesi). `SafeHrefSchema` BURADA KULLANILMAZ —
 * o şema relative yol ve keyfi https host'u kabul eder, bir `<iframe src>` için YETERSİZDİR.
 */
const GOOGLE_MAP_EMBED_URL_RE =
  /^https:\/\/(?:www\.)?google\.com\/maps\/embed(?:\/v1\/(?:place|view|directions|search|streetview))?\?[^\s"'<>`\\]+$/;

/**
 * Kullanıcılar çoğunlukla Google'ın "Haritayı yerleştir" panelinden bare URL yerine tüm
 * `<iframe src="...">` HTML snippet'ini yapıştırıyor — bu yardımcı fonksiyon yalnızca `src`
 * değerini çıkarır, NİHAİ doğrulamayı DEĞİŞTİRMEZ: çıkarılan aday hâlâ aşağıdaki
 * `GOOGLE_MAP_EMBED_URL_RE` ile aynen doğrulanır.
 */
function extractGoogleMapEmbedUrlFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (!/<iframe/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  const srcValue = match?.[1];
  if (!srcValue) return trimmed;
  // Yalnızca `&amp;` çözülür (Google'ın snippet'i çoklu query param'da `&`'yi bu şekilde kaçırır);
  // genel HTML-entity decode'u (`&lt;`, `&quot;`, sayısal varlıklar vb.) aşağıdaki beyaz liste
  // regex'i için yeni bir bypass yüzeyi açar, bu yüzden BİLİNÇLİ olarak yapılmaz.
  return srcValue.replace(/&amp;/g, "&").trim();
}

const GoogleMapEmbedUrlSchema = z.preprocess(
  (val) => (typeof val === "string" ? extractGoogleMapEmbedUrlFromInput(val) : val),
  z
    .string()
    .min(1)
    .max(2048)
    .regex(
      GOOGLE_MAP_EMBED_URL_RE,
      "Yalnızca Google'ın \"Haritayı paylaş → Haritayı yerleştir\" panelinden alınan https://www.google.com/maps/embed... bağlantıları kabul edilir."
    )
);

/**
 * `{ value, unit }` — `ContainerLengthSchema`'nın YENİDEN KULLANILMAMASI bilinçli (mimar §5/3): o
 * şema `min(0).max(5000)` taşır ve `vh` tavanı YOKTUR. `unit === "vh"` iken `value`
 * `GOOGLE_MAP_MAX_HEIGHT_VH`'yi (100) AŞAMAZ — bu bir `.superRefine` ile uygulanır (Zod'da
 * çapraz-alan kısıtı `.max()` ile ifade edilemez).
 */
const GoogleMapHeightSchema = z
  .object({
    value: z.number().int().min(1).max(GOOGLE_MAP_MAX_HEIGHT_PX),
    unit: z.enum(["px", "vh"]).default("px"),
  })
  .superRefine((val, ctx) => {
    if (val.unit === "vh" && val.value > GOOGLE_MAP_MAX_HEIGHT_VH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"vh" birimiyle yükseklik en fazla ${GOOGLE_MAP_MAX_HEIGHT_VH} olabilir.`,
        path: ["value"],
      });
    }
  });

/**
 * Google Harita bloğu — YENİ (mimar §2.1). TÜM alanlar `.optional()`; `.superRefine` İLE
 * `embedUrl`/`address` ikisinin de zorunlu olması YOK — mimar §5/4: yeni eklenen boş blok anında
 * autosave edilir, 422 üretmek `advanced-slider`'ın "seçim yapılmamış blok" desenini kırardı.
 *
 * `apiKey` alanı KASITLI OLARAK YOKTUR ve EKLENMEYECEKTİR (mimar §3.1, security-review §1
 * "ONAYLANDI"): `Page.blocks` her `EDITOR` rolü tarafından yazılabilir/okunabilir VE public
 * `GET /pages/:slug` yanıtında ham JSON olarak döner — bu yüzeyde hiçbir sır tutulamaz. Anahtar
 * gerektiren embed URL'leri (`...&key=...`) `embedUrl`e OLDUĞU GİBİ yapıştırılır (Google'ın
 * "referrer-restricted public key" modeli zaten buna göre tasarlanmıştır).
 *
 * `zoom` aralık dışıysa 422 İLE REDDEDİLİR, CLAMP EDİLMEZ (security-review §3 — mimarın §3.3
 * metnindeki "clamp" ifadesiyle §5/4'teki `min/max` arasındaki çelişkiyi BAĞLAYICI şekilde çözer:
 * yazma anı = reddet, okuma/render anı = frontend `map-embed.ts`'te savunma amaçlı clamp).
 */
const GoogleMapBlockDataSchema = z.object({
  embedUrl: GoogleMapEmbedUrlSchema.optional(),
  address: z.string().max(GOOGLE_MAP_MAX_ADDRESS_LENGTH).optional(),
  zoom: z.number().int().min(GOOGLE_MAP_MIN_ZOOM).max(GOOGLE_MAP_MAX_ZOOM).optional(),
  height: GoogleMapHeightSchema.optional(),
  mapStyle: z.enum(["standard", "dark", "silver", "retro"]).optional(),
  markerTitle: z.string().max(GOOGLE_MAP_MAX_MARKER_TITLE_LENGTH).optional(),
});
const GoogleMapBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("google-map"),
  data: GoogleMapBlockDataSchema,
  reveal: RevealEffectSettingsSchema.optional(),
});

/* ---------- özyinelemeli düğüm — §5.4 ---------- */

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
 * "minimum diff" kararı KORUNUR; yalnızca `container`/`columns`/`gallery`/`heading`/`button`/
 * `icon-box`/`divider`/`image`/`video`/`accordion`/`tabs`/`cta`/`counter`/`testimonial`/
 * `pricing-table`/`latest-posts`/`contact-form`/`custom-html`/`before-after-slider`/
 * `logo-marquee`/`skill-bar`/`team`/`advanced-slider`/`google-map` dar şemaya girer (diğerleri —
 * `hero`/`text`/`featured-*` — ÖNCEDEN VAR OLAN bir boşluk olarak doğrulanmadan geçer, bu turun
 * kapsamı DEĞİL).
 *
 * ÖZYİNELEME GÜVENLİĞİ: bu şema `ContainerNodeSchema` üzerinden kendini çağırır. Derinlik
 * sınırı BURADA DEĞİL, `PageBlockListSchema` içindeki İTERATİF ön-taramada uygulanır (bkz.
 * tasarım notu §4.1/§4.2, `lib/page-blocks.ts::scanPageNodeStructure`) — buraya ulaşan veri
 * zaten derinlik ≤ `MAX_CONTAINER_DEPTH` garantilidir.
 *
 * NOT (TDZ): `ContainerNodeSchema`/`LegacyColumnsNodeSchema` referansları `.transform()` geri
 * çağrısının İÇİNDEDİR — modül yüklenirken değil, parse anında çözülürler. Bu yüzden `z.lazy()`
 * sarmalayıcısına gerek YOKTUR ve bildirim sırası (önce `PageNodeSchema`, sonra
 * `ContainerNodeSchema`) sorun çıkarmaz. `ContainerNodeSchema.children` içindeki
 * `z.array(PageNodeSchema)` ise modül yüklenirken çözülür ve `PageNodeSchema` o noktada
 * zaten tanımlıdır (aşağıdaki bildirim sırasına bağlıdır — DEĞİŞTİRİLMEMELİDİR).
 */
const PageNodeSchema: z.ZodType<unknown, z.ZodTypeDef, unknown> = z.record(z.unknown()).transform((node, ctx) => {
  const type = (node as Record<string, unknown>).type;
  if (type === "container") return applySubSchema(ContainerNodeSchema, node, ctx);
  if (type === "columns") return applySubSchema(LegacyColumnsNodeSchema, node, ctx);
  if (type === "gallery") return applySubSchema(GalleryBlockSchema, node, ctx);
  if (type === "heading") return applySubSchema(HeadingBlockSchema, node, ctx);
  if (type === "button") return applySubSchema(ButtonBlockSchema, node, ctx);
  if (type === "icon-box") return applySubSchema(IconBoxBlockSchema, node, ctx);
  if (type === "divider") return applySubSchema(DividerBlockSchema, node, ctx);
  if (type === "image") return applySubSchema(ImageBlockSchema, node, ctx);
  if (type === "video") return applySubSchema(VideoBlockSchema, node, ctx);
  if (type === "accordion") return applySubSchema(AccordionBlockSchema, node, ctx);
  if (type === "tabs") return applySubSchema(TabsBlockSchema, node, ctx);
  if (type === "cta") return applySubSchema(CtaBlockSchema, node, ctx);
  if (type === "counter") return applySubSchema(CounterBlockSchema, node, ctx);
  if (type === "testimonial") return applySubSchema(TestimonialBlockSchema, node, ctx);
  if (type === "pricing-table") return applySubSchema(PricingTableBlockSchema, node, ctx);
  if (type === "latest-posts") return applySubSchema(LatestPostsBlockSchema, node, ctx);
  if (type === "contact-form") return applySubSchema(ContactFormBlockSchema, node, ctx);
  if (type === "custom-html") return applySubSchema(CustomHtmlBlockSchema, node, ctx);
  if (type === "before-after-slider") return applySubSchema(BeforeAfterSliderBlockSchema, node, ctx);
  if (type === "logo-marquee") return applySubSchema(LogoMarqueeBlockSchema, node, ctx);
  if (type === "skill-bar") return applySubSchema(SkillBarBlockSchema, node, ctx);
  if (type === "team") return applySubSchema(TeamBlockSchema, node, ctx);
  if (type === "advanced-slider") return applySubSchema(AdvancedSliderBlockSchema, node, ctx);
  // KRİTİK (mimar §5/6 + §9 R2, security-review §7/5): bu dal EKSİK kalırsa `google-map` bloğu
  // HİÇ DOĞRULANMADAN geçer ve §2'deki `embedUrl` beyaz listesi TAMAMEN BAYPAS EDİLİR — bu
  // eklemenin en kritik satırıdır, bir regresyon testiyle AYRICA doğrulanır.
  if (type === "google-map") return applySubSchema(GoogleMapBlockSchema, node, ctx);
  return node;
});

const ContainerNodeSchema: z.ZodTypeAny = z.object({
  id: z.string().min(1),
  type: z.literal("container"),
  settings: ContainerSettingsSchema,
  children: z.array(PageNodeSchema).max(MAX_CHILDREN_PER_CONTAINER).default([]),
  reveal: RevealEffectSettingsSchema.optional(),
});

const LegacyColumnsNodeSchema: z.ZodTypeAny = z.preprocess(legacyColumnsToContainer, ContainerNodeSchema);

/* ---------- liste seviyesi: iteratif ön-tarama + byte tavanı + toplam sayım — §5.5 ---------- */

const MAX_PAGE_BLOCKS_BYTES = 256 * 1024;

/**
 * `blocks` alanı için TEK giriş noktası.
 *
 * (a) security-agent ZORUNLU düzeltmesi (§13.1) — tasarım notu §5.5'in İLK taslağında sıra
 * `byte tavanı (JSON.stringify) → scanPageNodeStructure` şeklinde yazılıydı; bu YANLIŞTIR ve
 * BURADA DÜZELTİLMİŞTİR. Gerekçe: `JSON.stringify` V8'de iç içe nesne/dizi için
 * ÖZYİNELEMELİDİR (parse'ın aksine — parse iteratif hale getirildi, stringify EDİLMEDİ). 256
 * KB'nin altında ama on binlerce seviye derin (`[[[[…]]]]` gibi minimal bir payload) bir
 * girdi, byte ölçümü SIRASINDA `RangeError` fırlatabilir — §4.1'de zod parse için tarif
 * edilen tehlikenin AYNISI, sadece bir adım erken devreye girer.
 *
 * DOĞRU/BAĞLAYICI SIRA: önce `scanPageNodeStructure` (tamamen iteratif, stack-safe, kendi
 * `ABSOLUTE_VISIT_CAP`'i var) çalışır; derinlik/toplam-düğüm/fan-out onaylandıktan SONRA
 * (ağaç artık küçük VE sığ garantilidir) `JSON.stringify` ile byte ölçümü yapılır. Ek savunma
 * (sıra ileride yanlışlıkla bozulursa bile kırılmasın diye): `JSON.stringify` çağrısı
 * `try/catch`'e alınır, olası bir `RangeError` 422'ye çevrilir — crash'e ASLA izin verilmez.
 * (Fastify'nin kendi gövde-JSON-parse aşamasının — bu kod çalışmadan ÖNCEki katman — aşırı
 * derin JSON'da `RangeError`'ı zaten 400'e çevirdiği doğrulandı: bkz.
 * `node_modules/fastify/lib/content-type-parser.js::defaultJsonParser`, `JSON.parse`
 * çağrısı zaten bir `try/catch` içinde ve HER hata — `SyntaxError` ile sınırlı değil —
 * `FST_ERR_CTP_INVALID_JSON_BODY` [400] olarak `done()`'a iletiliyor.)
 */
export const PageBlockListSchema = z
  .array(z.unknown())
  .superRefine((blocks, ctx) => {
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

    // Ağaç artık küçük VE sığ garantili — `JSON.stringify` BURADAN SONRA güvenlidir. `try/catch`
    // yine de defense-in-depth: sıra ileride yanlışlıkla bozulursa bile crash yerine 422 döner.
    let bytes: number;
    try {
      bytes = Buffer.byteLength(JSON.stringify(blocks), "utf8");
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "İçerik yapısı işlenemedi." });
      return z.NEVER;
    }
    if (bytes > MAX_PAGE_BLOCKS_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `blocks gövdesi en fazla ${MAX_PAGE_BLOCKS_BYTES / 1024} KB olabilir.`,
      });
      return z.NEVER;
    }
  })
  .pipe(z.array(PageNodeSchema));

// §9 backend-agent madde 5 — locale bazında `null` = çeviriyi SİL (bkz. openapi.yaml
// `ContentTranslations` açıklaması, lib/localization.ts::mergeTranslations).
//
// GÜVENLİK DÜZELTMESİ (§10.17, sonradan §10.19/v3'e taşındı) — bu şema önceden
// `fields.blocks`'un İÇERİĞİNE hiç bakmıyordu. `translations.<LOCALE>.blocks` üst seviye
// `blocks` alanıyla TAM OLARAK AYNI şemadan (`PageBlockListSchema` — derinlik/çocuk
// sayısı/toplam düğüm/byte tavanı VE `container`/`columns`/`gallery` şekil doğrulaması)
// geçirilir; aksi halde kötü niyetli/ele geçirilmiş bir EDITOR hesabı bu alana keyfi
// derinlikte/genişlikte içerik yerleştirip hem dokümante edilmiş sınırları atlatabilir hem de
// `flattenPageBlocks`/`sanitizePageBlocks` gibi tüketicileri kaynak tüketimine zorlayabilirdi.
// Hata yolları mevcut `["translations", locale, "blocks", ...]` deseniyle KORUNUR.
const TranslationsSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()).nullable())
  .superRefine((translations, ctx) => {
    for (const [locale, fields] of Object.entries(translations)) {
      if (!fields || !Array.isArray(fields.blocks)) continue;

      const parsedBlocks = PageBlockListSchema.safeParse(fields.blocks);
      if (!parsedBlocks.success) {
        for (const issue of parsedBlocks.error.issues) {
          ctx.addIssue({ ...issue, path: ["translations", locale, "blocks", ...issue.path] });
        }
      }
    }
  });

export const CreatePageRequestSchema = z
  .object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    status: PageStatusSchema.optional(),
    // §10.20/§6.1 — verilmezse `FREEFORM`. Bu ucun TAMAMI zaten `requireSiteRole(...ROLES_ADMIN)`
    // şartına tabidir (bkz. pages.routes.ts, `.claude/architect-scope-rbac-5-tier.md` §6.1),
    // bu yüzden burada ayrıca bir yetki kontrolü YOK.
    editMode: PageEditModeSchema.optional(),
    blocks: PageBlockListSchema.optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    // §10.2 Gelişmiş SEO & Social Card — boş string yerine `null` kabul edilir (frontend boşsa null gönderir).
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    // §5.1 hukuki belge istisnası — YALNIZCA SiteRole=ADMIN gönderebilir (EDITOR → 403, bkz.
    // pages.routes.ts::assertLegalDocumentAuthorized).
    isLegalDocument: z.boolean().optional(),
    // §10.5 Çoklu Dil & Yerelleştirme — bkz. shared-types.ts::PageTranslations.
    translations: TranslationsSchema.optional(),
    // §10.7 — verilmezse giriş yapmış kullanıcı atanır; BAŞKA bir id yalnızca ADMIN'e açıktır (bkz. lib/content-author.ts).
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);

/**
 * Faz 3 (autosave) — `POST /admin/pages/:pageId/autosave`. `UpdatePageRequestSchema`'nın
 * bilinçli olarak DAR bir alt kümesi: SEO/durum/slug/çeviri kapsam DIŞI. NOT: mimari kontrat
 * blog için `excerpt`/`contentHtml` alanlarını referans alıyor, ancak `Page` modelinde bu
 * alanlar YOK — sayfanın içerik alanı `blocks`'tur, bu yüzden burada `title`/`blocks`
 * kullanılır (aynı korumaya-değer-alan-seti niyeti, Page şemasına uyarlanmış hali). `blocks`
 * autosave'de de TAM `PageBlockListSchema`'dan geçer — autosave "gevşek" bir doğrulama YOLU
 * DEĞİLDİR (bkz. tasarım notu §9.2).
 */
export const AutosavePageRequestSchema = z.object({
  title: z.string().min(1).optional(),
  blocks: PageBlockListSchema.optional(),
});

export const UpdatePageRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    status: PageStatusSchema.optional(),
    // §10.20 — yalnızca `canUseAdvancedBuilder: true` olan kullanıcılar gönderebilir; standart
    // kullanıcı (`editMode: TEMPLATE` + gelişmiş DEĞİL) gönderirse route katmanında 403
    // (bkz. pages.routes.ts::assertAdvancedFieldsAuthorized, `isLegalDocument` ile AYNI desen).
    editMode: PageEditModeSchema.optional(),
    blocks: PageBlockListSchema.optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    ogTitle: z.string().nullable().optional(),
    ogImageUrl: z.string().nullable().optional(),
    canonicalUrl: z.string().url().nullable().optional(),
    noIndex: z.boolean().optional(),
    // §5.1 hukuki belge istisnası — YALNIZCA SiteRole=ADMIN gönderebilir (EDITOR → 403). Değeri
    // DEĞİŞTİREN her istek `content.legal_flag_change` audit kaydı üretir (bkz. pages.routes.ts).
    isLegalDocument: z.boolean().optional(),
    translations: TranslationsSchema.optional(),
    // §10.7 — yalnızca ADMIN değiştirebilir (EDITOR gönderirse 403); `null` = yazarı kaldır.
    authorId: z.string().uuid().nullable().optional(),
    // Faz 4 (zamanlanmış yayın) — bkz. schemas/common.ts::refineScheduledAt açıklaması.
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .refine(refineScheduledAt, SCHEDULED_AT_REFINEMENT);
