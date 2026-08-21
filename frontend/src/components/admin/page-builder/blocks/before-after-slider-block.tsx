import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import type { BeforeAfterOrientation, BeforeAfterSliderBlock } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const ORIENTATION_OPTIONS: { value: BeforeAfterOrientation; label: string }[] = [
  { value: "horizontal", label: "Yatay (sol-sağ)" },
  { value: "vertical", label: "Dikey (yukarı-aşağı)" },
];

export function BeforeAfterSliderBlockEditor({
  block,
  onChange,
}: {
  block: BeforeAfterSliderBlock;
  onChange: (block: BeforeAfterSliderBlock) => void;
}) {
  return (
    <div className="space-y-3">
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
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Tutamaç yönü</p>
        <SegmentedToggle
          value={block.data.orientation}
          options={ORIENTATION_OPTIONS}
          onChange={(orientation) => onChange({ ...block, data: { ...block.data, orientation } })}
        />
      </div>
    </div>
  );
}
