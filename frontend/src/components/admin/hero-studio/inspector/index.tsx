"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { Slide, Slider, SliderLayer } from "@/lib/sliders/types";
import { SlideInspectorTab } from "./slide-tab";
import { LayerInspectorTab } from "./layer-tab";
import { AnimationInspectorTab } from "./animation-tab";
import { SliderInspectorTab } from "./slider-tab";

export type InspectorTabValue = "slide" | "layer" | "animation" | "slider";

export function HeroStudioInspector({
  slider,
  slide,
  layer,
  device,
  tab,
  onTabChange,
  onUpdateSlider,
  onUpdateSlide,
  onUpdateLayer,
  onDeleteLayer,
}: {
  slider: Slider;
  slide: Slide | null;
  layer: SliderLayer | null;
  device: DeviceMode;
  tab: InspectorTabValue;
  onTabChange: (tab: InspectorTabValue) => void;
  onUpdateSlider: (patch: Partial<Slider>) => void;
  onUpdateSlide: (patch: Partial<Slide>) => void;
  onUpdateLayer: (updater: (layer: SliderLayer) => SliderLayer) => void;
  onDeleteLayer: () => void;
}) {
  return (
    <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-border bg-surface p-4">
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as InspectorTabValue)}>
        <TabsList variant="line" className="w-full">
          <TabsTrigger value="slide">Slayt</TabsTrigger>
          <TabsTrigger value="layer">Katman</TabsTrigger>
          <TabsTrigger value="animation">Animasyon</TabsTrigger>
          <TabsTrigger value="slider">Slider</TabsTrigger>
        </TabsList>

        <TabsContent value="slide" className="pt-4">
          {slide ? (
            <SlideInspectorTab slide={slide} onUpdate={onUpdateSlide} />
          ) : (
            <p className="text-sm text-foreground/50">Düzenlemek için bir slayt seçin.</p>
          )}
        </TabsContent>

        <TabsContent value="layer" className="pt-4">
          <LayerInspectorTab layer={layer} device={device} onUpdateLayer={onUpdateLayer} onDeleteLayer={onDeleteLayer} />
        </TabsContent>

        <TabsContent value="animation" className="pt-4">
          <AnimationInspectorTab
            layer={layer}
            device={device}
            slideEffectiveDurationMs={slide?.durationMs ?? slider.intervalMs}
            onUpdateLayer={onUpdateLayer}
          />
        </TabsContent>

        <TabsContent value="slider" className="pt-4">
          <SliderInspectorTab slider={slider} device={device} onUpdate={onUpdateSlider} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
