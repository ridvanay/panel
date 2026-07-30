import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import type { HeroBlock } from "@/lib/page-builder/types";

export function HeroBlockEditor({ block, onChange }: { block: HeroBlock; onChange: (block: HeroBlock) => void }) {
  return (
    <div className="space-y-3">
      <Field id={`${block.id}-heading`} label="Başlık" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.heading}
            onChange={(e) => onChange({ ...block, data: { ...block.data, heading: e.target.value } })}
          />
        )}
      </Field>
      <Field id={`${block.id}-subheading`} label="Alt başlık">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.subheading ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, subheading: e.target.value } })}
          />
        )}
      </Field>
      <ImageUploadField
        id={`${block.id}-image`}
        label="Görsel"
        value={block.data.imageUrl ?? ""}
        onChange={(imageUrl) => onChange({ ...block, data: { ...block.data, imageUrl } })}
      />
    </div>
  );
}
