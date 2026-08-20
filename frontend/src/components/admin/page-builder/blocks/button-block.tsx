import { AlignCenter, AlignLeft, AlignRight, type LucideIcon } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ButtonBlock, TextAlign } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";
import { IconPickerField } from "./icon-picker";

const STYLE_OPTIONS: { value: ButtonBlock["data"]["style"]; label: string }[] = [
  { value: "solid", label: "Dolu" },
  { value: "outline", label: "Çerçeveli" },
  { value: "ghost", label: "Yalın" },
];

const SIZE_OPTIONS: { value: ButtonBlock["data"]["size"]; label: string }[] = [
  { value: "sm", label: "Küçük" },
  { value: "md", label: "Orta" },
  { value: "lg", label: "Büyük" },
];

const ALIGN_OPTIONS: { value: TextAlign; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "Sol", icon: AlignLeft },
  { value: "center", label: "Orta", icon: AlignCenter },
  { value: "right", label: "Sağ", icon: AlignRight },
];

export function ButtonBlockEditor({ block, onChange }: { block: ButtonBlock; onChange: (block: ButtonBlock) => void }) {
  return (
    <div className="space-y-3">
      <Field id={`${block.id}-label`} label="Buton metni" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.label}
            onChange={(e) => onChange({ ...block, data: { ...block.data, label: e.target.value } })}
          />
        )}
      </Field>
      <Field id={`${block.id}-href`} label="Bağlantı" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.href}
            onChange={(e) => onChange({ ...block, data: { ...block.data, href: e.target.value } })}
          />
        )}
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Stil</p>
        <SegmentedToggle value={block.data.style} options={STYLE_OPTIONS} onChange={(style) => onChange({ ...block, data: { ...block.data, style } })} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Boyut</p>
        <SegmentedToggle value={block.data.size} options={SIZE_OPTIONS} onChange={(size) => onChange({ ...block, data: { ...block.data, size } })} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Hizalama</p>
        <SegmentedToggle value={block.data.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...block, data: { ...block.data, align } })} />
      </div>
      <IconPickerField
        id={`${block.id}-icon`}
        label="İkon (opsiyonel)"
        value={block.data.icon}
        onChange={(icon) => onChange({ ...block, data: { ...block.data, icon } })}
        allowNone
      />
    </div>
  );
}
