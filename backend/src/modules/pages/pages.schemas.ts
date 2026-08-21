import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";
import { refineScheduledAt, SCHEDULED_AT_REFINEMENT } from "../../schemas/common";
import { scanPageNodeStructure, MAX_CONTAINER_DEPTH, MAX_CHILDREN_PER_CONTAINER, MAX_TOTAL_PAGE_NODES } from "../../lib/page-blocks";

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
// KASITLI: baştaki kontrol karakterlerini (0x00-0x1f) tolerans olarak eşleştirmek bu
// regex'in güvenlik amacıdır (§13.3) — devre dışı BIRAKILAMAZ.
// eslint-disable-next-line no-control-regex
const DANGEROUS_URL_SCHEME_RE = /^[\s\u0000-\u001f]*(javascript|vbscript|data):/i;
const SAFE_ABSOLUTE_URL_RE = /^https?:\/\//i;

/**
 * `value` yalnızca `/` ile başlayan (relative) ya da `https://`/`http://` ile başlayan bir URL
 * olabilir; VE karakter kara listesinden VE tehlikeli protokol beyaz-liste ihlalinden geçmelidir.
 */
function isSafeContainerBackgroundImageUrl(value: string): boolean {
  if (CSS_URL_UNSAFE_RE.test(value)) return false;
  if (DANGEROUS_URL_SCHEME_RE.test(value)) return false;
  return value.startsWith("/") || SAFE_ABSOLUTE_URL_RE.test(value);
}

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
    }),
  ])
  .default({ type: "none" });

/**
 * `minHeight` KASITLI OLARAK serbest bir `string` DEĞİLDİR (§5.3 — mimarın kullanıcı isteğini
 * reddetmesi). `settings`'in tamamı render motorunda inline `style` nesnesine beslenir; serbest
 * bir string CSS enjeksiyon yüzeyi olur ve `sanitizePageBlocks` yalnızca `data.html`'e bakar,
 * `settings`'e HİÇ bakmaz (§3.3). `{ value: number; unit: "px" | "vh" }` ile enjeksiyon
 * YAPISAL OLARAK İMKÂNSIZ hale gelir. Aynı ilke `gap`/`padding`/`margin`/`customWidth` için de
 * geçerlidir — hiçbiri string değildir.
 */
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
});

/* ---------- §Faz "Temel Elemanlar" — Başlık/Buton/İkon Kutusu/Ayırıcı (yeni) ---------- */

/**
 * Buton/İkon Kutusu `href` alanı — `isSafeContainerBackgroundImageUrl` ile AYNI protokol
 * güvenlik gerekçesi (yalnızca relative veya http(s) mutlak, `javascript:`/`vbscript:`/`data:`
 * YASAK), ama CSS `url("…")` bağlamına YERLEŞMEDİĞİ için `CSS_URL_UNSAFE_RE` karakter kara
 * listesi burada uygulanmaz (bir `href` boşluk/parantez İÇEREBİLİR, tırnak-kaçışı riski yok).
 */
function isSafeHref(value: string): boolean {
  if (DANGEROUS_URL_SCHEME_RE.test(value)) return false;
  return value.startsWith("/") || SAFE_ABSOLUTE_URL_RE.test(value);
}
const SafeHrefSchema = z.string().min(1).max(2048).refine(isSafeHref, "Bağlantı güvensiz bir protokol içeriyor.");

const HeadingBlockDataSchema = z.object({
  text: z.string().min(1).max(300),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).default(2),
  align: z.enum(["left", "center", "right"]).default("left"),
  underline: z.boolean().default(false),
});
const HeadingBlockSchema = z.object({ id: z.string().min(1), type: z.literal("heading"), data: HeadingBlockDataSchema });

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
const ButtonBlockSchema = z.object({ id: z.string().min(1), type: z.literal("button"), data: ButtonBlockDataSchema });

const IconBoxBlockDataSchema = z.object({
  icon: z.string().min(1).max(40),
  heading: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  href: SafeHrefSchema.optional(),
});
const IconBoxBlockSchema = z.object({ id: z.string().min(1), type: z.literal("icon-box"), data: IconBoxBlockDataSchema });

/** Ayırıcı VE Boşluk TEK blok tipi — `variant` ayrımlar (bkz. frontend `types.ts::DividerBlock`). */
const DividerBlockDataSchema = z.object({
  variant: z.enum(["line", "space"]).default("line"),
  style: z.enum(["solid", "dashed"]).default("solid"),
  height: z.number().min(0).max(400).default(32),
});
const DividerBlockSchema = z.object({ id: z.string().min(1), type: z.literal("divider"), data: DividerBlockDataSchema });

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
const ImageBlockSchema = z.object({ id: z.string().min(1), type: z.literal("image"), data: ImageBlockDataSchema });

/**
 * Video bloğu — `url` `SafeHrefSchema` ile doğrulanır (relative veya http(s) mutlak,
 * `javascript:`/`data:` YASAK). ID ÇIKARIMI/embed URL İNŞASI yalnızca frontend'de yapılır
 * (`lib/page-builder/video-embed.ts`) — backend ham `url`i OLDUĞU GİBİ saklar, bir iframe'e
 * DOĞRUDAN YAZILMAZ (bkz. o dosyanın başlığı, "yapılandırılmış embed" güvenlik deseni).
 */
const VideoBlockDataSchema = z.object({
  provider: z.enum(["youtube", "vimeo", "mp4"]).default("youtube"),
  url: SafeHrefSchema,
  autoplay: z.boolean().default(false),
  muted: z.boolean().default(false),
});
const VideoBlockSchema = z.object({ id: z.string().min(1), type: z.literal("video"), data: VideoBlockDataSchema });

/** Frontend `types.ts::ACCORDION_MAX_ITEMS`/`TABS_MAX_ITEMS` ile SAYISAL OLARAK BİREBİR AYNI. */
const ACCORDION_MAX_ITEMS = 20;
const TABS_MAX_ITEMS = 10;

/** Akordiyon / SSS — `answer` KASITLI OLARAK düz metin (HTML DEĞİL, bkz. frontend tip yorumu). */
const AccordionBlockDataSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1).max(300),
        answer: z.string().max(3000),
      })
    )
    .max(ACCORDION_MAX_ITEMS),
  allowMultipleOpen: z.boolean().default(false),
});
const AccordionBlockSchema = z.object({ id: z.string().min(1), type: z.literal("accordion"), data: AccordionBlockDataSchema });

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
const TabsBlockSchema = z.object({ id: z.string().min(1), type: z.literal("tabs"), data: TabsBlockDataSchema });

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
const CtaBlockSchema = z.object({ id: z.string().min(1), type: z.literal("cta"), data: CtaBlockDataSchema });

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
const CounterBlockSchema = z.object({ id: z.string().min(1), type: z.literal("counter"), data: CounterBlockDataSchema });

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
const TestimonialBlockSchema = z.object({ id: z.string().min(1), type: z.literal("testimonial"), data: TestimonialBlockDataSchema });

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
});
const PricingTableBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal("pricing-table"),
  data: PricingTableBlockDataSchema,
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
 * `pricing-table` dar şemaya girer (diğerleri — `hero`/`text`/`featured-*` — ÖNCEDEN VAR OLAN
 * bir boşluk olarak doğrulanmadan geçer, bu turun kapsamı DEĞİL).
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
  return node;
});

const ContainerNodeSchema: z.ZodTypeAny = z.object({
  id: z.string().min(1),
  type: z.literal("container"),
  settings: ContainerSettingsSchema,
  children: z.array(PageNodeSchema).max(MAX_CHILDREN_PER_CONTAINER).default([]),
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
