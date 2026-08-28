"use client";

import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  Heading,
  ImageIcon,
  MousePointerClick,
  Tag,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { SliderLayer, SliderLayerType } from "@/lib/sliders/types";
import { SLIDER_LAYER_TYPE_COLOR, SLIDER_LAYER_TYPE_LABEL } from "@/lib/sliders/design-tokens";
import { joinOrigin, splitOrigin } from "@/lib/sliders/layer-render";
import { patchLayerGroup, resolveGroupForEditing } from "./layer-mutations";

const LAYER_TYPE_ICON: Record<SliderLayerType, typeof Heading> = {
  heading: Heading,
  text: Type,
  button: MousePointerClick,
  image: ImageIcon,
  badge: Tag,
};

/**
 * ui-designer kararı (bkz. `.claude/ui-designer-scope-advanced-slider.md` §7.1): "Katman Ekle" +
 * hizalama araçları tuvalin HEMEN ÜSTÜNDE, tek ve DAİMA görünür bir çubukta toplanır — sağ
 * panelin "Katman" sekmesine gömülü olsaydı yalnızca o sekme açıkken görünür kalırdı ve
 * keşfedilebilirlik düşerdi. Hizalama butonları seçili katman YOKKEN devre dışıdır (`disabled`,
 * opacity düşürülmüş) — boş bir işlemi görünür ama tıklanamaz bırakmak, tamamen gizlemekten
 * daha az şaşırtıcıdır (kullanıcı "neden yok" değil "neden pasif" sorar, cevabı daha açık).
 */
export function QuickAddToolbar({
  selectedLayer,
  device,
  onAddLayer,
  onUpdateLayer,
}: {
  selectedLayer: SliderLayer | null;
  device: DeviceMode;
  onAddLayer: (type: SliderLayerType) => void;
  onUpdateLayer: (updater: (layer: SliderLayer) => SliderLayer) => void;
}) {
  function align(axis: "horizontal" | "vertical", value: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    onUpdateLayer((layer) => {
      const { value: position } = resolveGroupForEditing(layer, "position", device);
      const { vertical, horizontal } = splitOrigin(position.origin);
      if (axis === "horizontal") {
        const nextOrigin = joinOrigin(vertical, value as "left" | "center" | "right");
        const xPercent = value === "left" ? 0 : value === "right" ? 100 : 50;
        return patchLayerGroup(layer, device, "position", { origin: nextOrigin, xPercent });
      }
      const nextOrigin = joinOrigin(value as "top" | "middle" | "bottom", horizontal);
      const yPercent = value === "top" ? 0 : value === "bottom" ? 100 : 50;
      return patchLayerGroup(layer, device, "position", { origin: nextOrigin, yPercent });
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-foreground/50">Katman Ekle</span>
        {(Object.keys(LAYER_TYPE_ICON) as SliderLayerType[]).map((type) => {
          const Icon = LAYER_TYPE_ICON[type];
          return (
            <Button key={type} type="button" variant="outline" size="sm" onClick={() => onAddLayer(type)}>
              <Icon className="h-3.5 w-3.5" style={{ color: SLIDER_LAYER_TYPE_COLOR[type] }} />
              {SLIDER_LAYER_TYPE_LABEL[type]}
            </Button>
          );
        })}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Seçili katmanı hizala">
        <Button type="button" variant="ghost" size="icon-sm" title="Sola yasla" aria-label="Sola yasla" disabled={!selectedLayer} onClick={() => align("horizontal", "left")}>
          <AlignHorizontalJustifyStart className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Yatayda ortala"
          aria-label="Yatayda ortala"
          disabled={!selectedLayer}
          onClick={() => align("horizontal", "center")}
        >
          <AlignHorizontalJustifyCenter className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" title="Sağa yasla" aria-label="Sağa yasla" disabled={!selectedLayer} onClick={() => align("horizontal", "right")}>
          <AlignHorizontalJustifyEnd className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Dikeyde ortala"
          aria-label="Dikeyde ortala"
          disabled={!selectedLayer}
          onClick={() => align("vertical", "middle")}
        >
          <AlignVerticalJustifyCenter className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
