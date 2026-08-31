import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import type { BeforeAfterOrientation, BeforeAfterSliderBlock } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const ORIENTATION_OPTIONS: { value: BeforeAfterOrientation; label: string }[] = [
  { value: "horizontal", label: "Yatay (sol-sağ)" },
  { value: "vertical", label: "Dikey (yukarı-aşağı)" },
];

/** ui-designer §6.1 — kart-içi mini önizleme: pozisyon şeridi. `skill-bar` bloğunun dolum
 *  çubuğuyla AYNI görsel aile (ince çubuk + `bg-primary` dolgu). */
function PositionPreview({ position }: { position: number }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted p-3">
      <p className="text-xs font-medium text-foreground/60">Başlangıç pozisyonu: %{position}</p>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-border/60">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width]" style={{ width: `${position}%` }} />
      </div>
    </div>
  );
}

export function BeforeAfterSliderBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: BeforeAfterSliderBlock;
  onChange: (block: BeforeAfterSliderBlock) => void;
  /** §2.5 tablo B — şablon modunda tutamaç yönü (`orientation`) kilitlidir. */
  simple?: boolean;
}) {
  const position = block.data.initialSliderPosition ?? 50;

  return (
    <div className="space-y-3">
      <PositionPreview position={position} />
      <div className="grid grid-cols-2 gap-2">
        <ImageUploadField
          id={`${block.id}-before-url`}
          label="Önce görseli"
          required
          value={block.data.beforeUrl}
          onChange={(beforeUrl) => onChange({ ...block, data: { ...block.data, beforeUrl } })}
        />
        <ImageUploadField
          id={`${block.id}-after-url`}
          label="Sonra görseli"
          required
          value={block.data.afterUrl}
          onChange={(afterUrl) => onChange({ ...block, data: { ...block.data, afterUrl } })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field id={`${block.id}-before-label`} label="Önce etiketi" required>
          {(p) => (
            <Input {...p} value={block.data.beforeLabel} onChange={(e) => onChange({ ...block, data: { ...block.data, beforeLabel: e.target.value } })} />
          )}
        </Field>
        <Field id={`${block.id}-after-label`} label="Sonra etiketi" required>
          {(p) => (
            <Input {...p} value={block.data.afterLabel} onChange={(e) => onChange({ ...block, data: { ...block.data, afterLabel: e.target.value } })} />
          )}
        </Field>
      </div>
      {!simple && (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Tutamaç yönü</p>
            <SegmentedToggle
              value={block.data.orientation}
              options={ORIENTATION_OPTIONS}
              onChange={(orientation) => onChange({ ...block, data: { ...block.data, orientation } })}
            />
          </div>
          <Field id={`${block.id}-initial-position`} label="Başlangıç pozisyonu (%)">
            {(inputProps) => (
              <InputGroup>
                <InputGroupInput
                  {...inputProps}
                  type="number"
                  min={0}
                  max={100}
                  value={position}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 50;
                    onChange({ ...block, data: { ...block.data, initialSliderPosition: clamped } });
                  }}
                />
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              </InputGroup>
            )}
          </Field>
        </>
      )}
    </div>
  );
}
