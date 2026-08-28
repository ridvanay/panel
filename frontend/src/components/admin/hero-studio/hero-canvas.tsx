"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { Slide, Slider, SliderLayer } from "@/lib/sliders/types";
import { SLIDER_BUTTON_SIZE_CLASS, SLIDER_BUTTON_VARIANT_CLASS } from "@/lib/sliders/design-tokens";
import { ORIGIN_PERCENT, IN_EFFECT_VARIANTS, buildLayerContentStyle, buildLayerTransition } from "@/lib/sliders/layer-render";
import { isLayerHiddenOnDevice, patchLayerGroup, resolveGroupForEditing } from "./layer-mutations";

/** §4.3 ui-designer — admin tuvali stage'e SIĞDIRILMIŞ bir ÖNİZLEMEDİR, gerçek `100svh` DEĞİL. */
function canvasBoxStyle(slider: Slider, device: DeviceMode): React.CSSProperties {
  const useMobile = device === "mobile" && slider.mobileHeightMode != null;
  const mode = useMobile ? slider.mobileHeightMode! : slider.heightMode;
  const heightPx = useMobile ? slider.mobileHeightPx : slider.heightPx;
  const aspectW = useMobile ? (slider.mobileAspectRatioWidth ?? slider.aspectRatioWidth) : slider.aspectRatioWidth;
  const aspectH = useMobile ? (slider.mobileAspectRatioHeight ?? slider.aspectRatioHeight) : slider.aspectRatioHeight;

  if (mode === "full-screen") return { height: "min(70vh, 640px)" };
  if (mode === "custom-px") return { height: `min(${heightPx ?? 600}px, 70vh)` };
  return { aspectRatio: `${aspectW} / ${aspectH}`, maxHeight: "70vh" };
}

function canvasWidthClass(device: DeviceMode) {
  return cn(
    "relative mx-auto w-full overflow-hidden rounded-lg ring-1 ring-white/10 shadow-2xl transition-all duration-300",
    device === "tablet" && "max-w-[768px]",
    device === "mobile" && "max-w-[375px]"
  );
}

function SlideBackgroundPreview({ slide }: { slide: Slide }) {
  if (slide.bgType === "image" && slide.bgMedia) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- admin canvas önizlemesi, next/image gerekmez
      <img
        src={slide.bgMedia.url}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: `${slide.bgPositionX}% ${slide.bgPositionY}%` }}
      />
    );
  }
  if (slide.bgType === "video") {
    const src = slide.bgMedia?.url ?? slide.bgVideoUrl ?? undefined;
    return (
      <div className="absolute inset-0 bg-black">
        {slide.bgVideoPosterMedia?.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- video poster önizlemesi
          <img src={slide.bgVideoPosterMedia.url} alt="" className="h-full w-full object-cover opacity-80" />
        ) : (
          !src && <div className="flex h-full items-center justify-center text-xs text-white/40">Video URL yok</div>
        )}
      </div>
    );
  }
  const from = slide.bgGradientFrom ?? "#111827";
  const to = slide.bgGradientTo ?? "#111827";
  return <div className="absolute inset-0" style={{ background: `linear-gradient(${slide.bgGradientAngle}deg, ${from}, ${to})` }} />;
}

/** Katman tipine göre GERÇEK stilli içerik — WYSIWYG. `SlideLayerView` (public render, bkz.
 *  `components/site/advanced-slider/slide-layer.tsx`) ile AYNI `buildLayerContentStyle` kaynağını
 *  kullanır; buton/rozet burada gerçek `<a>` DEĞİLDİR (editörde tıklanınca sayfadan
 *  çıkılmasın diye) — yalnızca görsel olarak AYNI sınıflarla render edilir. */
function LayerContentBody({ layer }: { layer: SliderLayer }) {
  const contentStyle = buildLayerContentStyle(layer.style);
  if (layer.type === "heading") {
    const Tag = (`h${layer.content.level ?? 2}`) as "h1" | "h2" | "h3";
    return (
      <Tag className="m-0" style={contentStyle}>
        {layer.content.text || "(boş başlık)"}
      </Tag>
    );
  }
  if (layer.type === "text") {
    return (
      <p className="m-0 whitespace-pre-line" style={contentStyle}>
        {layer.content.text || "(boş metin)"}
      </p>
    );
  }
  if (layer.type === "badge") {
    return (
      <span className="inline-block rounded-full bg-[var(--site-primary)] px-3 py-1 text-xs font-semibold text-white" style={contentStyle}>
        {layer.content.text || "(boş rozet)"}
      </span>
    );
  }
  if (layer.type === "image") {
    return layer.content.url ? (
      // eslint-disable-next-line @next/next/no-img-element -- katman görseli serbest URL, admin canvas önizlemesi
      <img src={layer.content.url} alt={layer.content.alt} className="block max-w-full" style={contentStyle} />
    ) : (
      <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed border-white/30 text-[11px] text-white/50">Görsel yok</div>
    );
  }
  // button
  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold",
        SLIDER_BUTTON_VARIANT_CLASS[layer.content.variant],
        SLIDER_BUTTON_SIZE_CLASS[layer.content.size]
      )}
      style={{ ...contentStyle, borderRadius: "var(--site-radius)" }}
    >
      {layer.content.label || "(boş buton)"}
    </span>
  );
}

const EDITABLE_TEXT_TYPES = new Set<SliderLayer["type"]>(["heading", "text", "badge", "button"]);
const MULTILINE_TYPES = new Set<SliderLayer["type"]>(["text"]);

function layerText(layer: SliderLayer): string {
  if (layer.type === "button") return layer.content.label;
  if (layer.type === "image") return "";
  return layer.content.text;
}

function withText(layer: SliderLayer, text: string): SliderLayer {
  if (layer.type === "button") return { ...layer, content: { ...layer.content, label: text } };
  if (layer.type === "image") return layer;
  return { ...layer, content: { ...layer.content, text } };
}

/** Çift tıklama ile yerinde metin düzenleme — Escape değişikliği İPTAL eder (blur commit etmez),
 *  Enter (metin katmanı DIŞINDA) veya blur COMMIT eder. */
function InlineTextEditor({ layer, onCommit, onCancel }: { layer: SliderLayer; onCommit: (text: string) => void; onCancel: () => void }) {
  const cancelledRef = useRef(false);
  const multiline = MULTILINE_TYPES.has(layer.type);
  const contentStyle = buildLayerContentStyle(layer.style);
  const commonProps = {
    autoFocus: true,
    defaultValue: layerText(layer),
    onFocus: (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => e.currentTarget.select(),
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (e.key === "Escape") {
        cancelledRef.current = true;
        e.currentTarget.blur();
      } else if (e.key === "Enter" && !multiline && !e.shiftKey) {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
    onBlur: (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (cancelledRef.current) {
        onCancel();
        return;
      }
      onCommit(e.currentTarget.value);
    },
    className: "min-w-[80px] resize-none border border-dashed border-white bg-black/40 px-1 py-0.5 outline-none",
    style: contentStyle,
  };
  return multiline ? <textarea rows={3} {...commonProps} /> : <input type="text" {...commonProps} />;
}

const RESIZABLE_TYPES = new Set<SliderLayer["type"]>(["heading", "text", "button", "image", "badge"]);

function ResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const corners: { top: string; left: string; cursor: string }[] = [
    { top: "-4px", left: "-4px", cursor: "nwse-resize" },
    { top: "-4px", left: "calc(100% - 4px)", cursor: "nesw-resize" },
    { top: "calc(100% - 4px)", left: "-4px", cursor: "nesw-resize" },
    { top: "calc(100% - 4px)", left: "calc(100% - 4px)", cursor: "nwse-resize" },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <div
          key={i}
          className="absolute z-10 h-2 w-2 rounded-[1px] border-[1.5px] bg-white"
          style={{ top: c.top, left: c.left, cursor: c.cursor, borderColor: "var(--accent-500, #6366f1)", boxShadow: "var(--slider-layer-shadow-sm)" }}
          onPointerDown={onResizeStart}
        />
      ))}
    </>
  );
}

function LayerBox({
  layer,
  device,
  selected,
  editing,
  playing,
  playKey,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDrag,
  onResize,
  canvasRef,
}: {
  layer: SliderLayer;
  device: DeviceMode;
  selected: boolean;
  editing: boolean;
  playing: boolean;
  playKey: number;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onDrag: (xPercent: number, yPercent: number) => void;
  onResize: (widthPercent: number) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { value: position } = resolveGroupForEditing(layer, "position", device);
  const { value: animation } = resolveGroupForEditing(layer, "animation", device);
  const hidden = isLayerHiddenOnDevice(layer, device);
  const origin = ORIGIN_PERCENT[position.origin];
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (playing || editing) return;
    e.stopPropagation();
    onSelect();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xPercent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPercent = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    onDrag(Math.round(xPercent * 10) / 10, Math.round(yPercent * 10) / 10);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  function onResizeStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (playing || editing || !canvasRef.current) return;
    e.stopPropagation();
    onSelect();
    resizingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseXPercent = ((e.clientX - rect.left) / rect.width) * 100;
    // Sembolik "merkezden yeniden boyutlandırma": 4 tutamaç da AYNI davranır — katmanın
    // konum çapasından (xPercent) uzaklaşan mesafe, yeni genişliğin YARISI kabul edilir.
    const deltaPercent = Math.abs(mouseXPercent - position.xPercent) * 2;
    onResize(Math.max(1, Math.min(100, Math.round(deltaPercent))));
  }

  function onResizeEnd(e: ReactPointerEvent<HTMLDivElement>) {
    resizingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const variant = IN_EFFECT_VARIANTS[animation.inEffect];
  const showResizeHandles = selected && !editing && !playing && RESIZABLE_TYPES.has(layer.type);
  const canEdit = EDITABLE_TEXT_TYPES.has(layer.type);

  return (
    <div
      className={cn("absolute select-none", playing ? "pointer-events-none" : editing ? "cursor-text" : "cursor-grab active:cursor-grabbing")}
      style={{
        left: `${position.xPercent}%`,
        top: `${position.yPercent}%`,
        transform: `translate(-${origin.x}%, -${origin.y}%)`,
        width: position.widthPercent ? `${position.widthPercent}%` : undefined,
        zIndex: position.zIndex ?? 1,
        opacity: hidden ? 0.35 : 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        onPointerMove(e);
        onResizeMove(e);
      }}
      onPointerUp={(e) => {
        onPointerUp(e);
        onResizeEnd(e);
      }}
      onDoubleClick={() => canEdit && !playing && onStartEdit()}
    >
      <div
        className="relative inline-block max-w-full"
        style={{ boxShadow: selected && !playing ? "0 0 0 1px rgb(0 0 0 / 0.45), 0 0 0 3px var(--accent-500, #6366f1)" : undefined }}
      >
        {hidden && <EyeOff className="absolute -left-5 top-0 h-3.5 w-3.5 text-white" />}
        {editing ? (
          <InlineTextEditor layer={layer} onCommit={onCommitEdit} onCancel={onCancelEdit} />
        ) : playing ? (
          <motion.div
            key={`play-${playKey}`}
            initial={variant.initial}
            animate={variant.animate}
            transition={buildLayerTransition(animation, false)}
          >
            <LayerContentBody layer={layer} />
          </motion.div>
        ) : (
          <LayerContentBody layer={layer} />
        )}
        {showResizeHandles && <ResizeHandles onResizeStart={onResizeStart} />}
      </div>
    </div>
  );
}

export function HeroCanvas({
  slider,
  slide,
  device,
  selectedLayerId,
  playing,
  playKey,
  onSelectLayer,
  onUpdateLayer,
}: {
  slider: Slider;
  slide: Slide;
  device: DeviceMode;
  selectedLayerId: string | null;
  playing: boolean;
  playKey: number;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (layerId: string, updater: (layer: SliderLayer) => SliderLayer) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);

  return (
    <div className="hero-studio-stage flex flex-1 items-center justify-center overflow-auto p-8" style={{ background: "var(--hs-stage-bg)" }}>
      <div className={canvasWidthClass(device)} style={canvasBoxStyle(slider, device)}>
        <div
          ref={canvasRef}
          className="site-scope absolute inset-0"
          onPointerDown={() => {
            if (editingLayerId) return;
            onSelectLayer(null);
          }}
        >
          <SlideBackgroundPreview slide={slide} />
          {slide.bgOverlayColor && slide.bgOverlayOpacity > 0 && (
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: `${slide.bgOverlayColor}${Math.round((slide.bgOverlayOpacity / 100) * 255)
                  .toString(16)
                  .padStart(2, "0")}`,
              }}
            />
          )}
          {slide.layers.map((layer) => (
            <LayerBox
              key={layer.id}
              layer={layer}
              device={device}
              selected={layer.id === selectedLayerId}
              editing={layer.id === editingLayerId}
              playing={playing}
              playKey={playKey}
              onSelect={() => onSelectLayer(layer.id)}
              onStartEdit={() => {
                onSelectLayer(layer.id);
                setEditingLayerId(layer.id);
              }}
              onCommitEdit={(text) => {
                onUpdateLayer(layer.id, (current) => withText(current, text));
                setEditingLayerId(null);
              }}
              onCancelEdit={() => setEditingLayerId(null)}
              onDrag={(xPercent, yPercent) =>
                onUpdateLayer(layer.id, (current) => patchLayerGroup(current, device, "position", { xPercent, yPercent }))
              }
              onResize={(widthPercent) => onUpdateLayer(layer.id, (current) => patchLayerGroup(current, device, "position", { widthPercent }))}
              canvasRef={canvasRef}
            />
          ))}
          {slide.layers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
              Üstteki &quot;Katman Ekle&quot; çubuğundan bu slayta katman ekleyin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
