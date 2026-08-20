import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { IconBoxBlock } from "@/lib/page-builder/types";
import { DEFAULT_ICON_NAME } from "@/lib/page-builder/icon-options";
import { IconPickerField } from "./icon-picker";

export function IconBoxBlockEditor({ block, onChange }: { block: IconBoxBlock; onChange: (block: IconBoxBlock) => void }) {
  return (
    <div className="space-y-3">
      <IconPickerField
        id={`${block.id}-icon`}
        label="İkon"
        value={block.data.icon}
        onChange={(icon) => onChange({ ...block, data: { ...block.data, icon: icon ?? DEFAULT_ICON_NAME } })}
      />
      <Field id={`${block.id}-heading`} label="Başlık" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.heading}
            onChange={(e) => onChange({ ...block, data: { ...block.data, heading: e.target.value } })}
          />
        )}
      </Field>
      <Field id={`${block.id}-description`} label="Açıklama">
        {(inputProps) => (
          <Textarea
            {...inputProps}
            rows={3}
            value={block.data.description}
            onChange={(e) => onChange({ ...block, data: { ...block.data, description: e.target.value } })}
          />
        )}
      </Field>
      <Field id={`${block.id}-href`} label="Bağlantı (opsiyonel)">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.href ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, href: e.target.value || undefined } })}
          />
        )}
      </Field>
    </div>
  );
}
