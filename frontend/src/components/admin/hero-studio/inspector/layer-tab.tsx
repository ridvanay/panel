"use client";

import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { SliderLayer, SliderLayerOrigin } from "@/lib/sliders/types";
import { SLIDER_LAYER_TYPE_COLOR, SLIDER_LAYER_TYPE_LABEL } from "@/lib/sliders/design-tokens";
import { DeviceOverrideBadge } from "./device-override-badge";
import {
  isLayerHiddenOnDevice,
  patchLayerGroup,
  removeLayerGroupOverride,
  resolveGroupForEditing,
  setLayerHidden,
  type ResponsiveDevice,
} from "../layer-mutations";

const DEVICE_LABEL: Record<ResponsiveDevice, string> = { tablet: "Tablet", mobile: "Mobil" };

const ORIGIN_OPTIONS: { value: SliderLayerOrigin; label: string }[] = [
  { value: "top-left", label: "Üst Sol" },
  { value: "top-center", label: "Üst Orta" },
  { value: "top-right", label: "Üst Sağ" },
  { value: "middle-left", label: "Orta Sol" },
  { value: "middle-center", label: "Tam Orta" },
  { value: "middle-right", label: "Orta Sağ" },
  { value: "bottom-left", label: "Alt Sol" },
  { value: "bottom-center", label: "Alt Orta" },
  { value: "bottom-right", label: "Alt Sağ" },
];

function updateContent(layer: SliderLayer, patch: Record<string, unknown>): SliderLayer {
  return { ...layer, content: { ...layer.content, ...patch } } as SliderLayer;
}

function LayerContentFields({ layer, onUpdate }: { layer: SliderLayer; onUpdate: (updater: (layer: SliderLayer) => SliderLayer) => void }) {
  if (layer.type === "heading") {
    return (
      <>
        <Field id="layer-heading-text" label="Metin" required>
          {(p) => <Textarea {...p} rows={2} value={layer.content.text} onChange={(e) => onUpdate((l) => updateContent(l, { text: e.target.value }))} />}
        </Field>
        <Field id="layer-heading-level" label="Başlık seviyesi" hint="Sayfada tek h1 kuralına dikkat edin.">
          {(p) => (
            <Select {...p} value={String(layer.content.level ?? 2)} onChange={(e) => onUpdate((l) => updateContent(l, { level: Number(e.target.value) }))}>
              <option value="1">H1</option>
              <option value="2">H2</option>
              <option value="3">H3</option>
            </Select>
          )}
        </Field>
      </>
    );
  }
  if (layer.type === "text") {
    return (
      <Field id="layer-text-text" label="Metin" required>
        {(p) => <Textarea {...p} rows={4} value={layer.content.text} onChange={(e) => onUpdate((l) => updateContent(l, { text: e.target.value }))} />}
      </Field>
    );
  }
  if (layer.type === "badge") {
    return (
      <Field id="layer-badge-text" label="Rozet metni" required>
        {(p) => <Input {...p} value={layer.content.text} onChange={(e) => onUpdate((l) => updateContent(l, { text: e.target.value }))} />}
      </Field>
    );
  }
  if (layer.type === "image") {
    return (
      <>
        <Field id="layer-image-url" label="Görsel URL'si" required>
          {(p) => <Input {...p} value={layer.content.url} onChange={(e) => onUpdate((l) => updateContent(l, { url: e.target.value }))} />}
        </Field>
        <Field id="layer-image-alt" label="Alt metin" required hint="Erişilebilirlik için zorunlu.">
          {(p) => <Input {...p} value={layer.content.alt} onChange={(e) => onUpdate((l) => updateContent(l, { alt: e.target.value }))} />}
        </Field>
      </>
    );
  }
  // button
  return (
    <>
      <Field id="layer-button-label" label="Etiket" required>
        {(p) => <Input {...p} value={layer.content.label} onChange={(e) => onUpdate((l) => updateContent(l, { label: e.target.value }))} />}
      </Field>
      <Field id="layer-button-href" label="Bağlantı" required>
        {(p) => <Input {...p} value={layer.content.href} onChange={(e) => onUpdate((l) => updateContent(l, { href: e.target.value }))} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="layer-button-variant" label="Varyant">
          {(p) => (
            <Select {...p} value={layer.content.variant} onChange={(e) => onUpdate((l) => updateContent(l, { variant: e.target.value }))}>
              <option value="solid">Dolu</option>
              <option value="outline">Çerçeveli</option>
              <option value="ghost">Sade</option>
            </Select>
          )}
        </Field>
        <Field id="layer-button-size" label="Boyut">
          {(p) => (
            <Select {...p} value={layer.content.size} onChange={(e) => onUpdate((l) => updateContent(l, { size: e.target.value }))}>
              <option value="sm">Küçük</option>
              <option value="md">Orta</option>
              <option value="lg">Büyük</option>
            </Select>
          )}
        </Field>
      </div>
    </>
  );
}

export function LayerInspectorTab({
  layer,
  device,
  onUpdateLayer,
  onDeleteLayer,
}: {
  layer: SliderLayer | null;
  device: DeviceMode;
  onUpdateLayer: (updater: (layer: SliderLayer) => SliderLayer) => void;
  onDeleteLayer: () => void;
}) {
  if (!layer) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/50">
        Tuvalde veya zaman çizelgesinde bir katman seçin, ya da tuvalin üstündeki &quot;Katman Ekle&quot;
        çubuğundan yeni bir katman ekleyin.
      </p>
    );
  }
  return <LayerFields layer={layer} device={device} onUpdate={onUpdateLayer} onDelete={onDeleteLayer} />;
}

function LayerFields({
  layer,
  device,
  onUpdate,
  onDelete,
}: {
  layer: SliderLayer;
  device: DeviceMode;
  onUpdate: (updater: (layer: SliderLayer) => SliderLayer) => void;
  onDelete: () => void;
}) {
  const { value: position, overridden: positionOverridden } = resolveGroupForEditing(layer, "position", device);
  const { value: style, overridden: styleOverridden } = resolveGroupForEditing(layer, "style", device);
  const isResponsiveDevice = device !== "desktop";

  function patchPosition(patch: Partial<typeof position>) {
    onUpdate((l) => patchLayerGroup(l, device, "position", patch));
  }
  function patchStyle(patch: Partial<typeof style>) {
    onUpdate((l) => patchLayerGroup(l, device, "style", patch));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: SLIDER_LAYER_TYPE_COLOR[layer.type] }}>
          {SLIDER_LAYER_TYPE_LABEL[layer.type]}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Katmanı sil" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">İçerik</p>
        <LayerContentFields layer={layer} onUpdate={onUpdate} />
      </div>

      <div className={cn("space-y-3 rounded-md p-3", isResponsiveDevice && "border border-dashed border-border")}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Pozisyon</p>
          {isResponsiveDevice && (
            <DeviceOverrideBadge overridden={positionOverridden} onRemove={() => onUpdate((l) => removeLayerGroupOverride(l, device as ResponsiveDevice, "position"))} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="layer-pos-x" label="X (%)">
            {(p) => <Input {...p} type="number" min={0} max={100} value={position.xPercent} onChange={(e) => patchPosition({ xPercent: Number(e.target.value) })} />}
          </Field>
          <Field id="layer-pos-y" label="Y (%)">
            {(p) => <Input {...p} type="number" min={0} max={100} value={position.yPercent} onChange={(e) => patchPosition({ yPercent: Number(e.target.value) })} />}
          </Field>
        </div>
        <Field id="layer-pos-origin" label="Hizalama noktası">
          {(p) => (
            <Select {...p} value={position.origin} onChange={(e) => patchPosition({ origin: e.target.value as SliderLayerOrigin })}>
              {ORIGIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="layer-pos-offx" label="X ince ayar (px)">
            {(p) => <Input {...p} type="number" min={-400} max={400} value={position.offsetX ?? 0} onChange={(e) => patchPosition({ offsetX: Number(e.target.value) })} />}
          </Field>
          <Field id="layer-pos-offy" label="Y ince ayar (px)">
            {(p) => <Input {...p} type="number" min={-400} max={400} value={position.offsetY ?? 0} onChange={(e) => patchPosition({ offsetY: Number(e.target.value) })} />}
          </Field>
        </div>
        <Field id="layer-pos-width" label="Genişlik (%)" hint="Boş bırakılırsa içerik kadar.">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={100}
              value={position.widthPercent ?? ""}
              onChange={(e) => patchPosition({ widthPercent: e.target.value ? Number(e.target.value) : undefined })}
            />
          )}
        </Field>
      </div>

      <div className={cn("space-y-3 rounded-md p-3", isResponsiveDevice && "border border-dashed border-border")}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Stil</p>
          {isResponsiveDevice && (
            <DeviceOverrideBadge overridden={styleOverridden} onRemove={() => onUpdate((l) => removeLayerGroupOverride(l, device as ResponsiveDevice, "style"))} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="layer-style-color" label="Metin rengi">
            {(p) => <Input {...p} type="color" value={style.color ?? "#ffffff"} onChange={(e) => patchStyle({ color: e.target.value })} />}
          </Field>
          <Field id="layer-style-fontSize" label="Punto (px)">
            {(p) => (
              <Input {...p} type="number" min={8} max={200} value={style.fontSize ?? ""} onChange={(e) => patchStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })} />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="layer-style-fontWeight" label="Kalınlık">
            {(p) => (
              <Select {...p} value={String(style.fontWeight ?? 400)} onChange={(e) => patchStyle({ fontWeight: Number(e.target.value) as typeof style.fontWeight })}>
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="layer-style-textAlign" label="Hizalama">
            {(p) => (
              <Select {...p} value={style.textAlign ?? "left"} onChange={(e) => patchStyle({ textAlign: e.target.value as typeof style.textAlign })}>
                <option value="left">Sol</option>
                <option value="center">Orta</option>
                <option value="right">Sağ</option>
              </Select>
            )}
          </Field>
        </div>
        <Field id="layer-style-shadow" label="Gölge">
          {(p) => (
            <Select {...p} value={style.shadow ?? "none"} onChange={(e) => patchStyle({ shadow: e.target.value as typeof style.shadow })}>
              <option value="none">Yok</option>
              <option value="sm">Küçük</option>
              <option value="md">Orta</option>
              <option value="lg">Büyük</option>
            </Select>
          )}
        </Field>
        <Field id="layer-style-opacity" label="Opaklık (%)">
          {(p) => (
            <Input {...p} type="number" min={0} max={100} value={style.opacity ?? 100} onChange={(e) => patchStyle({ opacity: Number(e.target.value) })} />
          )}
        </Field>
      </div>

      {isResponsiveDevice && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Cihaz Görünürlüğü</p>
          <label className="flex items-center justify-between gap-2 text-sm text-foreground">
            <span className="inline-flex items-center gap-1.5">
              {isLayerHiddenOnDevice(layer, device) ? <EyeOff className="h-3.5 w-3.5 text-foreground/50" /> : <Eye className="h-3.5 w-3.5 text-foreground/50" />}
              {DEVICE_LABEL[device as ResponsiveDevice]}&apos;de göster
            </span>
            <Switch
              checked={!isLayerHiddenOnDevice(layer, device)}
              onCheckedChange={(checked) => onUpdate((l) => setLayerHidden(l, device as ResponsiveDevice, !checked))}
              aria-label={`${DEVICE_LABEL[device as ResponsiveDevice]}'de göster/gizle`}
            />
          </label>
        </div>
      )}
    </div>
  );
}
