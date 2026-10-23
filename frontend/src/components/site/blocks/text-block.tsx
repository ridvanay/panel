import { cn } from "@/lib/utils";
import type { BlockChrome, TextAlign, TextBlock } from "@/lib/page-builder/types";
import { RichContentWithShortcodes } from "./rich-content-with-shortcodes";

const ALIGN_CLASS: Record<TextAlign, string> = {
  left: "text-start",
  center: "text-center",
  right: "text-end",
};

export function TextBlockView({ block, chrome }: { block: TextBlock; chrome: BlockChrome }) {
  return (
    <RichContentWithShortcodes
      html={block.data.html}
      className={cn(
        "prose",
        chrome === "page" ? "mx-auto max-w-3xl px-4 py-8 sm:px-6" : "max-w-none",
        ALIGN_CLASS[block.data.align ?? "left"] ?? ALIGN_CLASS.left
      )}
    />
  );
}
