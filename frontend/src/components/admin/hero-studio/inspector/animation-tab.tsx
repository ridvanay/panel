"use client";

import { AlertTriangle } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DeviceMode } from "@/lib/page-builder/types";
import type { SliderLayer, SliderLayerInEffect } from "@/lib/sliders/types";
import { DeviceOverrideBadge } from "./device-override-badge";
import { patchLayerGroup, removeLayerGroupOverride, resolveGroupForEditing, type ResponsiveDevice } from "../layer-mutations";

const IN_EFFECT_OPTIONS: { value: SliderLayerInEffect; label: string }[] = [
  { value: "none", label: "Yok" },
  { value: "fade", label: "Belirme" },
  { value: "fade-up", label: "Yukarı Belirme" },
  { value: "fade-down", label: "Aşağı Belirme" },
  { value: "slide-in-left", label: "Soldan Kayma" },
  { value: "slide-in-right", label: "Sağdan Kayma" },
  { value: "zoom-in", label: "Yakınlaşma" },
  { value: "flip-up", label: "Çevirerek Belirme" },
  { value: "elastic-bounce", label: "Esnek Sıçrama" },
];

export function AnimationInspectorTab({
  layer,
  device,
  slideEffectiveDurationMs,
  onUpdateLayer,
}: {
  layer: SliderLayer | null;
  device: DeviceMode;
  slideEffectiveDurationMs: number;
  onUpdateLayer: (updater: (layer: SliderLayer) => SliderLayer) => void;
}) {
  if (!layer) {
    return <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-foreground/50">Animasyonunu düzenlemek için bir katman seçin.</p>;
  }

  const { value: animation, overridden } = resolveGroupForEditing(layer, "animation", device);
  const isResponsiveDevice = device !== "desktop";
  const exceedsSlideDuration = animation.delayMs + animation.durationMs > slideEffectiveDurationMs;

  function patch(p: Partial<typeof animation>) {
    onUpdateLayer((l) => patchLayerGroup(l, device, "animation", p));
  }

  return (
    <div className={cn("space-y-4 rounded-md p-1", isResponsiveDevice && "border border-dashed border-border p-3")}>
      {isResponsiveDevice && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Bu cihaz</p>
          <DeviceOverrideBadge overridden={overridden} onRemove={() => onUpdateLayer((l) => removeLayerGroupOverride(l, device as ResponsiveDevice, "animation"))} />
        </div>
      )}

      <Field id="anim-inEffect" label="Giriş efekti">
        {(p) => (
          <Select {...p} value={animation.inEffect} onChange={(e) => patch({ inEffect: e.target.value as SliderLayerInEffect })}>
            {IN_EFFECT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="anim-delay" label="Gecikme (ms)" hint="Slaytın aktif olduğu andan itibaren.">
          {(p) => (
            <Input {...p} type="number" min={0} max={10000} step={50} value={animation.delayMs} onChange={(e) => patch({ delayMs: Number(e.target.value) })} />
          )}
        </Field>
        <Field id="anim-duration" label="Süre (ms)">
          {(p) => (
            <Input {...p} type="number" min={100} max={3000} step={50} value={animation.durationMs} onChange={(e) => patch({ durationMs: Number(e.target.value) })} />
          )}
        </Field>
      </div>

      <Field
        id="anim-easing"
        label="Yumuşatma (easing)"
        hint={animation.inEffect === "elastic-bounce" ? "Esnek Sıçrama kendi yay eğrisini kullanır, bu ayar yok sayılır." : undefined}
      >
        {(p) => (
          <Select
            {...p}
            disabled={animation.inEffect === "elastic-bounce"}
            value={animation.easing ?? "ease-out"}
            onChange={(e) => patch({ easing: e.target.value as typeof animation.easing })}
          >
            <option value="ease-out">Ease Out</option>
            <option value="linear">Linear</option>
            <option value="ease-in-out">Ease In Out</option>
            <option value="spring">Yay (Spring)</option>
          </Select>
        )}
      </Field>

      {exceedsSlideDuration && (
        <div className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Gecikme + süre, slaytın gösterim süresini aşıyor — katman hiç görünmeden slayt değişebilir.</span>
        </div>
      )}

      <p className="rounded-md border border-dashed border-border p-3 text-xs text-foreground/50">
        Çıkış animasyonu ayarlanamaz — tüm katmanlar 300ms&apos;lik sabit bir solma (fade) ile çıkar.
      </p>
    </div>
  );
}
