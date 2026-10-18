import { AlignCenter, AlignLeft, AlignRight, type LucideIcon } from "lucide-react";
import { PostEditor } from "@/components/admin/blog/post-editor";
import type { TextAlign, TextBlock } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const ALIGN_OPTIONS: { value: TextAlign; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "Sol", icon: AlignLeft },
  { value: "center", label: "Orta", icon: AlignCenter },
  { value: "right", label: "Sağ", icon: AlignRight },
];

export function TextBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: TextBlock;
  onChange: (block: TextBlock) => void;
  /** Şablon modunda (`TemplateBlockFields`) hizalama kilitlidir — yalnızca `data.html` düzenlenir. */
  simple?: boolean;
}) {
  return (
    <div className="space-y-3">
      {!simple && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Hizalama</p>
          <SegmentedToggle
            value={block.data.align ?? "left"}
            options={ALIGN_OPTIONS}
            onChange={(align) => onChange({ ...block, data: { ...block.data, align } })}
          />
        </div>
      )}
      <PostEditor
        content={block.data.html}
        onChange={(html) => onChange({ ...block, data: { ...block.data, html } })}
        placeholder="Metin girin…"
        minHeightClassName="min-h-[140px]"
      />
    </div>
  );
}
