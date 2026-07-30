import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CtaBlock } from "@/lib/page-builder/types";

export function CtaBlockEditor({ block, onChange }: { block: CtaBlock; onChange: (block: CtaBlock) => void }) {
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
      <Field id={`${block.id}-label`} label="Buton metni" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.buttonLabel}
            onChange={(e) => onChange({ ...block, data: { ...block.data, buttonLabel: e.target.value } })}
          />
        )}
      </Field>
      <Field id={`${block.id}-href`} label="Buton bağlantısı" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.buttonHref}
            onChange={(e) => onChange({ ...block, data: { ...block.data, buttonHref: e.target.value } })}
          />
        )}
      </Field>
    </div>
  );
}
