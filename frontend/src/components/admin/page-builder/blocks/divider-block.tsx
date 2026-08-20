import { MoveVertical, SeparatorHorizontal } from "lucide-react";
import { Field } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { DividerBlock } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const VARIANT_OPTIONS: { value: DividerBlock["data"]["variant"]; label: string; icon: typeof SeparatorHorizontal }[] = [
  { value: "line", label: "Çizgi", icon: SeparatorHorizontal },
  { value: "space", label: "Boşluk", icon: MoveVertical },
];

const STYLE_OPTIONS: { value: DividerBlock["data"]["style"]; label: string }[] = [
  { value: "solid", label: "Düz" },
  { value: "dashed", label: "Kesikli" },
];

export function DividerBlockEditor({ block, onChange }: { block: DividerBlock; onChange: (block: DividerBlock) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Tip</p>
        <SegmentedToggle
          value={block.data.variant}
          options={VARIANT_OPTIONS}
          onChange={(variant) => onChange({ ...block, data: { ...block.data, variant } })}
        />
      </div>
      {block.data.variant === "line" && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Çizgi stili</p>
          <SegmentedToggle value={block.data.style} options={STYLE_OPTIONS} onChange={(style) => onChange({ ...block, data: { ...block.data, style } })} />
        </div>
      )}
      <Field id={`${block.id}-height`} label={block.data.variant === "line" ? "Dikey boşluk (px)" : "Yükseklik (px)"}>
        {(inputProps) => (
          <InputGroup>
            <InputGroupInput
              {...inputProps}
              type="number"
              min={0}
              max={400}
              value={block.data.height}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const height = Number.isFinite(raw) ? Math.max(0, Math.min(400, raw)) : 0;
                onChange({ ...block, data: { ...block.data, height } });
              }}
            />
            <InputGroupAddon align="inline-end">px</InputGroupAddon>
          </InputGroup>
        )}
      </Field>
    </div>
  );
}
