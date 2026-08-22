import { AlignCenter, AlignLeft, AlignRight, type LucideIcon } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { HeadingBlock, TextAlign } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const ALIGN_OPTIONS: { value: TextAlign; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "Sol", icon: AlignLeft },
  { value: "center", label: "Orta", icon: AlignCenter },
  { value: "right", label: "Sağ", icon: AlignRight },
];

export function HeadingBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: HeadingBlock;
  onChange: (block: HeadingBlock) => void;
  /** §2.5 tablo B — şablon modunda (`TemplateBlockFields`) `level`/hizalama/alt çizgi kilitlidir. */
  simple?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Field id={`${block.id}-text`} label="Başlık metni" required>
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.text}
            onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
          />
        )}
      </Field>
      {!simple && (
        <>
          <Field id={`${block.id}-level`} label="Seviye">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={block.data.level}
                onChange={(e) =>
                  onChange({ ...block, data: { ...block.data, level: Number(e.target.value) as HeadingBlock["data"]["level"] } })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <option key={level} value={level}>
                    H{level}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Hizalama</p>
            <SegmentedToggle value={block.data.align} options={ALIGN_OPTIONS} onChange={(align) => onChange({ ...block, data: { ...block.data, align } })} />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor={`${block.id}-underline`} className="text-sm font-medium text-foreground">
              Alt çizgi vurgusu
            </label>
            <Switch
              id={`${block.id}-underline`}
              checked={block.data.underline}
              onCheckedChange={(underline) => onChange({ ...block, data: { ...block.data, underline } })}
            />
          </div>
        </>
      )}
    </div>
  );
}
