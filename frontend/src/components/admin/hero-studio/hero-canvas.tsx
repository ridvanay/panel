"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { Slide, Slider, SliderLayer, SliderLayerOrigin } from "@/lib/sliders/types";
import { SLIDER_LAYER_TYPE_COLOR } from "@/lib/sliders/design-tokens";
import { isLayerHiddenOnDevice, patchLayerGroup, resolveGroupForEditing } from "./layer-mutations";

const ORIGIN_PERCENT: Record<SliderLayerOrigin, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 },
  "top-center": { x: 50, y: 0 },
  "top-right": { x: 100, y: 0 },
  "middle-left": { x: 0, y: 50 },
  "middle-center": { x: 50, y: 50 },
  "middle-right": { x: 100, y: 50 },
  "bottom-left": { x: 0, y: 100 },
  "bottom-center": { x: 50, y: 100 },
  "bottom-right": { x: 100, y: 100 },
};

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

function LayerBox({
  layer,
  device,
  selected,
  onSelect,
  onDrag,
  canvasRef,
}: {
  layer: SliderLayer;
  device: DeviceMode;
  selected: boolean;
  onSelect: () => void;
  onDrag: (xPercent: number, yPercent: number) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { value: position } = resolveGroupForEditing(layer, "position", device);
  const { value: style } = resolveGroupForEditing(layer, "style", device);
  const hidden = isLayerHiddenOnDevice(layer, device);
  const origin = ORIGIN_PERCENT[position.origin];
  const draggingRef = useRef(false);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
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

  const previewLabel =
    layer.type === "heading" || layer.type === "text" || layer.type === "badge"
      ? layer.content.text
      : layer.type === "button"
        ? layer.content.label
        : "Görsel";

  return (
    <div
      className="absolute cursor-grab select-none active:cursor-grabbing"
      style={{
        left: `${position.xPercent}%`,
        top: `${position.yPercent}%`,
        transform: `translate(-${origin.x}%, -${origin.y}%)`,
        zIndex: position.zIndex ?? 1,
        opacity: hidden ? 0.35 : 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="max-w-[240px] truncate rounded-md px-2 py-1 text-xs font-medium text-white"
        style={{
          backgroundColor: SLIDER_LAYER_TYPE_COLOR[layer.type],
          boxShadow: selected ? "0 0 0 1px rgb(0 0 0 / 0.45), 0 0 0 3px var(--accent-500, #6366f1)" : undefined,
          color: style.color ?? "#ffffff",
          fontWeight: style.fontWeight,
        }}
      >
        {hidden && <EyeOff className="mr-1 inline-block h-3 w-3" />}
        {previewLabel || "(boş)"}
      </div>
    </div>
  );
}

export function HeroCanvas({
  slider,
  slide,
  device,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
}: {
  slider: Slider;
  slide: Slide;
  device: DeviceMode;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (layerId: string, updater: (layer: SliderLayer) => SliderLayer) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div className="hero-studio-stage flex flex-1 items-center justify-center overflow-auto p-8" style={{ background: "var(--hs-stage-bg)" }}>
      <div className={canvasWidthClass(device)} style={canvasBoxStyle(slider, device)}>
        <div ref={canvasRef} className="absolute inset-0" onPointerDown={() => onSelectLayer(null)}>
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
              onSelect={() => onSelectLayer(layer.id)}
              onDrag={(xPercent, yPercent) =>
                onUpdateLayer(layer.id, (current) => patchLayerGroup(current, device, "position", { xPercent, yPercent }))
              }
              canvasRef={canvasRef}
            />
          ))}
          {slide.layers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
              Sağdaki &quot;Katman&quot; sekmesinden bu slayta katman ekleyin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
