import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import type { ImageBlock } from "@/lib/page-builder/types";

export function ImageBlockEditor({ block, onChange }: { block: ImageBlock; onChange: (block: ImageBlock) => void }) {
  return (
    <div className="space-y-3">
      <ImageUploadField
        id={`${block.id}-url`}
        label="Görsel"
        required
        value={block.data.url}
        onChange={(url) => onChange({ ...block, data: { ...block.data, url } })}
      />
      <Field id={`${block.id}-alt`} label="Alternatif metin (alt)">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.alt}
            onChange={(e) => onChange({ ...block, data: { ...block.data, alt: e.target.value } })}
          />
        )}
      </Field>
    </div>
  );
}
