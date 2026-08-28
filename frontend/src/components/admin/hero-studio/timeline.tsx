"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { Slide, Slider, SliderLayer } from "@/lib/sliders/types";
import { SLIDER_LAYER_TYPE_COLOR, SLIDER_LAYER_TYPE_LABEL } from "@/lib/sliders/design-tokens";
import { patchLayerGroup, resolveGroupForEditing } from "./layer-mutations";

function clampToStep(value: number, step: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

function tickStep(totalMs: number): number {
  return totalMs > 4000 ? 1000 : 500;
}

function TimelineRuler({ totalMs }: { totalMs: number }) {
  const step = tickStep(totalMs);
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs; t += step) ticks.push(t);
  return (
    <div className="relative h-5 border-b" style={{ borderColor: "var(--hs-panel-border)" }}>
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 text-[11px]"
          style={{ left: `${(t / totalMs) * 100}%`, color: "var(--hs-text-muted)" }}
        >
          {t / 1000}s
        </span>
      ))}
    </div>
  );
}

function LayerBar({
  layer,
  device,
  totalMs,
  selected,
  trackRef,
  onSelect,
  onUpdate,
}: {
  layer: SliderLayer;
  device: DeviceMode;
  totalMs: number;
  selected: boolean;
  trackRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onUpdate: (updater: (layer: SliderLayer) => SliderLayer) => void;
}) {
  const { value: animation } = resolveGroupForEditing(layer, "animation", device);
  const dragModeRef = useRef<"move" | "resize" | null>(null);
  const startRef = useRef<{ x: number; delayMs: number; durationMs: number } | null>(null);

  function beginDrag(mode: "move" | "resize", e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    onSelect();
    dragModeRef.current = mode;
    startRef.current = { x: e.clientX, delayMs: animation.delayMs, durationMs: animation.durationMs };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragModeRef.current || !startRef.current || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const deltaMs = ((e.clientX - startRef.current.x) / rect.width) * totalMs;
    if (dragModeRef.current === "move") {
      const nextDelay = clampToStep(startRef.current.delayMs + deltaMs, 50, 0, 10000);
      onUpdate((current) => patchLayerGroup(current, device, "animation", { delayMs: nextDelay }));
    } else {
      const nextDuration = clampToStep(startRef.current.durationMs + deltaMs, 50, 100, 3000);
      onUpdate((current) => patchLayerGroup(current, device, "animation", { durationMs: nextDuration }));
    }
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    dragModeRef.current = null;
    startRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const leftPercent = Math.min(100, (animation.delayMs / totalMs) * 100);
  const widthPercent = Math.max(2, Math.min(100 - leftPercent, (animation.durationMs / totalMs) * 100));

  return (
    <div className="relative h-8">
      <div
        className="absolute top-1 h-6 cursor-grab rounded-md active:cursor-grabbing"
        style={{
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          backgroundColor: SLIDER_LAYER_TYPE_COLOR[layer.type],
          opacity: selected ? 1 : 0.7,
          boxShadow: selected ? "0 0 0 2px #ffffff" : undefined,
        }}
        onPointerDown={(e) => beginDrag("move", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        title={`${SLIDER_LAYER_TYPE_LABEL[layer.type]} · ${animation.delayMs}ms → ${animation.delayMs + animation.durationMs}ms`}
      >
        <div
          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md bg-black/20"
          onPointerDown={(e) => beginDrag("resize", e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
      </div>
    </div>
  );
}

export function HeroStudioTimeline({
  slider,
  slide,
  device,
  selectedLayerId,
  playing,
  playKey,
  onSelectLayer,
  onUpdateLayer,
  onPlay,
  onPlayComplete,
}: {
  slider: Slider;
  slide: Slide;
  device: DeviceMode;
  selectedLayerId: string | null;
  playing: boolean;
  playKey: number;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (layerId: string, updater: (layer: SliderLayer) => SliderLayer) => void;
  onPlay: () => void;
  onPlayComplete: () => void;
}) {
  const totalMs = slide.durationMs ?? slider.intervalMs;
  const trackRef = useRef<HTMLDivElement>(null);

  return (
    <div className="hero-studio-stage flex h-48 shrink-0 flex-col overflow-hidden border-t" style={{ background: "var(--hs-panel-bg)", borderColor: "var(--hs-panel-border)" }}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium" style={{ color: "var(--hs-text)" }}>
          Zaman Çizelgesi — {slide.layers.length} katman · {(totalMs / 1000).toFixed(1)}s
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={onPlay} disabled={slide.layers.length === 0}>
          <Play className="h-3.5 w-3.5" />
          Oynat
        </Button>
      </div>
      <div className="relative flex-1 overflow-y-auto px-3 pb-2" ref={trackRef} onPointerDown={() => onSelectLayer(null)}>
        <TimelineRuler totalMs={totalMs} />
        <div className="relative space-y-1 pt-1">
          {slide.layers.map((layer) => (
            <div key={layer.id} onPointerDownCapture={(e) => e.stopPropagation()}>
              <LayerBar
                layer={layer}
                device={device}
                totalMs={totalMs}
                selected={layer.id === selectedLayerId}
                trackRef={trackRef}
                onSelect={() => onSelectLayer(layer.id)}
                onUpdate={(updater) => onUpdateLayer(layer.id, updater)}
              />
            </div>
          ))}
        </div>
        {playing && (
          <motion.div
            key={playKey}
            className="pointer-events-none absolute top-5 bottom-0 w-0.5"
            style={{ background: "#ffffff", boxShadow: "0 0 6px rgb(255 255 255 / 0.6)" }}
            initial={{ left: "0%" }}
            animate={{ left: "100%" }}
            transition={{ duration: totalMs / 1000, ease: "linear" }}
            onAnimationComplete={onPlayComplete}
          />
        )}
      </div>
    </div>
  );
}
