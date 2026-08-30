import { cn } from "@/lib/utils";
import type { BlockChrome, TextBlock } from "@/lib/page-builder/types";
import { RichContentWithShortcodes } from "./rich-content-with-shortcodes";

export function TextBlockView({ block, chrome }: { block: TextBlock; chrome: BlockChrome }) {
  return (
    <RichContentWithShortcodes
      html={block.data.html}
      className={cn("prose", chrome === "page" ? "mx-auto max-w-3xl px-4 py-8 sm:px-6" : "max-w-none")}
    />
  );
}
