import { PostEditor } from "@/components/admin/blog/post-editor";
import type { TextBlock } from "@/lib/page-builder/types";

export function TextBlockEditor({ block, onChange }: { block: TextBlock; onChange: (block: TextBlock) => void }) {
  return (
    <PostEditor
      content={block.data.html}
      onChange={(html) => onChange({ ...block, data: { html } })}
    />
  );
}
