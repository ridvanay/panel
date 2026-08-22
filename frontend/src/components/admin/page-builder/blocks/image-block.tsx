import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import type { ImageBlock, ImageRadius } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const RADIUS_OPTIONS: { value: ImageRadius; label: string }[] = [
  { value: "none", label: "Yok" },
  { value: "sm", label: "Küçük" },
  { value: "md", label: "Orta" },
  { value: "lg", label: "Büyük" },
  { value: "full", label: "Tam" },
];

export function ImageBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: ImageBlock;
  onChange: (block: ImageBlock) => void;
  /** §2.5 tablo B — şablon modunda köşe yuvarlaklığı/lightbox kilitlidir. */
  simple?: boolean;
}) {
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
      <Field id={`${block.id}-caption`} label="Alt yazı (opsiyonel)">
        {(inputProps) => (
          <Input
            {...inputProps}
            value={block.data.caption ?? ""}
            onChange={(e) => onChange({ ...block, data: { ...block.data, caption: e.target.value } })}
          />
        )}
      </Field>
      {!simple && (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Köşe yuvarlaklığı</p>
            <SegmentedToggle
              value={block.data.radius ?? "none"}
              options={RADIUS_OPTIONS}
              onChange={(radius) => onChange({ ...block, data: { ...block.data, radius } })}
            />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor={`${block.id}-lightbox`} className="text-sm font-medium text-foreground">
              Tıklayınca büyüt (lightbox)
            </label>
            <Switch
              id={`${block.id}-lightbox`}
              checked={block.data.lightbox ?? false}
              onCheckedChange={(lightbox) => onChange({ ...block, data: { ...block.data, lightbox } })}
            />
          </div>
        </>
      )}
    </div>
  );
}
