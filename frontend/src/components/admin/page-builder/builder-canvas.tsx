"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Ban,
  Columns2,
  Columns3,
  Columns4,
  Copy,
  Ellipsis,
  Eye,
  FlipVertical2,
  FolderPlus,
  GripVertical,
  LayoutTemplate,
  Monitor,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PanelTop,
  RotateCcw,
  Rows2,
  Settings2,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Unlink2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { blockRegistry, createBlock, type PaletteBlockType } from "@/lib/page-builder/registry";
import { LAYOUT_PRESETS, createContainerFromPreset, type LayoutPreset } from "@/lib/page-builder/presets";
import {
  containerDepth,
  containerIdOf,
  countNodes,
  duplicateNode,
  findNode,
  findParentId,
  getContainerChildIds,
  getContainerChildren,
  insertNode,
  isContainerAtCapacity,
  moveNode,
  needsConfirmToUnwrap,
  removeNode,
  setContainerChildren,
  subtreeDepth,
  toContainerId,
  unwrapContainer,
  updateNode,
  wrapInContainer,
} from "@/lib/page-builder/containers";
import {
  MAX_CHILDREN_PER_CONTAINER,
  MAX_CONTAINER_DEPTH,
  MAX_TOTAL_PAGE_NODES,
  ROW_CHILDREN_READABILITY_WARNING_THRESHOLD,
  type BuilderContainerId,
  type ContainerNode,
  type ContentBlock,
  type DeviceMode,
  type PageNode,
  type RevealDelay,
  type RevealDuration,
  type RevealEffect,
  type RevealEffectSettings,
} from "@/lib/page-builder/types";
import { SegmentedToggle } from "./blocks/segmented-toggle";
import { LayoutMenu } from "./layout-menu";
import { AddContentMenu, EmptyContainerDropZone } from "./add-content-menu";
import { BetweenContainersInserter, LayoutPresetPopoverGrid, NewContainerInserter } from "./container-inserter";
import { HeroBlockEditor } from "./blocks/hero-block";
import { TextBlockEditor } from "./blocks/text-block";
import { ImageBlockEditor } from "./blocks/image-block";
import { GalleryBlockEditor } from "./blocks/gallery-block";
import { CtaBlockEditor } from "./blocks/cta-block";
import { FeaturedProductsBlockEditor } from "./blocks/featured-products-block";
import { FeaturedPortfolioBlockEditor } from "./blocks/featured-portfolio-block";
import { HeadingBlockEditor } from "./blocks/heading-block";
import { ButtonBlockEditor } from "./blocks/button-block";
import { IconBoxBlockEditor } from "./blocks/icon-box-block";
import { DividerBlockEditor } from "./blocks/divider-block";
import { VideoBlockEditor } from "./blocks/video-block";
import { AccordionBlockEditor } from "./blocks/accordion-block";
import { TabsBlockEditor } from "./blocks/tabs-block";
import { CounterBlockEditor } from "./blocks/counter-block";
import { TestimonialBlockEditor } from "./blocks/testimonial-block";
import { PricingTableBlockEditor } from "./blocks/pricing-table-block";
import { LatestPostsBlockEditor } from "./blocks/latest-posts-block";
import { ContactFormBlockEditor } from "./blocks/contact-form-block";
import { CustomHtmlBlockEditor } from "./blocks/custom-html-block";
import { BeforeAfterSliderBlockEditor } from "./blocks/before-after-slider-block";
import { LogoMarqueeBlockEditor } from "./blocks/logo-marquee-block";
import { SkillBarBlockEditor } from "./blocks/skill-bar-block";
import { TeamBlockEditor } from "./blocks/team-block";
import { AdvancedSliderBlockEditor } from "./blocks/advanced-slider-block";
import { GoogleMapBlockEditor } from "./blocks/google-map-block";

/**
 * §2.4 mimar dokümanı — ÖZYİNELEMELİ editör ağacı. v2'nin iki-seviyeli (kök + sütun) sabit
 * yapısının yerini, herhangi bir derinlikte (`MAX_CONTAINER_DEPTH` = 4'e kadar) iç içe geçebilen
 * `container` düğümleri alır. Tek `DndContext` en dışta kalır (`closestCorners` KORUNUR); her
 * konteyner kendi `SortableContext`'ini + (yalnızca BOŞKEN) `useDroppable`'ını taşır.
 */

function nodeLabel(node: PageNode): string {
  return node.type === "container" ? "Konteyner" : blockRegistry[node.type].label;
}

/**
 * Cihaz Önizleme Çubuğu — `.claude/design-notes-page-builder-editing-tools.md` §1 BİREBİR.
 * `device` state'i `BuilderCanvas`'ın KENDİ yerel state'i (kayıtlı veriyi ETKİLEMEZ, bkz.
 * `types.ts::DeviceMode`). Paylaşılan `SegmentedToggle` (`blocks/segmented-toggle.tsx`) import
 * edilir — YENİ bir yerel kopya YAZILMAZ (§1.2).
 */
const DEVICE_OPTIONS: { value: DeviceMode; label: string; icon: LucideIcon }[] = [
  { value: "desktop", label: "Masaüstü", icon: Monitor },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "mobile", label: "Mobil", icon: Smartphone },
];

function DevicePreviewBar({ device, onChange }: { device: DeviceMode; onChange: (d: DeviceMode) => void }) {
  return (
    <div className="mb-4 flex items-center justify-center gap-2">
      <SegmentedToggle value={device} options={DEVICE_OPTIONS} onChange={onChange} />
      {device !== "desktop" && <Badge tone="neutral" size="sm">{device === "tablet" ? "768px" : "375px"}</Badge>}
    </div>
  );
}

/** §1.6 — sade `max-width` + `mx-auto`, cihaz kenarlığı/gölge simülasyonu YOK (kesin karar). */
function canvasWidthClass(device: DeviceMode) {
  return cn(
    "mx-auto w-full transition-all duration-300",
    device === "tablet" && "max-w-[768px] border-x border-dashed border-border/40 px-2",
    device === "mobile" && "max-w-[375px] border-x border-dashed border-border/40 px-2"
  );
}

/** §3.9 — karoların `title`/`aria-label`'ı için "uzun etiket" kaynağı (v1'in `Select` etiketleri
 *  buradan devraldı; veri YAPISI aynı kalır, amacı değişir — bkz. §3.2 not). */
const REVEAL_EFFECT_LABEL: Record<RevealEffect, string> = {
  none: "Yok",
  "fade-in": "Belirme (Fade In)",
  "fade-up": "Yukarı Belirme (Fade Up)",
  "fade-down": "Aşağı Belirme (Fade Down)",
  "slide-left": "Soldan Kayma (Slide Left)",
  "slide-right": "Sağdan Kayma (Slide Right)",
  "zoom-in": "Yakınlaşma (Zoom In)",
  "flip-up": "Çevirerek Belirme (Flip Up)",
};

/** §3.9 — kart rozetindeki KISA etiketler (uzun etiketlerden farklı, yer kazanmak için). */
const REVEAL_SHORT_LABEL: Record<Exclude<RevealEffect, "none">, string> = {
  "fade-in": "Belirme",
  "fade-up": "Yukarı Belirme",
  "fade-down": "Aşağı Belirme",
  "slide-left": "Soldan Kayma",
  "slide-right": "Sağdan Kayma",
  "zoom-in": "Yakınlaşma",
  "flip-up": "Çevirerek Belirme",
};

/** §3.2 — 4×2 ikon-karo grid'in veri kaynağı: satır 1 opacity ailesi, satır 2 yön/dönüşüm ailesi. */
const REVEAL_TILES: { value: RevealEffect; Icon: LucideIcon; shortLabel: string }[] = [
  { value: "none", Icon: Ban, shortLabel: "Yok" },
  { value: "fade-in", Icon: Eye, shortLabel: "Belirme" },
  { value: "fade-up", Icon: MoveUp, shortLabel: "Yukarı" },
  { value: "fade-down", Icon: MoveDown, shortLabel: "Aşağı" },
  { value: "slide-left", Icon: MoveLeft, shortLabel: "Soldan" },
  { value: "slide-right", Icon: MoveRight, shortLabel: "Sağdan" },
  { value: "zoom-in", Icon: ZoomIn, shortLabel: "Yakınlaş" },
  { value: "flip-up", Icon: FlipVertical2, shortLabel: "Çevir" },
];

const REVEAL_DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: "300", label: "Hızlı" },
  { value: "600", label: "Normal" },
  { value: "1000", label: "Yavaş" },
];

const REVEAL_DELAY_TICKS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

/**
 * Giriş Animasyonu (Scroll Reveal) — v2 tasarım notları §3.1-3.6 BİREBİR. Hem `ContentBlockCard`
 * hem `ContainerCard` tarafından paylaşılan tek bir kontrol; `size` prop'u ile tetikleyici düğmenin
 * boyutu çağırana bırakılır (`ContentBlockCard` bu turun KAPSAMI DIŞINDA — kendi `icon-sm` boyutunu
 * `size` verilmeyerek KORUR; `ContainerCard` §1.2 gereği `icon-xs` geçer).
 */
function RevealEffectControl({
  value,
  onChange,
  size = "icon-sm",
}: {
  value: RevealEffectSettings | undefined;
  onChange: (next: RevealEffectSettings | undefined) => void;
  size?: "icon-sm" | "icon-xs";
}) {
  const effect = value?.effect ?? "none";
  const delayMs = value?.delayMs ?? 300;
  const durationMs = value?.durationMs ?? 600;
  const once = value?.once ?? true;
  const hasEffect = effect !== "none";

  // §3.6 — `previewKey` parametre değiştikçe OTOMATİK artar (React "render sırasında state
  // ayarlama" deseni — bkz. `import-preview-panel.tsx`teki AYNI gerekçe — bir `useEffect` İÇİNDE
  // senkron `setState` ÇAĞRILMAZ, `react-hooks/set-state-in-effect` kuralıyla UYUMLU); "Yeniden
  // Oynat" tıklanınca da AYNI sayaç `replay()` ile artırılır. `previewKey` değiştiğinde altındaki
  // `RevealPreviewBox` `key`iyle yeniden MOUNT olur, kendi `visible` state'i baştan başlar.
  const [previewParams, setPreviewParams] = useState({ effect, delayMs, durationMs });
  const [previewKey, setPreviewKey] = useState(0);
  if (previewParams.effect !== effect || previewParams.delayMs !== delayMs || previewParams.durationMs !== durationMs) {
    setPreviewParams({ effect, delayMs, durationMs });
    setPreviewKey((k) => k + 1);
  }

  function replay() {
    setPreviewKey((k) => k + 1);
  }

  function setEffect(next: RevealEffect) {
    onChange(next === "none" ? undefined : { effect: next, delayMs, durationMs, once });
  }

  function setDelay(next: RevealDelay) {
    if (effect === "none") return;
    onChange({ effect, delayMs: next, durationMs, once });
  }

  function setDuration(next: RevealDuration) {
    if (effect === "none") return;
    onChange({ effect, delayMs, durationMs: next, once });
  }

  function setOnce(next: boolean) {
    if (effect === "none") return;
    onChange({ effect, delayMs, durationMs, once: next });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant={hasEffect ? "secondary" : "ghost"} size={size} aria-label="Görünüm Efekti" title="Görünüm Efekti" />}
      >
        <Sparkles />
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/70">Görünüm Efekti</p>
          <div className="grid grid-cols-4 gap-1.5">
            {REVEAL_TILES.map(({ value: tileValue, Icon, shortLabel }) => (
              <button
                key={tileValue}
                type="button"
                aria-label={REVEAL_EFFECT_LABEL[tileValue]}
                title={REVEAL_EFFECT_LABEL[tileValue]}
                aria-pressed={effect === tileValue}
                data-active={effect === tileValue}
                onClick={() => setEffect(tileValue)}
                className="group flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-surface-muted p-2 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none data-[active=true]:border-primary data-[active=true]:bg-primary/10"
              >
                <Icon className="h-4 w-4 text-foreground/60 group-data-[active=true]:text-primary" />
                <span className="text-[11px] font-medium text-foreground/70">{shortLabel}</span>
              </button>
            ))}
          </div>
        </div>

        {hasEffect && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="reveal-delay" className="block text-xs font-medium text-foreground/70">
                Gecikme ({delayMs}ms)
              </label>
              <input
                type="range"
                id="reveal-delay"
                min={0}
                max={1000}
                step={100}
                list="reveal-delay-ticks"
                value={delayMs}
                onChange={(e) => setDelay(Number(e.target.value) as RevealDelay)}
                className="w-full accent-primary"
              />
              <datalist id="reveal-delay-ticks">
                {REVEAL_DELAY_TICKS.map((ms) => (
                  <option key={ms} value={ms} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground/70">Süre</p>
              <SegmentedToggle value={String(durationMs)} options={REVEAL_DURATION_OPTIONS} onChange={(v) => setDuration(Number(v) as RevealDuration)} />
            </div>

            <div className="flex items-center justify-between">
              <label htmlFor="reveal-repeat" className="text-xs font-medium text-foreground/70">
                Her görünüşte tekrarla
              </label>
              <Switch id="reveal-repeat" checked={!once} onCheckedChange={(checked) => setOnce(!checked)} />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-foreground/70">Önizleme</p>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Yeniden oynat" title="Yeniden oynat" onClick={replay}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border/60 bg-surface-muted/30">
            {hasEffect ? (
              <RevealPreviewBox key={previewKey} effect={effect} delayMs={delayMs} durationMs={durationMs} />
            ) : (
              <p className="text-xs text-foreground/40">Önizlenecek efekt yok</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * §3.6/§4 v2 tasarım notları — `RevealEffectControl`in canlı önizleme kutusu, KENDİ yerel
 * `visible` state'i taşıyan ayrı bir bileşen (`key={previewKey}` her param değişiminde/"Yeniden
 * Oynat"ta bu bileşeni TAM YENİDEN MOUNT eder — `visible` state'i baştan `false` başlar, mount
 * effect'i BİR SEFERLİK, boş bağımlılık dizisiyle çalışır; `setState` çağrısı `requestAnimationFrame`
 * CALLBACK'İ İÇİNDE, effect gövdesinde SENKRON DEĞİL — `react-hooks/set-state-in-effect` kuralıyla
 * uyumlu). Scroll'dan BAĞIMSIZ — `site/blocks/scroll-reveal.tsx`teki gerçek `IntersectionObserver`
 * mantığına PARALEL ama admin popover'ının kendi yerel mini-tetikleyicisi.
 */
function RevealPreviewBox({
  effect,
  delayMs,
  durationMs,
}: {
  effect: Exclude<RevealEffect, "none">;
  delayMs: RevealDelay;
  durationMs: RevealDuration;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={cn(`pb-reveal-${effect}`, visible && "pb-revealed")}
      style={{ transitionDelay: `${delayMs}ms`, transitionDuration: `${durationMs}ms` }}
    >
      <div className="h-8 w-20 rounded-md border border-primary/40 bg-primary/20" />
    </div>
  );
}

/** Bir düğümün kart rozetinde göstereceği "efekt · gecikme" kısa etiketi (`hasEffect` yoksa `null`). */
function revealBadgeLabel(reveal: RevealEffectSettings | undefined): string | null {
  if (!reveal || reveal.effect === "none") return null;
  return `${REVEAL_SHORT_LABEL[reveal.effect]} · ${reveal.delayMs}ms`;
}

function ContentBlockBody({ block, onChange }: { block: ContentBlock; onChange: (block: ContentBlock) => void }) {
  switch (block.type) {
    case "hero":
      return <HeroBlockEditor block={block} onChange={onChange} />;
    case "text":
      return <TextBlockEditor block={block} onChange={onChange} />;
    case "image":
      return <ImageBlockEditor block={block} onChange={onChange} />;
    case "gallery":
      return <GalleryBlockEditor block={block} onChange={onChange} />;
    case "cta":
      return <CtaBlockEditor block={block} onChange={onChange} />;
    case "featured-products":
      return <FeaturedProductsBlockEditor block={block} onChange={onChange} />;
    case "featured-portfolio":
      return <FeaturedPortfolioBlockEditor block={block} onChange={onChange} />;
    case "heading":
      return <HeadingBlockEditor block={block} onChange={onChange} />;
    case "button":
      return <ButtonBlockEditor block={block} onChange={onChange} />;
    case "icon-box":
      return <IconBoxBlockEditor block={block} onChange={onChange} />;
    case "divider":
      return <DividerBlockEditor block={block} onChange={onChange} />;
    case "video":
      return <VideoBlockEditor block={block} onChange={onChange} />;
    case "accordion":
      return <AccordionBlockEditor block={block} onChange={onChange} />;
    case "tabs":
      return <TabsBlockEditor block={block} onChange={onChange} />;
    case "counter":
      return <CounterBlockEditor block={block} onChange={onChange} />;
    case "testimonial":
      return <TestimonialBlockEditor block={block} onChange={onChange} />;
    case "pricing-table":
      return <PricingTableBlockEditor block={block} onChange={onChange} />;
    case "latest-posts":
      return <LatestPostsBlockEditor block={block} onChange={onChange} />;
    case "contact-form":
      return <ContactFormBlockEditor block={block} onChange={onChange} />;
    case "custom-html":
      return <CustomHtmlBlockEditor block={block} onChange={onChange} />;
    case "before-after-slider":
      return <BeforeAfterSliderBlockEditor block={block} onChange={onChange} />;
    case "logo-marquee":
      return <LogoMarqueeBlockEditor block={block} onChange={onChange} />;
    case "skill-bar":
      return <SkillBarBlockEditor block={block} onChange={onChange} />;
    case "team":
      return <TeamBlockEditor block={block} onChange={onChange} />;
    case "advanced-slider":
      return <AdvancedSliderBlockEditor block={block} onChange={onChange} />;
    case "google-map":
      return <GoogleMapBlockEditor block={block} onChange={onChange} />;
  }
}

interface Ctx {
  onMove: (id: string, direction: -1 | 1) => void;
  onMoveToParent: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateContent: (block: ContentBlock) => void;
  onWrap: (id: string) => void;
  onUnwrap: (containerId: string) => void;
  onAddChild: (containerId: BuilderContainerId, type: PaletteBlockType) => void;
  onSelectContainer: (id: string) => void;
  selectedContainerId: string | null;
  onUpdateReveal: (id: string, reveal: RevealEffectSettings | undefined) => void;
  /** Dinamik konteyner ekleme (§10 tasarım notları — imza frontend-agent'a bırakıldı) — kök-sonu
   *  kutusu, aralar-arası inserter VE kontrol barındaki "+Alta" ÜÇÜ DE bu TEK callback'i kullanır;
   *  "+Alta" için `parentId` = mevcut konteynerin ebeveyni, `index` = kendi index'i + 1. */
  onInsertContainer: (parentId: BuilderContainerId, index: number, preset: LayoutPreset) => void;
}

/** §5 ui-designer dokümanı — bir konteynerin İÇİNDEKİ yaprak bloklar için sessiz "bare" ipucu. */
function BareChromeHint() {
  return (
    <span title="Dış boşluk konteynerden geliyor (bu bloğun kendi sayfa dolgusu yok)">
      <PanelTop className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden />
    </span>
  );
}

function ContentBlockCard({
  block,
  parentId,
  index,
  total,
  ctx,
  dragHandle,
}: {
  block: ContentBlock;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  ctx: Ctx;
  dragHandle: ReactNode;
}) {
  const isBare = parentId !== "root";
  const revealBadge = revealBadgeLabel(block.reveal);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {dragHandle}
          <span className="truncate text-sm font-medium text-foreground">{blockRegistry[block.type].label}</span>
          {revealBadge && (
            <Badge tone="primary" size="sm">
              {revealBadge}
            </Badge>
          )}
          {isBare && <BareChromeHint />}
          <LayoutMenu mode="wrap" onSelect={() => ctx.onWrap(block.id)} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <RevealEffectControl value={block.reveal} onChange={(reveal) => ctx.onUpdateReveal(block.id, reveal)} />
          {isBare && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Üst konteynere taşı"
              title="Üst konteynere taşı"
              onClick={() => ctx.onMoveToParent(block.id)}
            >
              <ArrowUpToLine />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Yukarı taşı" onClick={() => ctx.onMove(block.id, -1)} disabled={index === 0}>
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aşağı taşı"
            onClick={() => ctx.onMove(block.id, 1)}
            disabled={index === total - 1}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Bloğu sil" onClick={() => ctx.onRemove(block.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="pt-4">
        <ContentBlockBody block={block} onChange={ctx.onUpdateContent} />
      </div>
    </div>
  );
}

/** §3.1 ui-designer dokümanı — 4 derinlik seviyesi, kenarlık yoğunluğu + sol vurgu çubuğu + rozet. */
const DEPTH_STYLE: Record<1 | 2 | 3 | 4, { border: string; accent: string; bg: string; padding: string }> = {
  1: { border: "border-border/70", accent: "border-l-primary/20", bg: "bg-surface-muted/30", padding: "p-4" },
  2: { border: "border-border/60", accent: "border-l-primary/40", bg: "bg-surface-muted/20", padding: "p-3.5" },
  3: { border: "border-border/50", accent: "border-l-primary/60", bg: "bg-surface-muted/15", padding: "p-3" },
  4: { border: "border-border/40", accent: "border-l-primary/80", bg: "bg-surface-muted/10", padding: "p-2.5" },
};

function depthStyle(depth: number) {
  const clamped = Math.min(Math.max(Math.round(depth), 1), 4) as 1 | 2 | 3 | 4;
  return DEPTH_STYLE[clamped];
}

/** Bir satırdaki (`direction: "row"`) sütunların `widthFr` oranını, kullanıcıya dönük kısa bir
 *  etikete çevirir (örn. `[1,1]` → `"50 / 50"`, `[1,2]` → `"33 / 67"`) — §3 kullanıcı isteği
 *  ("Konteyner: 50 / 50"). Bir çocuk `container` değilse veya `widthFr` taşımıyorsa `null` döner
 *  (oran belirsiz — etiket gösterilmez). */
function rowRatioLabel(children: PageNode[]): string | null {
  if (children.length < 2) return null;
  const weights = children.map((c) => (c.type === "container" ? c.settings.widthFr : undefined));
  if (weights.some((w) => w === undefined || w === null)) return null;
  const total = (weights as number[]).reduce((sum, w) => sum + w, 0);
  if (total <= 0) return null;
  return (weights as number[]).map((w) => Math.round((w / total) * 100)).join(" / ");
}

/**
 * §2.2b v2 tasarım notları — kontrol çubuğunun 3. öğesi: "bu konteynerin İÇİNE" yeni bir alt
 * konteyner ekler (`FolderPlus`, `Popover` — `DropdownMenu` DEĞİL, tekil bir buton). Yalnızca
 * Tekli Konteyner / 2'li Sütun preset'leri (`LayoutPresetPopoverGrid`in `presets`/`columns`
 * genişletmesi, bkz. `container-inserter.tsx`).
 */
function AddChildContainerControl({
  disabled,
  disabledReason,
  onInsertContainer,
}: {
  disabled: boolean;
  disabledReason?: string;
  onInsertContainer: (preset: LayoutPreset) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="İç konteyner ekle" title="İç konteyner ekle" />}>
        <FolderPlus className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56">
        <LayoutPresetPopoverGrid
          presets={LAYOUT_PRESETS.filter((p) => p.id === "100" || p.id === "50-50")}
          columns={2}
          disabled={disabled}
          disabledReason={disabledReason}
          onSelect={onInsertContainer}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * §1.3 v2 tasarım notları — "Daha Fazla" (`Ellipsis`) menüsü: Çoğalt/Yukarı/Aşağı, ardından
 * "Alta Konteyner Ekle" (`DropdownMenuSub`, sibling-insert — mevcut `ctx.onInsertContainer(parentId,
 * index+1, preset)` davranışı DEĞİŞMEDEN buraya TAŞINDI), yalnızca `isBare` ise "Üst Konteynere
 * Taşı", en altta "Konteyneri Kaldır" (`Unlink2` — eski `LayoutMenu mode="unwrap"`in yerini alır).
 */
function ContainerMoreMenu({
  container,
  parentId,
  index,
  total,
  isBare,
  atMaxDepth,
  ctx,
}: {
  container: ContainerNode;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  isBare: boolean;
  atMaxDepth: boolean;
  ctx: Ctx;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Daha fazla işlem" title="Daha fazla işlem" />}>
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => ctx.onDuplicate(container.id)}>
          <Copy className="h-4 w-4 text-foreground/50" />
          Konteyneri Çoğalt
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ctx.onMove(container.id, -1)} disabled={index === 0}>
          <ArrowUp className="h-4 w-4 text-foreground/50" />
          Yukarı Taşı
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ctx.onMove(container.id, 1)} disabled={index === total - 1}>
          <ArrowDown className="h-4 w-4 text-foreground/50" />
          Aşağı Taşı
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <LayoutTemplate className="h-4 w-4 text-foreground/50" />
            Alta Konteyner Ekle
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80">
            <LayoutPresetPopoverGrid
              disabled={atMaxDepth}
              disabledReason="Maksimum iç içe geçme derinliğine ulaşıldı (4)"
              onSelect={(preset) => ctx.onInsertContainer(parentId, index + 1, preset)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {isBare && (
          <DropdownMenuItem onClick={() => ctx.onMoveToParent(container.id)}>
            <ArrowUpToLine className="h-4 w-4 text-foreground/50" />
            Üst Konteynere Taşı
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => ctx.onUnwrap(container.id)}>
          <Unlink2 className="h-4 w-4 text-foreground/50" />
          Konteyneri Kaldır
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContainerCard({
  container,
  parentId,
  index,
  total,
  depth,
  ctx,
  dragHandle,
  ratioLabel,
}: {
  container: ContainerNode;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  depth: number;
  ctx: Ctx;
  dragHandle: ReactNode;
  /** Bu konteynerin, `direction: "row"` olan EBEVEYNİ içindeki genişlik oranı (bkz. `rowRatioLabel`). */
  ratioLabel?: string | null;
}) {
  const ds = depthStyle(depth);
  const isRow = container.settings.direction === "row";
  const Icon = !isRow ? Rows2 : container.children.length >= 4 ? Columns4 : container.children.length === 3 ? Columns3 : Columns2;
  const atMaxChildren = container.children.length >= MAX_CHILDREN_PER_CONTAINER;
  const atMaxDepth = depth >= MAX_CONTAINER_DEPTH;
  const tooManyForReadability = isRow && container.children.length >= ROW_CHILDREN_READABILITY_WARNING_THRESHOLD;
  const isBare = parentId !== "root";
  const selected = ctx.selectedContainerId === container.id;
  const containerId = toContainerId(container.id);
  const childIds = container.children.map((c) => c.id);
  const revealBadge = revealBadgeLabel(container.reveal);
  // Satır (`row`) konteyneri KENDİ sütun sayısını gösterir (`"2 Sütun"`, DEĞİŞMEZ — testlere bağlı);
  // satırın İÇİNDEKİ bare bir sütun ise, mümkünse görece genişlik oranını gösterir (§3 isteği).
  const headerLabel = isRow ? `${container.children.length} Sütun` : ratioLabel ? `Konteyner: ${ratioLabel}` : "Konteyner";
  const childRatioLabel = isRow ? rowRatioLabel(container.children) : null;
  // §4.4 tasarım notları — bu konteynerin `children` listesindeki between-inserter'lar KENDİ
  // `atMaxChildren`/`atMaxDepth`'ini aynen devralır (kök için bu iki sınır UYGULANMAZ, §4.4).
  const childInsertDisabled = atMaxChildren || atMaxDepth;
  const childInsertDisabledReason = atMaxDepth
    ? "Maksimum iç içe geçme derinliğine ulaşıldı (4)"
    : atMaxChildren
      ? `Bir konteynerde en fazla ${MAX_CHILDREN_PER_CONTAINER} öğe olabilir`
      : undefined;

  return (
    <div
      className={cn(
        "group space-y-3 rounded-xl border-2 border-dashed transition-shadow",
        ds.border,
        ds.bg,
        ds.padding,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {/* Konteyner Kontrol Barı — "hover'da beliren hızlı aksiyon barı" (§3 isteği): sessizken
          hafifçe soluk, hover/seçili durumda tam opak + hafif kabartma. Erişilebilirlik/e2e
          gereği düğmeler HER ZAMAN DOM'da ve tıklanabilir kalır — yalnızca görsel ağırlık değişir. */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-r-md border-l-4 py-1 pl-2 cursor-pointer transition-all",
          ds.accent,
          selected ? "opacity-100" : "opacity-75 hover:opacity-100 hover:bg-surface/60 hover:shadow-sm focus-within:opacity-100"
        )}
        onClick={() => ctx.onSelectContainer(container.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ctx.onSelectContainer(container.id);
          }
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {dragHandle}
          <Icon className="h-4 w-4 shrink-0 text-foreground/50" />
          <span className="text-sm font-medium text-foreground">{headerLabel}</span>
          <Badge tone="neutral" size="sm">
            {atMaxDepth ? `Seviye ${depth} · Maks.` : `Seviye ${depth}`}
          </Badge>
          {revealBadge && (
            <Badge tone="primary" size="sm">
              {revealBadge}
            </Badge>
          )}
          {isBare && <BareChromeHint />}
          {tooManyForReadability && (
            <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              Bu satırda {container.children.length} öğe var — okunabilirlik azalabilir.
            </span>
          )}
        </div>
        {/* §1.2 v2 tasarım notları — görünür 5'li sıra, `icon-xs` + `gap-0.5`. İkincil aksiyonlar
            (Çoğalt/Yukarı/Aşağı/Alta Konteyner Ekle/Üst Konteynere Taşı/Konteyneri Kaldır) `•••`
            (`ContainerMoreMenu`) içine taşındı — bkz. §1.3.
            qa-agent bulgusu — 4'lü sütun + Mobil (375px) önizlemede seviye-2 sütun genişliği
            (~71px dış / ~43px iç) 5×24px'lik sabit sıradan (128px) DAHA DAR: `shrink-0` bu grubu
            kendi genişliğinde SABİT tutup kartın dışına TAŞIRIYORDU. `shrink-0` KALDIRILDI +
            `flex-wrap` eklendi — grup artık kendi İÇİNDE satır kırabilir (gerekirse 1-2 buton/satır),
            asla ebeveyn kartın sağ kenarını AŞMAZ; normal (dar OLMAYAN) genişliklerde davranış
            DEĞİŞMEZ (128px onlarda zaten rahatça sığar, tek satırda kalır). */}
        <div className="flex flex-wrap max-w-full items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Konteyner ayarları"
            title="Konteyner ayarları"
            onClick={() => ctx.onSelectContainer(container.id)}
          >
            <Settings2 />
          </Button>
          <RevealEffectControl size="icon-xs" value={container.reveal} onChange={(reveal) => ctx.onUpdateReveal(container.id, reveal)} />
          <AddChildContainerControl
            disabled={childInsertDisabled}
            disabledReason={childInsertDisabledReason}
            onInsertContainer={(preset) => ctx.onInsertContainer(containerId, container.children.length, preset)}
          />
          <ContainerMoreMenu container={container} parentId={parentId} index={index} total={total} isBare={isBare} atMaxDepth={atMaxDepth} ctx={ctx} />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Konteyneri sil"
            className="hover:text-destructive"
            onClick={() => ctx.onRemove(container.id)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
        {container.children.length === 0 ? (
          <EmptyContainerDropZone
            containerId={containerId}
            atMax={atMaxChildren}
            atMaxDepth={atMaxDepth}
            onAdd={(type) => ctx.onAddChild(containerId, type)}
            onInsertContainer={(preset) => ctx.onInsertContainer(containerId, container.children.length, preset)}
          />
        ) : (
          <div className="space-y-3">
            {/* §4.3 tasarım notları — between-inserter YALNIZCA dikey akışta (`!isRow`) gösterilir;
                `direction: "row"` sütunları arasına sokulmaz (bkz. dosya başlığındaki gerekçe).
                Dikey listede `gap-3` YERİNE her çocuğun kendi wrapper'ının İÇİNE (2.+ çocuktan
                itibaren) gömülü `BetweenContainersInserter` (`h-4`) araya girer — kesikli çizgi
                spacing'i açık şekilde taşır. */}
            <div className={cn("flex", isRow ? "flex-col gap-3 md:flex-row" : "flex-col")}>
              {container.children.map((child, childIndex) => (
                <div key={child.id} className={cn("min-w-0", isRow && "md:flex-1")}>
                  {!isRow && childIndex > 0 && (
                    <BetweenContainersInserter
                      index={childIndex}
                      disabled={childInsertDisabled}
                      disabledReason={childInsertDisabledReason}
                      onInsert={(insertIndex, preset) => ctx.onInsertContainer(containerId, insertIndex, preset)}
                    />
                  )}
                  <NodeCard
                    node={child}
                    parentId={containerId}
                    index={childIndex}
                    total={container.children.length}
                    depth={depth + 1}
                    ctx={ctx}
                    ratioLabel={isRow ? childRatioLabel : null}
                  />
                </div>
              ))}
            </div>
            {!atMaxChildren && (
              <div className="flex justify-center">
                <AddContentMenu
                  onAdd={(type) => ctx.onAddChild(containerId, type)}
                  atMaxDepth={atMaxDepth}
                  onInsertContainer={(preset) => ctx.onInsertContainer(containerId, container.children.length, preset)}
                />
              </div>
            )}
          </div>
        )}
      </SortableContext>
    </div>
  );
}

function NodeCard({
  node,
  parentId,
  index,
  total,
  depth,
  ctx,
  ratioLabel,
}: {
  node: PageNode;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  depth: number;
  ctx: Ctx;
  /** Yalnızca `node` bir konteyner VE ebeveyni `direction: "row"` ise anlamlı — bkz. `rowRatioLabel`. */
  ratioLabel?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const dragHandle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Sürükle: ${nodeLabel(node)}`}
      className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50")}>
      {node.type === "container" ? (
        <ContainerCard
          container={node}
          parentId={parentId}
          index={index}
          total={total}
          depth={depth}
          ctx={ctx}
          dragHandle={dragHandle}
          ratioLabel={ratioLabel}
        />
      ) : (
        <ContentBlockCard block={node} parentId={parentId} index={index} total={total} ctx={ctx} dragHandle={dragHandle} />
      )}
    </div>
  );
}

export function BuilderCanvas({
  nodes,
  onChange,
  selectedContainerId,
  onSelectContainer,
}: {
  nodes: PageNode[];
  onChange: (nodes: PageNode[]) => void;
  selectedContainerId: string | null;
  onSelectContainer: (id: string | null) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingUnwrap, setPendingUnwrap] = useState<{ containerId: string; nodeCount: number } | null>(null);
  /** §1.1 — editörün KENDİ görsel simülasyonu, kayıtlı `nodes`'u ETKİLEMEZ. */
  const [device, setDevice] = useState<DeviceMode>("desktop");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const rootIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const activeNode = activeId ? findNode(nodes, activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  /**
   * BUG DÜZELTMESİ (qa-agent, v2 `admin-page-builder-columns.spec.ts`) — state SÜRÜKLEME
   * SIRASINDA (`onDragOver`) HİÇ mutasyona uğratılmaz (görsel geri bildirim `DragOverlay` +
   * boş konteynerin `useDroppable().isOver`'ı üzerinden, state'ten BAĞIMSIZ sağlanır);
   * konteynerler arası taşıma VE aynı konteyner içi sıralama TEK SEFERDE, yalnızca bırakma
   * anında (`onDragEnd`) hesaplanıp uygulanır — bkz. v2 yorumundaki geri besleme döngüsü analizi
   * (aynı desen, artık herhangi bir derinlikte).
   */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    const fromParentId = findParentId(nodes, activeIdStr);
    if (!fromParentId) return;

    let toParentId = findParentId(nodes, overIdStr);
    if (!toParentId && (overIdStr === "root" || overIdStr.startsWith("container:"))) {
      toParentId = overIdStr as BuilderContainerId;
    }
    if (!toParentId) return;

    if (fromParentId === toParentId) {
      const ids = getContainerChildIds(nodes, fromParentId);
      const oldIndex = ids.indexOf(activeIdStr);
      let newIndex = ids.indexOf(overIdStr);
      if (newIndex === -1) newIndex = ids.length > 0 ? ids.length - 1 : 0;
      if (oldIndex === -1 || oldIndex === newIndex) return;
      const children = getContainerChildren(nodes, fromParentId);
      const next = [...children];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved!);
      onChange(setContainerChildren(nodes, fromParentId, next));
      return;
    }

    // Konteynerler arası taşıma — `moveNode` KENDİ İÇİNDE `isDescendant` + kapasite + derinlik
    // guard'larını uygular (bkz. `containers.ts`); herhangi bir ihlalde ağaç DEĞİŞMEDEN döner.
    const targetIds = getContainerChildIds(nodes, toParentId);
    let insertIndex = targetIds.indexOf(overIdStr);
    if (insertIndex === -1) insertIndex = targetIds.length;
    onChange(moveNode(nodes, activeIdStr, toParentId, insertIndex));
  }

  function move(id: string, direction: -1 | 1) {
    const parentId = findParentId(nodes, id);
    if (!parentId) return;
    const siblings = getContainerChildren(nodes, parentId);
    const index = siblings.findIndex((n) => n.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;
    const next = [...siblings];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(setContainerChildren(nodes, parentId, next));
  }

  /** a11y yedeği (§2.4) — dnd-kit sürüklemesine eşdeğer, klavyeyle "bir üst konteynere kaç". */
  function moveToParent(id: string) {
    const parentId = findParentId(nodes, id);
    if (!parentId || parentId === "root") return;
    const parentRawId = containerIdOf(parentId)!;
    const grandParentId = findParentId(nodes, parentRawId);
    if (!grandParentId) return;
    const grandSiblings = getContainerChildren(nodes, grandParentId);
    const insertIndex = grandSiblings.findIndex((n) => n.id === parentRawId) + 1;
    onChange(moveNode(nodes, id, grandParentId, insertIndex));
  }

  function remove(id: string) {
    const { nodes: next, removed } = removeNode(nodes, id);
    if (!removed) return;
    onChange(next);
    if (selectedContainerId === id) onSelectContainer(null);
  }

  function updateContent(block: ContentBlock) {
    onChange(updateNode(nodes, block.id, () => block));
  }

  function wrap(id: string) {
    if (countNodes(nodes) >= MAX_TOTAL_PAGE_NODES) return;
    const target = findNode(nodes, id);
    if (!target) return;
    const ownDepth = containerDepth(nodes, id);
    if (ownDepth === 0 || ownDepth + subtreeDepth(target) > MAX_CONTAINER_DEPTH) return;
    onChange(wrapInContainer(nodes, id));
  }

  function requestUnwrap(containerId: string) {
    const node = findNode(nodes, containerId);
    if (!node || node.type !== "container") return;
    if (needsConfirmToUnwrap(node)) {
      setPendingUnwrap({ containerId, nodeCount: countNodes(node.children) });
      return;
    }
    onChange(unwrapContainer(nodes, containerId));
  }

  function addChild(containerId: BuilderContainerId, type: PaletteBlockType) {
    if (countNodes(nodes) >= MAX_TOTAL_PAGE_NODES) return;
    if (isContainerAtCapacity(nodes, containerId)) return;
    const children = getContainerChildren(nodes, containerId);
    onChange(insertNode(nodes, containerId, children.length, createBlock(type)));
  }

  /** Konteyner Kontrol Barı → "📋 Kopyala / Çoğalt (Duplicate)" (§3 kullanıcı isteği). */
  function duplicate(id: string) {
    onChange(duplicateNode(nodes, id));
  }

  /**
   * Dinamik konteyner ekleme (`.claude/design-notes-page-builder-dynamic-container-insertion.md`
   * §10) — kök-sonu kutusu, aralar-arası inserter VE kontrol barındaki "+Alta" ÜÇÜ DE bu fonksiyonu
   * çağırır. `addChild`/`wrap` ile AYNI guard deseni: toplam düğüm sınırı + (kök HARİÇ) kapasite/
   * derinlik kontrolü — herhangi biri ihlal edilirse SESSİZCE no-op.
   */
  function insertContainer(parentId: BuilderContainerId, index: number, preset: LayoutPreset) {
    if (countNodes(nodes) >= MAX_TOTAL_PAGE_NODES) return;
    const newContainer = createContainerFromPreset(preset);
    if (parentId !== "root") {
      if (isContainerAtCapacity(nodes, parentId)) return;
      const parentDepth = containerDepth(nodes, containerIdOf(parentId)!);
      if (parentDepth + subtreeDepth(newContainer) > MAX_CONTAINER_DEPTH) return;
    }
    onChange(insertNode(nodes, parentId, index, newContainer));
  }

  /** Giriş Animasyonu (Scroll Reveal) — §Yapılacaklar/5 orkestratör talimatı, mevcut
   *  `updateContent`/`wrap` fonksiyonlarının yanına eklenir. */
  function updateReveal(id: string, reveal: RevealEffectSettings | undefined) {
    onChange(updateNode(nodes, id, (node) => ({ ...node, reveal })));
  }

  const ctx: Ctx = {
    onMove: move,
    onMoveToParent: moveToParent,
    onRemove: remove,
    onDuplicate: duplicate,
    onUpdateContent: updateContent,
    onWrap: wrap,
    onUnwrap: requestUnwrap,
    onAddChild: addChild,
    onSelectContainer,
    selectedContainerId,
    onUpdateReveal: updateReveal,
    onInsertContainer: insertContainer,
  };

  return (
    <>
      <DevicePreviewBar device={device} onChange={setDevice} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className={canvasWidthClass(device)}>
          {nodes.length === 0 ? (
            <NewContainerInserter variant="empty" onInsert={(preset) => insertContainer("root", 0, preset)} />
          ) : (
            <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
              {/* §4.5 tasarım notları — `space-y-4` (16px) YERİNE explicit interleave: her
                  `BetweenContainersInserter`in kendi `h-4`'ü (16px) eski ritmi BİREBİR karşılar. */}
              <div className="flex flex-col">
                {nodes.map((node, index) => (
                  <div key={node.id}>
                    {index > 0 && (
                      <BetweenContainersInserter index={index} onInsert={(insertIndex, preset) => insertContainer("root", insertIndex, preset)} />
                    )}
                    <NodeCard node={node} parentId="root" index={index} total={nodes.length} depth={1} ctx={ctx} />
                  </div>
                ))}
                <div className="mt-4">
                  <NewContainerInserter variant="appended" onInsert={(preset) => insertContainer("root", nodes.length, preset)} />
                </div>
              </div>
            </SortableContext>
          )}
        </div>
        <DragOverlay>
          {activeNode ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg ring-2 ring-primary/40">
              <GripVertical className="h-4 w-4 text-foreground/40" />
              <span className="text-sm font-medium text-foreground">{nodeLabel(activeNode)}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={pendingUnwrap !== null}
        onOpenChange={(open) => !open && setPendingUnwrap(null)}
        tone="warning"
        title="Konteyner kaldırılsın mı?"
        description={
          pendingUnwrap
            ? `İçindeki ${pendingUnwrap.nodeCount} öğe, sırasıyla üst seviyeye taşınacak. İçerik SİLİNMEZ.`
            : undefined
        }
        confirmText="Konteyneri Kaldır"
        cancelText="Vazgeç"
        onConfirm={() => {
          if (pendingUnwrap) onChange(unwrapContainer(nodes, pendingUnwrap.containerId));
          setPendingUnwrap(null);
        }}
      />
    </>
  );
}
