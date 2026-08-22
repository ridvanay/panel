import {
  DEFAULT_CONTAINER_SETTINGS,
  MAX_DIVIDER_HEIGHT,
  MIN_DIVIDER_HEIGHT,
  type ContainerAlign,
  type ContainerBackground,
  type ContainerBackgroundOverlay,
  type ContainerBackgroundPosition,
  type ContainerBackgroundRepeat,
  type ContainerBackgroundSize,
  type ContainerJustify,
  type ContainerLength,
  type ContainerNode,
  type ContainerSettings,
  type ContainerSpacing,
  type LinearGradientDirection,
  type PageNode,
  type RevealDelay,
  type RevealDuration,
  type RevealEffect,
  type RevealEffectSettings,
  type ShapeDividerSettings,
  type ShapeDividerType,
} from "./types";

/**
 * Ham (GET'ten gelen, re-validate EDİLMEMİŞ) `blocks` JSON'unu kanonik `PageNode[]`'a çevirir.
 * TAM OLARAK İKİ giriş noktasından çağrılmalıdır:
 *   1) admin editör sayfayı builder state'ine yüklerken,
 *   2) public render kökünde (`BlockRenderer`'ın çağrıldığı sayfa bileşenleri).
 * Aşağı akıştaki HİÇBİR bileşen legacy şekil görmemelidir — `resolveColumnWidth` gibi dağıtık
 * savunmacı okuma şimlerine v3'te gerek YOKTUR (mantık bu dosyanın legacy dalına taşındı).
 *
 * Kurallar (bkz. `.claude/design-notes-page-builder-containers.md` §7.2):
 * - `columns` → `legacyColumnsToContainer` (backend `pages.schemas.ts::legacyColumnsToContainer`
 *   ile BİREBİR aynı eşleme).
 * - Eksik `settings` alanları → `DEFAULT_CONTAINER_SETTINGS`'ten tamamlanır.
 * - Eksik/geçersiz `id` → deterministik olmayan bir `newId()` ÜRETİLMEZ; bunun yerine ziyaret
 *   sırasına dayalı stabil bir fallback (`__n{sıra}`) kullanılır — aksi halde her render'da yeni
 *   key üretilip React ağacı gereksiz yere sıfırlanır.
 * - Tanınmayan `type` → düğüm KORUNUR ve olduğu gibi geçirilir (ileri uyumluluk); `BlockRenderer`
 *   bilinmeyen tipi sessizce `null` render eder.
 * - Fonksiyon derinlik sayaçlıdır (`NORMALIZE_DEPTH_SAFETY_CAP`) — bozuk/patolojik derinlikte
 *   elle üretilmiş veriye karşı çağrı yığınını korur (backend'deki iteratif tarama ile aynı
 *   gerekçe, burada JS çağrı yığını `MAX_CONTAINER_DEPTH`'in çok üzerinde bir tavanla sınırlanır).
 */
export function normalizePageNodes(raw: unknown): PageNode[] {
  const ctx: NormalizeCtx = { counter: { value: 0 } };
  const arr = Array.isArray(raw) ? raw : [];
  return normalizeNodeList(arr, ctx, 1);
}

/** Patolojik derinlik güvenlik ağı — gerçek sayfalar `MAX_CONTAINER_DEPTH` (4) ile sınırlıdır. */
const NORMALIZE_DEPTH_SAFETY_CAP = 64;

interface NormalizeCtx {
  counter: { value: number };
}

function fallbackId(ctx: NormalizeCtx): string {
  const id = `__n${ctx.counter.value}`;
  ctx.counter.value += 1;
  return id;
}

function normalizeNodeList(list: unknown[], ctx: NormalizeCtx, depth: number): PageNode[] {
  return list.map((item) => normalizeNode(item, ctx, depth));
}

function normalizeNode(raw: unknown, ctx: NormalizeCtx, depth: number): PageNode {
  if (!raw || typeof raw !== "object") {
    // Bozuk veri (dizi elemanı obje değil) — anlamlı bir düğüme çeviremeyiz; ağacı kırmamak için
    // görünmez boş bir metin bloğuna düşülür (render'da hiçbir şey göstermez).
    return { id: fallbackId(ctx), type: "text", data: { html: "" } };
  }

  const node = raw as Record<string, unknown>;

  if (depth > NORMALIZE_DEPTH_SAFETY_CAP) {
    // Güvenlik ağı — patolojik derinlikte çağrı yığınını korumak için daha derine İNMEYİZ.
    const id = typeof node.id === "string" && node.id.length > 0 ? node.id : fallbackId(ctx);
    return { ...node, id } as PageNode;
  }

  if (node.type === "container") return normalizeContainerNode(node, ctx, depth);
  if (node.type === "columns") return legacyColumnsToContainer(node, ctx, depth);

  // Tanınan içerik blokları (data şekli DEĞİŞMEDİ) + tanınmayan tipler — yalnızca id normalize
  // edilir, geri kalanı olduğu gibi geçirilir.
  const id = typeof node.id === "string" && node.id.length > 0 ? node.id : fallbackId(ctx);
  return { ...node, id } as PageNode;
}

/**
 * Giriş Animasyonu (Scroll Reveal) — `BaseNode.reveal` normalizasyonu.
 *
 * BUG DÜZELTMESİ (qa-agent E2E, `admin-page-builder-editing-tools.spec.ts`): `normalizeContainerNode`
 * döndürdüğü nesne `{ id, type: "container", settings, children }` idi — `reveal` HİÇ taşınmıyordu.
 * Backend'e doğru kaydediliyor (round-trip doğrulandı) ama bu fonksiyon HEM admin-reload'da HEM
 * public render kökünde çağrıldığı için (bkz. dosya başlığı), bir KONTEYNERE uygulanan efekt her
 * reload'da/public'te sessizce KAYBOLUYORDU. İçerik blokları (`{...node, id}` generic spread yolu)
 * bu hataya TABİ DEĞİLDİ — yalnızca konteyner düğümleri kendi alanlarını TEK TEK seçtiği için
 * (`normalizeContainerSettings` ile AYNI "alanlar açıkça listelenir" deseni) etkilendi.
 *
 * `"none"` efekti `undefined` ile davranışsal olarak AYNI (bkz. `types.ts::RevealEffectSettings`
 * yorumu) — burada da `undefined`'a normalize edilir, aşağı akıştaki "hasEffect" kontrollerini
 * tek bir forma indirger.
 */
/** v2 tasarım notları §3.8 — `fade-down`/`slide-right`/`flip-up` YENİ üyeler (`types.ts::RevealEffect`). */
function isRevealEffect(v: unknown): v is RevealEffect {
  return (
    v === "none" ||
    v === "fade-in" ||
    v === "fade-up" ||
    v === "fade-down" ||
    v === "slide-left" ||
    v === "slide-right" ||
    v === "zoom-in" ||
    v === "flip-up"
  );
}

/** v2 tasarım notları §3.3 — 0-1000ms, 100ms adım (11 durak, `<input type="range">`). */
function isRevealDelay(v: unknown): v is RevealDelay {
  return v === 0 || v === 100 || v === 200 || v === 300 || v === 400 || v === 500 || v === 600 || v === 700 || v === 800 || v === 900 || v === 1000;
}

/** v2 tasarım notları §3.4 — Hızlı/Normal/Yavaş (opsiyonel alan, bkz. `normalizeReveal`). */
function isRevealDuration(v: unknown): v is RevealDuration {
  return v === 300 || v === 600 || v === 1000;
}

function normalizeReveal(raw: unknown): RevealEffectSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!isRevealEffect(r.effect) || r.effect === "none") return undefined;
  if (!isRevealDelay(r.delayMs)) return undefined;
  const settings: RevealEffectSettings = { effect: r.effect, delayMs: r.delayMs };
  // `durationMs`/`once` OPSİYONEL (§3.8) — geçersiz/eksikse SESSİZCE atlanır, `RevealEffectControl`/
  // `ScrollReveal` KENDİ varsayılanlarına (`?? 600` / `?? true`) düşer, hata ÜRETİLMEZ.
  if (isRevealDuration(r.durationMs)) settings.durationMs = r.durationMs;
  if (typeof r.once === "boolean") settings.once = r.once;
  return settings;
}

function normalizeContainerNode(node: Record<string, unknown>, ctx: NormalizeCtx, depth: number): ContainerNode {
  const id = typeof node.id === "string" && node.id.length > 0 ? node.id : fallbackId(ctx);
  const settings = normalizeContainerSettings(node.settings);
  const rawChildren = Array.isArray(node.children) ? node.children : [];
  const children = normalizeNodeList(rawChildren, ctx, depth + 1);
  const reveal = normalizeReveal(node.reveal);
  return reveal ? { id, type: "container", settings, children, reveal } : { id, type: "container", settings, children };
}

// ---------------------------------------------------------------------------
// legacy `columns` → kanonik `container` — backend `legacyColumnsToContainer` ile BİREBİR aynı
// eşleme (bkz. mimar dokümanı §5.4). Geometrik parite: dış sarmalayıcı `mx-auto max-w-5xl px-4
// py-4 sm:px-6` → `layout: "boxed"`, `customWidth: 1024` (= max-w-5xl), `padding: {top:16,bottom:16}`
// (yatay `px-4 sm:px-6` gutter'ı `boxed` modunun YAPISAL gutter'ıdır, `padding`'e YAZILMAZ).
// ---------------------------------------------------------------------------

const LEGACY_GAP_PX: Record<string, number> = { none: 0, sm: 8, md: 16, lg: 32 };
const LEGACY_ALIGN: Record<string, ContainerAlign> = { top: "start", center: "center", bottom: "end" };
const ZERO_SPACING: ContainerSpacing = { top: 0, right: 0, bottom: 0, left: 0 };

/** v1 `ratio` → per-sütun ağırlık (backend `legacyRatioToWidths` ile AYNEN aynı). */
function legacyRatioToWidths(ratio: unknown, count: number): number[] {
  if (ratio === "2-1") return [2, 1];
  if (ratio === "1-2") return [1, 2];
  return Array.from({ length: count }, () => 1);
}

function legacyColumnsToContainer(node: Record<string, unknown>, ctx: NormalizeCtx, depth: number): ContainerNode {
  const data = (node.data && typeof node.data === "object" ? node.data : {}) as Record<string, unknown>;
  const rawColumns = Array.isArray(data.columns) ? data.columns : [];
  const widths = legacyRatioToWidths(data.ratio, rawColumns.length);
  const gapPx = LEGACY_GAP_PX[String(data.gap)] ?? 16;
  const alignItems = LEGACY_ALIGN[String(data.verticalAlign)] ?? "start";
  const id = typeof node.id === "string" && node.id.length > 0 ? node.id : fallbackId(ctx);

  const children: PageNode[] = rawColumns.map((column, index) => {
    const col = (column && typeof column === "object" ? column : {}) as Record<string, unknown>;
    const colId = typeof col.id === "string" && col.id.length > 0 ? col.id : fallbackId(ctx);
    const rawBlocks = Array.isArray(col.blocks) ? col.blocks : [];
    const widthFr = typeof col.width === "number" && col.width > 0 ? col.width : (widths[index] ?? 1);

    const container: ContainerNode = {
      id: colId,
      type: "container",
      settings: {
        layout: "full-width",
        direction: "column",
        justifyContent: "start",
        alignItems: "stretch",
        gap: gapPx,
        padding: ZERO_SPACING,
        margin: ZERO_SPACING,
        background: { type: "none" },
        widthFr,
      },
      children: normalizeNodeList(rawBlocks, ctx, depth + 2),
    };
    return container;
  });

  return {
    id,
    type: "container",
    settings: {
      layout: "boxed",
      customWidth: 1024,
      direction: "row",
      justifyContent: "start",
      alignItems,
      gap: gapPx,
      padding: { top: 16, right: 0, bottom: 16, left: 0 },
      margin: ZERO_SPACING,
      background: { type: "none" },
    },
    children,
  };
}

// ---------------------------------------------------------------------------
// `ContainerSettings` alan-bazlı normalizasyon — eksik/geçersiz alanlar
// `DEFAULT_CONTAINER_SETTINGS`'ten tamamlanır.
// ---------------------------------------------------------------------------

function isJustify(v: unknown): v is ContainerJustify {
  return v === "start" || v === "center" || v === "end" || v === "between" || v === "around" || v === "evenly";
}

function isAlign(v: unknown): v is ContainerAlign {
  return v === "stretch" || v === "start" || v === "center" || v === "end";
}

function isBgPosition(v: unknown): v is ContainerBackgroundPosition {
  return v === "center" || v === "top" || v === "bottom" || v === "left" || v === "right";
}

function isBgSize(v: unknown): v is ContainerBackgroundSize {
  return v === "cover" || v === "contain" || v === "auto";
}

function isBgRepeat(v: unknown): v is ContainerBackgroundRepeat {
  return v === "no-repeat" || v === "repeat";
}

function normalizeSpacingSide(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function normalizeSpacing(raw: unknown): ContainerSpacing {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    top: normalizeSpacingSide(s.top),
    right: normalizeSpacingSide(s.right),
    bottom: normalizeSpacingSide(s.bottom),
    left: normalizeSpacingSide(s.left),
  };
}

function normalizeContainerLength(raw: unknown): ContainerLength | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const l = raw as Record<string, unknown>;
  if (typeof l.value !== "number" || !Number.isFinite(l.value) || l.value < 0) return undefined;
  return { value: l.value, unit: l.unit === "vh" ? "vh" : "px" };
}

/** Gradient/animated/overlay renkleri için — backend `OVERLAY_HEX_RE` ile AYNI (6 hane, alfa YOK). */
const HEX_COLOR_6_RE = /^#[0-9a-fA-F]{6}$/;
function isHexColor6(v: unknown): v is string {
  return typeof v === "string" && HEX_COLOR_6_RE.test(v);
}

/**
 * Şekilli Bölüm Ayırıcıları — `topDivider`/`bottomDivider` normalizasyonu.
 *
 * BUG DÜZELTMESİ (qa-agent E2E, `admin-page-builder-editing-tools.spec.ts`): `normalizeContainerSettings`
 * bu iki alanı HİÇ okumuyordu — backend'e doğru kaydediliyor (round-trip doğrulandı) ama bu
 * fonksiyon HEM admin-reload'da HEM public render kökünde çağrıldığı için (bkz. dosya başlığı),
 * kullanıcının seçtiği ayırıcı HER reload'da/public'te sessizce SİLİNİYORDU (public'te SVG hiçbir
 * zaman render edilmiyordu). `topDivider`/`bottomDivider` OPSİYONEL alanlardır (`undefined` =
 * kapalı, bkz. `types.ts`) — diğer opsiyonel alanlarla (`minHeight`, `background.overlay`) AYNI
 * "geçersiz/eksik → undefined" deseni: kısmi/bozuk bir ayırıcı nesnesi SESSİZCE yanlış render
 * etmek yerine tamamen KAPALI sayılır (`normalizeContainerLength`/`normalizeOverlay` ile AYNI
 * gerekçe).
 */
function isShapeDividerType(v: unknown): v is ShapeDividerType {
  return v === "wave" || v === "slant" || v === "triangle" || v === "curve";
}

function normalizeShapeDivider(raw: unknown): ShapeDividerSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  if (!isShapeDividerType(d.type)) return undefined;
  if (!isHexColor6(d.color)) return undefined;
  if (typeof d.height !== "number" || !Number.isFinite(d.height) || d.height < MIN_DIVIDER_HEIGHT || d.height > MAX_DIVIDER_HEIGHT) {
    return undefined;
  }
  return { type: d.type, color: d.color, height: d.height, flip: d.flip === true };
}

const LINEAR_GRADIENT_DIRECTIONS = new Set<string>([
  "to-top",
  "to-top-right",
  "to-right",
  "to-bottom-right",
  "to-bottom",
  "to-bottom-left",
  "to-left",
  "to-top-left",
  "custom-angle",
]);
function isLinearGradientDirection(v: unknown): v is LinearGradientDirection {
  return typeof v === "string" && LINEAR_GRADIENT_DIRECTIONS.has(v);
}

function normalizeOverlay(raw: unknown): ContainerBackgroundOverlay | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!isHexColor6(o.color)) return undefined;
  const opacity = typeof o.opacity === "number" && Number.isFinite(o.opacity) ? Math.max(0, Math.min(100, Math.round(o.opacity))) : 0;
  return { color: o.color, opacity };
}

/**
 * GÜVENLİK/VERİ BÜTÜNLÜĞÜ DÜZELTMESİ — bu fonksiyon ÖNCEDEN yalnızca `"color"`/`"image"`
 * tiplerini TANIYORDU (Faz "Konteyner Görsel Widget'ları" ÖNCESİ kalıntı). `"gradient"`/
 * `"animated"` bilinmeyen sayılıp SESSİZCE `{ type: "none" }`e düşürülüyordu — hem admin
 * editöründeki CANLI ÖNİZLEME hem PUBLIC RENDER bu fonksiyondan geçtiği için (bkz. dosya
 * başlığı, "TAM OLARAK İKİ giriş noktası"), backend'in doğru kaydettiği bir gradient/animasyonlu
 * arka plan HİÇBİR YERDE görünmüyordu.
 */
function normalizeBackground(raw: unknown): ContainerBackground {
  if (!raw || typeof raw !== "object") return { type: "none" };
  const b = raw as Record<string, unknown>;
  if (b.type === "color" && typeof b.value === "string") return { type: "color", value: b.value };
  if (b.type === "image" && typeof b.value === "string") {
    return {
      type: "image",
      value: b.value,
      position: isBgPosition(b.position) ? b.position : "center",
      size: isBgSize(b.size) ? b.size : "cover",
      repeat: isBgRepeat(b.repeat) ? b.repeat : "no-repeat",
      overlay: normalizeOverlay(b.overlay),
    };
  }
  if (b.type === "gradient" && isHexColor6(b.colorFrom) && isHexColor6(b.colorTo)) {
    return {
      type: "gradient",
      gradientType: b.gradientType === "radial" ? "radial" : "linear",
      colorFrom: b.colorFrom,
      colorTo: b.colorTo,
      direction: isLinearGradientDirection(b.direction) ? b.direction : undefined,
      angle: typeof b.angle === "number" && Number.isFinite(b.angle) ? Math.max(0, Math.min(360, Math.round(b.angle))) : undefined,
    };
  }
  if (b.type === "animated") {
    if (b.variant === "gradient-wave" && isHexColor6(b.colorFrom) && isHexColor6(b.colorTo)) {
      return { type: "animated", variant: "gradient-wave", colorFrom: b.colorFrom, colorTo: b.colorTo };
    }
    if ((b.variant === "dots" || b.variant === "grid") && isHexColor6(b.patternColor)) {
      return { type: "animated", variant: b.variant, patternColor: b.patternColor };
    }
  }
  return { type: "none" };
}

function normalizeContainerSettings(raw: unknown): ContainerSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    layout: s.layout === "full-width" ? "full-width" : DEFAULT_CONTAINER_SETTINGS.layout,
    customWidth: typeof s.customWidth === "number" && Number.isFinite(s.customWidth) ? s.customWidth : undefined,
    minHeight: normalizeContainerLength(s.minHeight),
    direction: s.direction === "row" ? "row" : DEFAULT_CONTAINER_SETTINGS.direction,
    justifyContent: isJustify(s.justifyContent) ? s.justifyContent : DEFAULT_CONTAINER_SETTINGS.justifyContent,
    alignItems: isAlign(s.alignItems) ? s.alignItems : DEFAULT_CONTAINER_SETTINGS.alignItems,
    gap: typeof s.gap === "number" && Number.isFinite(s.gap) && s.gap >= 0 ? s.gap : DEFAULT_CONTAINER_SETTINGS.gap,
    padding: normalizeSpacing(s.padding),
    margin: normalizeSpacing(s.margin),
    background: normalizeBackground(s.background),
    widthFr: typeof s.widthFr === "number" && Number.isFinite(s.widthFr) && s.widthFr > 0 ? s.widthFr : undefined,
    topDivider: normalizeShapeDivider(s.topDivider),
    bottomDivider: normalizeShapeDivider(s.bottomDivider),
  };
}
