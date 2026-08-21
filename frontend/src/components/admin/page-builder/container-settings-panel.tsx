"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  ArrowRight,
  Ban,
  Blend,
  Circle,
  CircleDot,
  Columns2,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Palette as PaletteIcon,
  Plus,
  Rows2,
  StretchHorizontal,
  StretchVertical,
  Unlink2,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ColorField } from "@/components/admin/appearance/color-field";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { cn } from "@/lib/utils";
import {
  DEFAULT_CONTAINER_MAX_WIDTH,
  MAX_CONTAINER_DEPTH,
  MAX_CONTAINER_MAX_WIDTH,
  MIN_CONTAINER_MAX_WIDTH,
  ROW_CHILDREN_READABILITY_WARNING_THRESHOLD,
  type ContainerAlign,
  type ContainerAnimatedBackgroundVariant,
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
} from "@/lib/page-builder/types";

/**
 * design-notes-page-builder-container-ui.md §2 — konteyner ayar paneli. Sabit sağ panel
 * (§2.5 kesin karar — `Sheet`/modal YOK), üç bölüm: Düzen → Boşluk → Arka Plan. `StyleSection`
 * deseni (`email-editor/style-controls.tsx`) BİREBİR aynı sınıflarla, YEREL bir kopya olarak
 * (cross-feature import YAPILMAZ, §2.1).
 */

function SettingsSectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold tracking-wide text-foreground/40 uppercase">{children}</p>;
}

function SettingsSection({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={cn("space-y-2.5", !first && "border-t border-border/60 pt-4")}>
      <SettingsSectionLabel>{title}</SettingsSectionLabel>
      {children}
    </div>
  );
}

/** İki-dört seçenekli, ikon+metin segmented toggle — §2.2.1/§2.2.4/§2.4 ortak deseni. */
function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex w-fit flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {options.map(({ value: optionValue, label, icon: Icon }) => {
        const active = optionValue === value;
        return (
          <Button
            key={optionValue}
            type="button"
            size="xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            onClick={() => onChange(optionValue)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}

/** Tek-eksenli ikon-toggle-group (yalnızca ikon, `title`/`aria-label` ile açıklanır) — §2.2.5. */
function IconToggleGroup<T extends string>({
  value,
  options,
  iconFor,
  labelFor,
  onChange,
}: {
  value: T;
  options: readonly T[];
  iconFor: (v: T) => LucideIcon;
  labelFor: (v: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {options.map((optionValue) => {
        const Icon = iconFor(optionValue);
        const active = optionValue === value;
        const label = labelFor(optionValue);
        return (
          <Button
            key={optionValue}
            type="button"
            size="icon-xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(optionValue)}
          >
            <Icon className="h-3 w-3" />
          </Button>
        );
      })}
    </div>
  );
}

const JUSTIFY_OPTIONS = ["start", "center", "end", "between", "around", "evenly"] as const satisfies readonly ContainerJustify[];
const ALIGN_OPTIONS = ["stretch", "start", "center", "end"] as const satisfies readonly ContainerAlign[];

const JUSTIFY_LABEL: Record<ContainerJustify, string> = {
  start: "Başa hizala",
  center: "Ortala",
  end: "Sona hizala",
  between: "Aralarında boşluk",
  around: "Eşit dağıt (kenar boşluğu yarım)",
  evenly: "Eşit dağıt (kenar boşluğu tam)",
};

const ALIGN_LABEL: Record<ContainerAlign, string> = {
  stretch: "Doldur (stretch)",
  start: "Başa hizala",
  center: "Ortala",
  end: "Sona hizala",
};

const JUSTIFY_ICON_ROW: Record<ContainerJustify, LucideIcon> = {
  start: AlignHorizontalJustifyStart,
  center: AlignHorizontalJustifyCenter,
  end: AlignHorizontalJustifyEnd,
  between: AlignHorizontalSpaceBetween,
  around: AlignHorizontalSpaceAround,
  evenly: AlignHorizontalDistributeCenter,
};

const JUSTIFY_ICON_COLUMN: Record<ContainerJustify, LucideIcon> = {
  start: AlignVerticalJustifyStart,
  center: AlignVerticalJustifyCenter,
  end: AlignVerticalJustifyEnd,
  between: AlignVerticalSpaceBetween,
  around: AlignVerticalSpaceAround,
  evenly: AlignVerticalDistributeCenter,
};

const ALIGN_ICON_ROW: Record<ContainerAlign, LucideIcon> = {
  stretch: StretchVertical,
  start: AlignVerticalJustifyStart,
  center: AlignVerticalJustifyCenter,
  end: AlignVerticalJustifyEnd,
};

const ALIGN_ICON_COLUMN: Record<ContainerAlign, LucideIcon> = {
  stretch: StretchHorizontal,
  start: AlignHorizontalJustifyStart,
  center: AlignHorizontalJustifyCenter,
  end: AlignHorizontalJustifyEnd,
};

/** §2.2.3 — nullable `minHeight` alanı: kapalıyken "Ekle", açıkken değer + birim + temizle. */
function MinHeightField({ value, onChange }: { value: ContainerLength | undefined; onChange: (v: ContainerLength | undefined) => void }) {
  if (!value) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ value: 400, unit: "px" })}>
        <Plus className="h-3.5 w-3.5" />
        Minimum yükseklik ekle
      </Button>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">Minimum yükseklik</label>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Minimum yüksekliği kaldır" onClick={() => onChange(undefined)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <InputGroup>
        <InputGroupInput
          type="number"
          min={0}
          max={5000}
          value={value.value}
          onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5 pr-1">
          {(["px", "vh"] as const).map((unit) => (
            <Button
              key={unit}
              type="button"
              size="xs"
              variant={value.unit === unit ? "secondary" : "ghost"}
              aria-pressed={value.unit === unit}
              onClick={() => onChange({ ...value, unit })}
            >
              {unit}
            </Button>
          ))}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

const SIDE_LABEL: Record<keyof ContainerSpacing, string> = { top: "Üst", right: "Sağ", bottom: "Alt", left: "Sol" };

function LinkedSidesToggle({ linked, onToggle }: { linked: boolean; onToggle: () => void }) {
  const Icon = linked ? Link2 : Unlink2;
  return (
    <Button
      type="button"
      size="icon-xs"
      variant={linked ? "secondary" : "ghost"}
      aria-pressed={linked}
      aria-label={linked ? "Kenarları bağımsız yap" : "Kenarları birlikte değiştir"}
      title={linked ? "Kenarlar bağlı — biri değişince hepsi değişir" : "Kenarlar bağımsız"}
      onClick={onToggle}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

/** §2.3 — 4-kenar (padding/margin) kompakt 2×2 ızgara + "bağlı kenarlar" editör kolaylığı. */
function SpacingBoxControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ContainerSpacing;
  onChange: (next: ContainerSpacing) => void;
}) {
  const [linked, setLinked] = useState(false);

  function changeSide(side: keyof ContainerSpacing, raw: number) {
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 0;
    onChange(linked ? { top: clamped, right: clamped, bottom: clamped, left: clamped } : { ...value, [side]: clamped });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground/70">{label}</p>
        <LinkedSidesToggle linked={linked} onToggle={() => setLinked((v) => !v)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(SIDE_LABEL) as (keyof ContainerSpacing)[]).map((side) => (
          <div key={side} className="space-y-1">
            <label className="text-[11px] text-foreground/50">{SIDE_LABEL[side]}</label>
            <InputGroup>
              <InputGroupInput
                type="number"
                min={0}
                max={200}
                value={value[side]}
                onChange={(e) => changeSide(side, Number(e.target.value))}
              />
              <InputGroupAddon align="inline-end">px</InputGroupAddon>
            </InputGroup>
          </div>
        ))}
      </div>
    </div>
  );
}

const BG_TYPE_OPTIONS: { value: ContainerBackground["type"]; label: string; icon: LucideIcon }[] = [
  { value: "none", label: "Yok", icon: Ban },
  { value: "color", label: "Renk", icon: PaletteIcon },
  { value: "image", label: "Görsel", icon: ImageIcon },
  { value: "gradient", label: "Renk Geçişi", icon: Blend },
  { value: "animated", label: "Animasyonlu", icon: Waves },
];

const GRADIENT_DIRECTION_OPTIONS: { value: LinearGradientDirection; label: string }[] = [
  { value: "to-top", label: "Yukarı" },
  { value: "to-top-right", label: "Yukarı sağ" },
  { value: "to-right", label: "Sağa" },
  { value: "to-bottom-right", label: "Aşağı sağ" },
  { value: "to-bottom", label: "Aşağı" },
  { value: "to-bottom-left", label: "Aşağı sol" },
  { value: "to-left", label: "Sola" },
  { value: "to-top-left", label: "Yukarı sol" },
  { value: "custom-angle", label: "Özel açı…" },
];

const ANIMATED_VARIANT_OPTIONS: { value: ContainerAnimatedBackgroundVariant; label: string; icon: LucideIcon }[] = [
  { value: "gradient-wave", label: "Dalga", icon: Waves },
  { value: "dots", label: "Noktalar", icon: CircleDot },
  { value: "grid", label: "Izgara", icon: Grid3x3 },
];

/** Görsel arka plan üzerine opaklığı ayarlanabilir düz renk kaplaması (§1 "Overlay"). */
function OverlayControl({
  value,
  onChange,
}: {
  value: ContainerBackgroundOverlay | undefined;
  onChange: (next: ContainerBackgroundOverlay | undefined) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <label htmlFor="bg-overlay-enabled" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Layers className="h-3.5 w-3.5" />
          Kaplama (overlay)
        </label>
        <Switch
          id="bg-overlay-enabled"
          checked={value !== undefined}
          onCheckedChange={(enabled) => onChange(enabled ? { color: "#000000", opacity: 40 } : undefined)}
        />
      </div>
      {value && (
        <div className="grid grid-cols-2 gap-2">
          <ColorField id="bg-overlay-color" label="Kaplama rengi" value={value.color} onChange={(color) => onChange({ ...value, color })} />
          <Field id="bg-overlay-opacity" label="Opaklık (%)">
            {(p) => (
              <InputGroup>
                <InputGroupInput
                  {...p}
                  type="number"
                  min={0}
                  max={100}
                  value={value.opacity}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
                    onChange({ ...value, opacity: clamped });
                  }}
                />
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              </InputGroup>
            )}
          </Field>
        </div>
      )}
    </div>
  );
}

/** `gradient` arka plan tipi alt alanları. */
function GradientBackgroundFields({
  value,
  onChange,
}: {
  value: Extract<ContainerBackground, { type: "gradient" }>;
  onChange: (next: Extract<ContainerBackground, { type: "gradient" }>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Tip</p>
        <SegmentedToggle
          value={value.gradientType}
          options={[
            { value: "linear" as const, label: "Doğrusal (linear)", icon: ArrowRight },
            { value: "radial" as const, label: "Dairesel (radial)", icon: Circle },
          ]}
          onChange={(gradientType) => onChange({ ...value, gradientType })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ColorField id="bg-gradient-from" label="Renk 1" value={value.colorFrom} onChange={(colorFrom) => onChange({ ...value, colorFrom })} />
        <ColorField id="bg-gradient-to" label="Renk 2" value={value.colorTo} onChange={(colorTo) => onChange({ ...value, colorTo })} />
      </div>
      {value.gradientType === "linear" && (
        <>
          <Field id="bg-gradient-direction" label="Yön">
            {(p) => (
              <Select
                {...p}
                value={value.direction ?? "to-right"}
                onChange={(e) => onChange({ ...value, direction: e.target.value as LinearGradientDirection })}
              >
                {GRADIENT_DIRECTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {value.direction === "custom-angle" && (
            <Field id="bg-gradient-angle" label="Açı">
              {(p) => (
                <InputGroup>
                  <InputGroupInput
                    {...p}
                    type="number"
                    min={0}
                    max={360}
                    value={value.angle ?? 90}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(360, Math.round(raw))) : 0;
                      onChange({ ...value, angle: clamped });
                    }}
                  />
                  <InputGroupAddon align="inline-end">°</InputGroupAddon>
                </InputGroup>
              )}
            </Field>
          )}
        </>
      )}
    </div>
  );
}

/** `animated` arka plan tipi alt alanları — "Floating / Gradient Wave" VEYA statik "Dots"/"Grid". */
function AnimatedBackgroundFields({
  value,
  onChange,
}: {
  value: Extract<ContainerBackground, { type: "animated" }>;
  onChange: (next: Extract<ContainerBackground, { type: "animated" }>) => void;
}) {
  function setVariant(variant: ContainerAnimatedBackgroundVariant) {
    if (variant === "gradient-wave") onChange({ type: "animated", variant, colorFrom: "#4f46e5", colorTo: "#0ea5e9" });
    else onChange({ type: "animated", variant, patternColor: "#94a3b8" });
  }

  return (
    <div className="space-y-3">
      <SegmentedToggle value={value.variant} options={ANIMATED_VARIANT_OPTIONS} onChange={setVariant} />
      {value.variant === "gradient-wave" ? (
        <div className="grid grid-cols-2 gap-2">
          <ColorField id="bg-anim-from" label="Renk 1" value={value.colorFrom} onChange={(colorFrom) => onChange({ ...value, colorFrom })} />
          <ColorField id="bg-anim-to" label="Renk 2" value={value.colorTo} onChange={(colorTo) => onChange({ ...value, colorTo })} />
        </div>
      ) : (
        <ColorField
          id="bg-anim-pattern-color"
          label="Desen rengi"
          value={value.patternColor}
          onChange={(patternColor) => onChange({ ...value, patternColor })}
        />
      )}
    </div>
  );
}

/** §2.4 — arka plan tipi segmented toggle + tipe göre alt alanlar. */
function BackgroundControl({ value, onChange }: { value: ContainerBackground; onChange: (next: ContainerBackground) => void }) {
  function setType(type: ContainerBackground["type"]) {
    if (type === "none") onChange({ type: "none" });
    else if (type === "color") onChange({ type: "color", value: value.type === "color" ? value.value : "#111827" });
    else if (type === "image") {
      onChange({
        type: "image",
        value: value.type === "image" ? value.value : "",
        position: value.type === "image" ? value.position : "center",
        size: value.type === "image" ? value.size : "cover",
        repeat: value.type === "image" ? value.repeat : "no-repeat",
        overlay: value.type === "image" ? value.overlay : undefined,
      });
    } else if (type === "gradient") {
      onChange(
        value.type === "gradient"
          ? value
          : { type: "gradient", gradientType: "linear", colorFrom: "#4f46e5", colorTo: "#0ea5e9", direction: "to-right" }
      );
    } else {
      onChange(value.type === "animated" ? value : { type: "animated", variant: "gradient-wave", colorFrom: "#4f46e5", colorTo: "#0ea5e9" });
    }
  }

  return (
    <div className="space-y-3">
      <SegmentedToggle value={value.type} options={BG_TYPE_OPTIONS} onChange={setType} />

      {value.type === "color" && (
        <ColorField
          id="container-bg-color"
          label="Arka plan rengi"
          value={value.value}
          maxLength={9}
          onChange={(hex) => onChange({ type: "color", value: hex })}
        />
      )}

      {value.type === "image" && (
        <div className="space-y-3">
          <ImageUploadField
            id="container-bg-image"
            label="Arka plan görseli"
            value={value.value}
            onChange={(url) => onChange({ ...value, value: url })}
          />
          <Field id="bg-position" label="Konum">
            {(p) => (
              <Select
                {...p}
                value={value.position}
                onChange={(e) => onChange({ ...value, position: e.target.value as ContainerBackgroundPosition })}
              >
                <option value="center">Orta</option>
                <option value="top">Üst</option>
                <option value="bottom">Alt</option>
                <option value="left">Sol</option>
                <option value="right">Sağ</option>
              </Select>
            )}
          </Field>
          <Field id="bg-size" label="Boyutlandırma">
            {(p) => (
              <Select {...p} value={value.size} onChange={(e) => onChange({ ...value, size: e.target.value as ContainerBackgroundSize })}>
                <option value="cover">Kapla (cover)</option>
                <option value="contain">Sığdır (contain)</option>
                <option value="auto">Otomatik</option>
              </Select>
            )}
          </Field>
          <Field id="bg-repeat" label="Tekrar">
            {(p) => (
              <Select
                {...p}
                value={value.repeat}
                onChange={(e) => onChange({ ...value, repeat: e.target.value as ContainerBackgroundRepeat })}
              >
                <option value="no-repeat">Tekrarsız</option>
                <option value="repeat">Tekrarlı</option>
              </Select>
            )}
          </Field>
          <OverlayControl value={value.overlay} onChange={(overlay) => onChange({ ...value, overlay })} />
        </div>
      )}

      {value.type === "gradient" && <GradientBackgroundFields value={value} onChange={onChange} />}
      {value.type === "animated" && <AnimatedBackgroundFields value={value} onChange={onChange} />}
    </div>
  );
}

export function ContainerSettingsPanel({
  container,
  depth,
  onChange,
  onClose,
}: {
  container: ContainerNode;
  /** Kök = 1. `builder-canvas.tsx::containerDepth` ile hesaplanır. */
  depth: number;
  onChange: (patch: Partial<ContainerSettings>) => void;
  onClose: () => void;
}) {
  const { settings } = container;
  const isRow = settings.direction === "row";
  const tooManyForReadability = isRow && container.children.length >= ROW_CHILDREN_READABILITY_WARNING_THRESHOLD;
  const justifyIcon = isRow ? JUSTIFY_ICON_ROW : JUSTIFY_ICON_COLUMN;
  const alignIcon = isRow ? ALIGN_ICON_ROW : ALIGN_ICON_COLUMN;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Konteyner Ayarları</h3>
          <Badge tone="neutral" size="sm">
            {depth >= MAX_CONTAINER_DEPTH ? `Seviye ${depth} · Maks.` : `Seviye ${depth}`}
          </Badge>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Paneli kapat" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {tooManyForReadability && (
        <span className="flex w-fit items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          Bu satırda {container.children.length} öğe var — okunabilirlik azalabilir.
        </span>
      )}

      <SettingsSection title="Düzen" first>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/70">Genişlik</p>
          <SegmentedToggle
            value={settings.layout}
            options={[
              { value: "boxed", label: "Kutulu", icon: Minimize2 },
              { value: "full-width", label: "Tam Genişlik", icon: Maximize2 },
            ]}
            onChange={(layout) => onChange({ layout })}
          />
        </div>

        {settings.layout === "boxed" && (
          <div className="space-y-1.5">
            <label htmlFor="container-width" className="block text-sm font-medium text-foreground">
              Genişlik ({settings.customWidth ?? DEFAULT_CONTAINER_MAX_WIDTH}px)
            </label>
            <input
              type="range"
              id="container-width"
              min={MIN_CONTAINER_MAX_WIDTH}
              max={MAX_CONTAINER_MAX_WIDTH}
              step={10}
              value={settings.customWidth ?? DEFAULT_CONTAINER_MAX_WIDTH}
              onChange={(e) => onChange({ customWidth: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <p className="text-xs text-foreground/60">
              Varsayılan: {DEFAULT_CONTAINER_MAX_WIDTH}px. {MIN_CONTAINER_MAX_WIDTH}–{MAX_CONTAINER_MAX_WIDTH}px arası.
            </p>
          </div>
        )}

        <MinHeightField value={settings.minHeight} onChange={(minHeight) => onChange({ minHeight })} />

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/70">Yön</p>
          <SegmentedToggle
            value={settings.direction}
            options={[
              { value: "column", label: "Dikey (Sütun)", icon: Rows2 },
              { value: "row", label: "Yatay (Satır)", icon: Columns2 },
            ]}
            onChange={(direction) => onChange({ direction })}
          />
          <p className="text-xs text-foreground/50">Yatay konteynerler mobilde otomatik olarak alt alta dizilir.</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/70">Ana eksen hizalama</p>
          <IconToggleGroup
            value={settings.justifyContent}
            options={JUSTIFY_OPTIONS}
            iconFor={(v) => justifyIcon[v]}
            labelFor={(v) => JUSTIFY_LABEL[v]}
            onChange={(justifyContent) => onChange({ justifyContent })}
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground/70">Çapraz eksen hizalama</p>
          <IconToggleGroup
            value={settings.alignItems}
            options={ALIGN_OPTIONS}
            iconFor={(v) => alignIcon[v]}
            labelFor={(v) => ALIGN_LABEL[v]}
            onChange={(alignItems) => onChange({ alignItems })}
          />
        </div>

        <Field id="container-gap" label="Öğeler arası boşluk">
          {(inputProps) => (
            <InputGroup>
              <InputGroupInput
                {...inputProps}
                type="number"
                min={0}
                max={128}
                value={settings.gap}
                onChange={(e) => onChange({ gap: Number(e.target.value) })}
              />
              <InputGroupAddon align="inline-end">px</InputGroupAddon>
            </InputGroup>
          )}
        </Field>
      </SettingsSection>

      <SettingsSection title="Boşluk">
        <SpacingBoxControl label="İç Boşluk (Padding)" value={settings.padding} onChange={(padding) => onChange({ padding })} />
        <div className="border-t border-border/40 pt-3">
          <SpacingBoxControl label="Dış Boşluk (Margin)" value={settings.margin} onChange={(margin) => onChange({ margin })} />
        </div>
      </SettingsSection>

      <SettingsSection title="Arka Plan">
        <BackgroundControl value={settings.background} onChange={(background) => onChange({ background })} />
      </SettingsSection>
    </div>
  );
}
