import { AlignCenter, AlignLeft, AlignRight, type LucideIcon } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CtaBlock, CtaStyle, TextAlign } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const STYLE_OPTIONS: { value: CtaStyle; label: string }[] = [
  { value: "plain", label: "Sade" },
  { value: "soft", label: "Yumuşak" },
  { value: "solid", label: "Dolu" },
  { value: "outline", label: "Çerçeveli" },
];

const ALIGN_OPTIONS: { value: TextAlign; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "Sol", icon: AlignLeft },
  { value: "center", label: "Orta", icon: AlignCenter },
  { value: "right", label: "Sağ", icon: AlignRight },
];

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
      <Field id={`${block.id}-description`} label="Açıklama (opsiyonel)">
        {(inputProps) => (
          <Textarea
            {...inputProps}
            rows={2}
            value={block.data.description ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, description: e.target.value } })}
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
      <Field id={`${block.id}-secondary-label`} label="İkincil buton metni (opsiyonel)">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.secondaryButtonLabel ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, secondaryButtonLabel: e.target.value || undefined } })}
          />
        )}
      </Field>
      <Field
        id={`${block.id}-secondary-href`}
        label="İkincil buton bağlantısı"
        hint="İkincil buton yalnızca her iki alan da doluysa gösterilir."
      >
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.secondaryButtonHref ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, secondaryButtonHref: e.target.value || undefined } })}
          />
        )}
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Hizalama</p>
        <SegmentedToggle
          value={block.data.align ?? "center"}
          options={ALIGN_OPTIONS}
          onChange={(align) => onChange({ ...block, data: { ...block.data, align } })}
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Görünüm</p>
        <SegmentedToggle
          value={block.data.style ?? "plain"}
          options={STYLE_OPTIONS}
          onChange={(style) => onChange({ ...block, data: { ...block.data, style } })}
        />
      </div>
    </div>
  );
}
